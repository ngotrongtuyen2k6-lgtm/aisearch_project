import hashlib
import logging
import os
import tempfile
import time
from pathlib import Path

from fastapi import UploadFile

from app.config import JOB_TTL_SECONDS, MAX_UPLOAD_BYTES, STORAGE_DIR

logger = logging.getLogger(__name__)


class UploadTooLarge(Exception):
    pass


class TemporaryImageStore:
    def __init__(self, directory: Path = STORAGE_DIR, max_bytes: int = MAX_UPLOAD_BYTES):
        self.directory = directory
        self.max_bytes = max_bytes
        self.directory.mkdir(parents=True, exist_ok=True)
        self.cleanup_stale_uploads()

    def cleanup_stale_uploads(self) -> None:
        cutoff = time.time() - JOB_TTL_SECONDS
        for path in self.directory.glob("image-*.upload"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not clean stale image upload %s.", path.name)

    async def save_upload(self, upload: UploadFile) -> tuple[Path, int, str]:
        descriptor, name = tempfile.mkstemp(prefix="image-", suffix=".upload", dir=self.directory)
        path = Path(name)
        digest = hashlib.sha256()
        size = 0

        try:
            with os.fdopen(descriptor, "wb") as target:
                while chunk := await upload.read(64 * 1024):
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise UploadTooLarge
                    digest.update(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            if size == 0:
                raise ValueError("The uploaded file is empty.")
            return path, size, digest.hexdigest()
        except Exception:
            self.delete_path(path)
            raise

    @staticmethod
    def delete_path(path: Path | None) -> None:
        if path is None:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # Keep cleanup errors visible to the job manager for retry/logging.
            raise
