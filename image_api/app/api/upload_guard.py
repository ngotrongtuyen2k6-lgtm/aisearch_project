import hashlib
import time
from collections import OrderedDict
from typing import Any

from starlette.responses import JSONResponse

from app.config import UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW_SECONDS


class UploadAdmissionRateLimitMiddleware:
    def __init__(self, app: Any, manager: Any):
        self.app = app
        self.manager = manager
        self._buckets: OrderedDict[str, tuple[float, int]] = OrderedDict()
        self._checks = 0

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or scope.get("path") != "/upload"
        ):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        address = client[0] if client else "unknown"
        key = hashlib.sha256(address.encode("utf-8")).hexdigest()
        now = time.monotonic()
        window_start, count = self._buckets.get(key, (now, 0))
        if now - window_start >= UPLOAD_RATE_WINDOW_SECONDS:
            window_start, count = now, 0

        if count >= UPLOAD_RATE_LIMIT:
            retry_after = max(1, int(UPLOAD_RATE_WINDOW_SECONDS - (now - window_start)))
            response = JSONResponse(
                {"detail": "Bạn đã gửi quá 5 yêu cầu tải ảnh trong phút này. Vui lòng chờ rồi thử lại."},
                status_code=429,
                headers={
                    "RateLimit-Limit": str(UPLOAD_RATE_LIMIT),
                    "RateLimit-Remaining": "0",
                    "Retry-After": str(retry_after),
                },
            )
            await response(scope, receive, send)
            return

        count += 1
        self._buckets[key] = (window_start, count)
        self._buckets.move_to_end(key)
        self._checks += 1
        if self._checks % 256 == 0:
            for bucket_key, (started, _) in list(self._buckets.items()):
                if now - started >= UPLOAD_RATE_WINDOW_SECONDS:
                    self._buckets.pop(bucket_key, None)
        while len(self._buckets) > 10000:
            self._buckets.popitem(last=False)

        reservation = await self.manager.reserve()
        if reservation is None:
            response = JSONResponse(
                {"detail": "Dịch vụ đang bận xử lý ảnh. Vui lòng thử lại sau ít phút."},
                status_code=503,
                headers={
                    "RateLimit-Limit": str(UPLOAD_RATE_LIMIT),
                    "RateLimit-Remaining": str(UPLOAD_RATE_LIMIT - count),
                    "Retry-After": "5",
                },
            )
            await response(scope, receive, send)
            return

        scope.setdefault("state", {})["image_upload_reservation"] = reservation
        scope["state"]["image_upload_transferred"] = False

        async def send_with_rate_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend([
                    (b"ratelimit-limit", str(UPLOAD_RATE_LIMIT).encode("ascii")),
                    (b"ratelimit-remaining", str(UPLOAD_RATE_LIMIT - count).encode("ascii")),
                ])
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_rate_headers)
        finally:
            if not scope["state"].get("image_upload_transferred"):
                self.manager.release_reservation(reservation)
