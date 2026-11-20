import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

MAX_UPLOAD_BYTES = max(1, int(os.getenv("IMAGE_API_MAX_UPLOAD_MB", "10"))) * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
MAX_ACTIVE_JOBS = 2
MAX_QUEUED_JOBS = 6
MAX_RETAINED_JOBS = 500
JOB_TTL_SECONDS = 24 * 60 * 60
RESULT_CACHE_TTL_SECONDS = 24 * 60 * 60
RESULT_CACHE_MAX_ENTRIES = 128
UPLOAD_RATE_LIMIT = 5
UPLOAD_RATE_WINDOW_SECONDS = 60
AI_PROVIDER_TIMEOUT_SECONDS = 15
PROVENANCE_PROVIDER_TIMEOUT_SECONDS = 10

storage_dir = os.getenv("IMAGE_API_STORAGE", "").strip()
STORAGE_DIR = Path(
    storage_dir or str(Path(tempfile.gettempdir()) / "verity-image-api")
).resolve()

SUPPORTED_MIME_FORMATS = {
    "image/jpeg": {"format": "JPEG", "extensions": {".jpg", ".jpeg"}},
    "image/png": {"format": "PNG", "extensions": {".png"}},
    "image/webp": {"format": "WEBP", "extensions": {".webp"}},
}
