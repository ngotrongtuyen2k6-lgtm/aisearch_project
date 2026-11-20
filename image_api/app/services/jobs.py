import asyncio
import copy
import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import (
    JOB_TTL_SECONDS,
    MAX_ACTIVE_JOBS,
    MAX_QUEUED_JOBS,
    MAX_RETAINED_JOBS,
    RESULT_CACHE_MAX_ENTRIES,
    RESULT_CACHE_TTL_SECONDS,
)
from app.services.aggregator import aggregate_image_analysis
from app.services.image_detector import ImageTooLarge, InvalidImage, analyze_image_file
from app.services.providers import (
    ProviderUnavailable,
    RemoteC2PAVerifier,
    RemoteImageAiDetector,
)
from app.services.storage import TemporaryImageStore

logger = logging.getLogger(__name__)


@dataclass
class Job:
    job_id: str
    status: str
    created_at: datetime
    sha256: str
    file_id: str | None = None
    error: str | None = None
    result: dict[str, Any] | None = None


class JobManager:
    def __init__(
        self,
        store: TemporaryImageStore,
        ai_detector: Any | None = None,
        c2pa_verifier: Any | None = None,
        max_active: int = MAX_ACTIVE_JOBS,
        max_queued: int = MAX_QUEUED_JOBS,
    ):
        self.store = store
        self.ai_detector = ai_detector or RemoteImageAiDetector()
        self.c2pa_verifier = c2pa_verifier or RemoteC2PAVerifier()
        self._max_outstanding = max_active + max_queued
        self._outstanding = 0
        self._reservations: set[str] = set()
        self._semaphore = asyncio.Semaphore(max_active)
        self._lock = asyncio.Lock()
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        self._files: dict[str, Path] = {}
        self._known_file_ids: dict[str, float] = {}
        self._cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
        self._disputes: list[dict[str, Any]] = []
        self._tasks: set[asyncio.Task] = set()

    async def reserve(self) -> str | None:
        async with self._lock:
            self._cleanup_expired()
            if self._outstanding >= self._max_outstanding:
                return None
            token = str(uuid.uuid4())
            self._reservations.add(token)
            self._outstanding += 1
            return token

    def release_reservation(self, token: str) -> None:
        if token in self._reservations:
            self._reservations.remove(token)
            self._outstanding = max(0, self._outstanding - 1)

    def get_cached_result(self, sha256: str) -> dict[str, Any] | None:
        entry = self._cache.get(sha256)
        if entry is None:
            return None
        created_at, result = entry
        if time.monotonic() - created_at > RESULT_CACHE_TTL_SECONDS:
            del self._cache[sha256]
            return None
        self._cache.move_to_end(sha256)
        return copy.deepcopy(result)

    def complete_from_cache(self, reservation: str, sha256: str, result: dict[str, Any]) -> Job:
        if reservation not in self._reservations:
            raise RuntimeError("Unknown upload reservation.")
        job = Job(
            job_id=str(uuid.uuid4()),
            status="completed",
            created_at=datetime.now(timezone.utc),
            sha256=sha256,
            result=copy.deepcopy(result),
        )
        self._jobs[job.job_id] = job
        self.release_reservation(reservation)
        self._cleanup_expired()
        return job

    def enqueue(
        self,
        reservation: str,
        file_id: str,
        path: Path,
        sha256: str,
        file_type: str,
    ) -> Job:
        if reservation not in self._reservations:
            raise RuntimeError("Unknown upload reservation.")
        job = Job(
            job_id=str(uuid.uuid4()),
            status="queued",
            created_at=datetime.now(timezone.utc),
            sha256=sha256,
            file_id=file_id,
        )
        self._jobs[job.job_id] = job
        self._files[file_id] = path
        self._known_file_ids[file_id] = time.monotonic() + JOB_TTL_SECONDS
        task = asyncio.create_task(self._run(job, reservation, file_id, path, sha256, file_type))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        self._cleanup_expired()
        return job

    async def _run(
        self,
        job: Job,
        reservation: str,
        file_id: str,
        path: Path,
        sha256: str,
        file_type: str,
    ) -> None:
        try:
            async with self._semaphore:
                job.status = "processing"
                detector_output = await asyncio.to_thread(analyze_image_file, path, file_type)
                try:
                    ai_output = await self.ai_detector.detect(path, file_type)
                except ProviderUnavailable as error:
                    logger.warning("AI image detector unavailable: %s", error)
                    ai_output = None
                    detector_output["limitations"].append(
                        "Không thể kết nối bộ phân tích AI đã cấu hình; điểm AI được để trống."
                    )

                try:
                    provenance = await self.c2pa_verifier.verify(path, file_type)
                except ProviderUnavailable as error:
                    logger.warning("C2PA verifier unavailable: %s", error)
                    provenance = {
                        "status": "unavailable",
                        "verified": None,
                        "claim": None,
                        "summary": "Không thể kết nối bộ xác minh C2PA đã cấu hình.",
                    }

                job.result = aggregate_image_analysis(
                    detector_output=detector_output,
                    ai_output=ai_output,
                    provenance=provenance,
                    sha256=sha256,
                )
                job.status = "completed"
                self._cache_result(sha256, job.result)
        except (InvalidImage, ImageTooLarge) as error:
            logger.info("Image job %s could not be analyzed: %s", job.job_id, error)
            job.status = "failed"
            job.error = "Không thể phân tích ảnh. Tệp có thể bị hỏng hoặc vượt giới hạn xử lý."
        except Exception:
            logger.exception("Image job %s failed unexpectedly.", job.job_id)
            job.status = "failed"
            job.error = "Đã xảy ra lỗi khi phân tích ảnh. Vui lòng thử lại."
        finally:
            try:
                self.store.delete_path(path)
            except OSError:
                logger.exception("Could not remove temporary image for job %s.", job.job_id)
                job.status = "failed"
                job.error = "Không thể dọn tệp tạm sau khi phân tích."
            self._files.pop(file_id, None)
            self.release_reservation(reservation)

    def _cache_result(self, sha256: str, result: dict[str, Any]) -> None:
        self._cache[sha256] = (time.monotonic(), copy.deepcopy(result))
        self._cache.move_to_end(sha256)
        while len(self._cache) > RESULT_CACHE_MAX_ENTRIES:
            self._cache.popitem(last=False)

    def get_job(self, job_id: str) -> Job | None:
        self._cleanup_expired()
        return self._jobs.get(job_id)

    def get_result(self, job_id: str) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if job is None or job.status != "completed" or job.result is None:
            return None
        return copy.deepcopy(job.result)

    async def delete_file(self, file_id: str) -> bool:
        self._cleanup_expired()
        expiry = self._known_file_ids.pop(file_id, None)
        if expiry is None:
            return False
        path = self._files.pop(file_id, None)
        if path is not None:
            await asyncio.to_thread(self.store.delete_path, path)
        return True

    def add_dispute(self, job_id: str, comment: str, contact: str | None) -> dict[str, Any] | None:
        if self.get_result(job_id) is None:
            return None
        dispute = {
            "dispute_id": str(uuid.uuid4()),
            "job_id": job_id,
            "comment": comment,
            "contact": contact,
            "received_at": datetime.now(timezone.utc),
        }
        self._disputes.append(dispute)
        if len(self._disputes) > 10000:
            del self._disputes[:-10000]
        return dispute

    def _cleanup_expired(self) -> None:
        now = time.monotonic()
        for key, (created_at, _) in list(self._cache.items()):
            if now - created_at > RESULT_CACHE_TTL_SECONDS:
                self._cache.pop(key, None)
        for file_id, expiry in list(self._known_file_ids.items()):
            if expiry <= now:
                self._known_file_ids.pop(file_id, None)
                path = self._files.pop(file_id, None)
                if path is not None:
                    try:
                        self.store.delete_path(path)
                    except OSError:
                        logger.exception("Could not clean expired temporary file %s.", file_id)
        if len(self._known_file_ids) > MAX_RETAINED_JOBS:
            for file_id in list(self._known_file_ids):
                if len(self._known_file_ids) <= MAX_RETAINED_JOBS:
                    break
                if file_id not in self._files:
                    self._known_file_ids.pop(file_id, None)
        cutoff = datetime.now(timezone.utc).timestamp() - JOB_TTL_SECONDS
        for job_id, job in list(self._jobs.items()):
            if job.created_at.timestamp() < cutoff and job.status in {"completed", "failed"}:
                self._jobs.pop(job_id, None)
        if len(self._jobs) > MAX_RETAINED_JOBS:
            for job_id, job in list(self._jobs.items()):
                if len(self._jobs) <= MAX_RETAINED_JOBS:
                    break
                if job.status in {"completed", "failed"}:
                    self._jobs.pop(job_id, None)
