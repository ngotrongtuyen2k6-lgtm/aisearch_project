import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from app.schemas import (
    DisputeAccepted,
    DisputeRequest,
    ImageResult,
    JobView,
    UploadAccepted,
)
from app.services.image_detector import (
    ImageTooLarge,
    InvalidImage,
    UnsupportedImage,
    validate_uploaded_image,
)
from app.services.storage import UploadTooLarge

router = APIRouter()


def _format_size(byte_count: int) -> str:
    megabyte = 1024 * 1024
    kilobyte = 1024
    if byte_count % megabyte == 0:
        return f"{byte_count // megabyte} MB"
    if byte_count % kilobyte == 0:
        return f"{byte_count // kilobyte} KB"
    return f"{byte_count} bytes"


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/upload", status_code=202, response_model=UploadAccepted)
async def upload_image(request: Request, file: UploadFile = File(...)) -> UploadAccepted:
    manager = request.app.state.job_manager
    store = request.app.state.image_store
    reservation = request.state.image_upload_reservation
    path: Path | None = None
    handed_off = False

    try:
        if not file.content_type:
            raise HTTPException(status_code=415, detail="Không nhận được MIME type của tệp.")
        if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
            raise HTTPException(status_code=415, detail="Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP.")
        try:
            path, _, sha256 = await store.save_upload(file)
        except UploadTooLarge as error:
            raise HTTPException(
                status_code=413,
                detail=f"Ảnh vượt quá giới hạn {_format_size(store.max_bytes)}.",
            ) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Tệp tải lên đang rỗng.") from error

        try:
            file_type = await asyncio.to_thread(
                validate_uploaded_image,
                path,
                file.content_type,
                file.filename or "",
            )
        except UnsupportedImage as error:
            raise HTTPException(status_code=415, detail="MIME type, phần mở rộng và nội dung ảnh phải khớp nhau.") from error
        except ImageTooLarge as error:
            raise HTTPException(status_code=413, detail="Kích thước ảnh theo pixel vượt giới hạn xử lý an toàn.") from error
        except InvalidImage as error:
            raise HTTPException(status_code=422, detail="Tệp không phải ảnh hợp lệ hoặc ảnh đã bị hỏng.") from error

        cached_result = manager.get_cached_result(sha256)
        if cached_result is not None:
            job = manager.complete_from_cache(reservation, sha256, cached_result)
            manager.release_reservation(reservation)
            request.state.image_upload_transferred = True
            await asyncio.to_thread(store.delete_path, path)
            path = None
            handed_off = True
            return UploadAccepted(
                job_id=job.job_id,
                file_id=None,
                sha256=sha256,
                status="completed",
                cached=True,
            )

        file_id = str(uuid.uuid4())
        job = manager.enqueue(reservation, file_id, path, sha256, file_type)
        request.state.image_upload_transferred = True
        path = None
        handed_off = True
        return UploadAccepted(
            job_id=job.job_id,
            file_id=file_id,
            sha256=sha256,
            status="queued",
        )
    finally:
        await file.close()
        if path is not None:
            await asyncio.to_thread(store.delete_path, path)
        if not handed_off:
            manager.release_reservation(reservation)


@router.get("/jobs/{job_id}", response_model=JobView)
async def get_job(job_id: str, request: Request) -> JobView:
    job = request.app.state.job_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu phân tích.")
    return JobView(
        job_id=job.job_id,
        status=job.status,
        created_at=job.created_at,
        error=job.error,
    )


@router.get("/results/{job_id}", response_model=ImageResult)
async def get_result(job_id: str, request: Request) -> dict:
    manager = request.app.state.job_manager
    job = manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy kết quả phân tích.")
    if job.status == "failed":
        raise HTTPException(status_code=422, detail=job.error or "Không thể phân tích ảnh.")
    result = manager.get_result(job_id)
    if result is None:
        raise HTTPException(status_code=409, detail="Kết quả chưa sẵn sàng; hãy kiểm tra trạng thái job.")
    return result


@router.post("/results/{job_id}/dispute", status_code=201, response_model=DisputeAccepted)
async def dispute_result(
    job_id: str,
    dispute: DisputeRequest,
    request: Request,
) -> DisputeAccepted:
    record = request.app.state.job_manager.add_dispute(
        job_id,
        dispute.comment.strip(),
        dispute.contact.strip() if dispute.contact else None,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Chỉ có thể phản hồi kết quả đã hoàn tất.")
    return DisputeAccepted(**record)


@router.delete("/files/{file_id}", status_code=204)
async def delete_file(file_id: str, request: Request) -> Response:
    deleted = await request.app.state.job_manager.delete_file(file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Không tìm thấy tệp hoặc tệp đã hết hạn.")
    return Response(status_code=204)
