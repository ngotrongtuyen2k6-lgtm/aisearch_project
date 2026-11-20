import asyncio
import os
from pathlib import Path
from typing import Any

import httpx

from app.config import AI_PROVIDER_TIMEOUT_SECONDS, PROVENANCE_PROVIDER_TIMEOUT_SECONDS


class ProviderUnavailable(Exception):
    pass


async def _post_image(endpoint: str, path: Path, file_type: str, timeout: int) -> dict[str, Any]:
    try:
        image_bytes = await asyncio.to_thread(path.read_bytes)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                endpoint,
                files={"file": (path.name, image_bytes, file_type)},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError, OSError) as error:
        raise ProviderUnavailable("Configured analysis provider could not be reached or returned invalid data.") from error
    if not isinstance(payload, dict):
        raise ProviderUnavailable("Configured analysis provider returned an invalid response.")
    return payload


class RemoteImageAiDetector:
    def __init__(self, endpoint: str | None = None):
        self.endpoint = endpoint or os.getenv("IMAGE_AI_DETECTOR_URL")

    async def detect(self, path: Path, file_type: str) -> dict[str, Any] | None:
        if not self.endpoint:
            return None
        payload = await _post_image(
            self.endpoint,
            path,
            file_type,
            AI_PROVIDER_TIMEOUT_SECONDS,
        )
        score = payload.get("score")
        confidence = payload.get("confidence")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100:
            raise ProviderUnavailable("Configured AI detector returned an invalid score.")
        if not isinstance(confidence, str) or confidence.title() not in {"Low", "Medium", "High"}:
            raise ProviderUnavailable("Configured AI detector returned an invalid confidence level.")
        return {
            "score": round(score),
            "confidence": confidence.title(),
            "label": str(payload.get("label", ""))[:100],
        }


class RemoteC2PAVerifier:
    def __init__(self, endpoint: str | None = None):
        self.endpoint = endpoint or os.getenv("C2PA_VERIFY_URL")

    async def verify(self, path: Path, file_type: str) -> dict[str, Any]:
        if not self.endpoint:
            return {
                "status": "unavailable",
                "verified": None,
                "claim": None,
                "summary": "Chưa cấu hình bộ xác minh chữ ký C2PA.",
            }
        payload = await _post_image(
            self.endpoint,
            path,
            file_type,
            PROVENANCE_PROVIDER_TIMEOUT_SECONDS,
        )
        verified = payload.get("verified")
        if not isinstance(verified, bool):
            raise ProviderUnavailable("Configured C2PA verifier did not return a verification result.")
        claim = payload.get("claim")
        summary = payload.get("summary")
        return {
            "status": "verified" if verified else "unverified",
            "verified": verified,
            "claim": str(claim)[:200] if claim is not None else None,
            "summary": str(summary or ("Chữ ký C2PA hợp lệ." if verified else "Không xác minh được chữ ký C2PA."))[:500],
        }
