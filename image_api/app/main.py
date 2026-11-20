import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.upload_guard import UploadAdmissionRateLimitMiddleware
from app.config import STORAGE_DIR
from app.services.jobs import JobManager
from app.services.storage import TemporaryImageStore


def create_app(
    storage_dir: Path | None = None,
    max_upload_bytes: int | None = None,
    job_manager: JobManager | None = None,
) -> FastAPI:
    directory = (storage_dir or STORAGE_DIR).resolve()
    store = TemporaryImageStore(directory, max_upload_bytes) if max_upload_bytes else TemporaryImageStore(directory)
    manager = job_manager or JobManager(store)

    application = FastAPI(
        title="Verity Image MVP API",
        description="Indicative image analysis with evidence and explicit limitations; not proof.",
        version="1.0.0",
    )
    application.state.image_store = store
    application.state.job_manager = manager
    application.add_middleware(UploadAdmissionRateLimitMiddleware, manager=manager)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[os.getenv("CLIENT_ORIGIN", "http://localhost:5173")],
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )
    application.include_router(router)
    return application


app = create_app()
