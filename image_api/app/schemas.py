from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Confidence(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class ScoreConfidence(BaseModel):
    score: int | None = Field(default=None, ge=0, le=100)
    confidence: Confidence


class Evidence(BaseModel):
    code: str
    kind: Literal["observed", "inference", "provenance"]
    title: str
    detail: str


class Provenance(BaseModel):
    status: Literal["verified", "unverified", "unavailable"]
    verified: bool | None = None
    claim: str | None = None
    summary: str


class ImageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    file_type: str
    ai_generated: ScoreConfidence
    edited: ScoreConfidence
    evidence: list[Evidence]
    limitations: list[str]
    language_supported: list[str]
    status: Literal["Indicative", "Inconclusive"]
    provenance: Provenance
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    timestamp: datetime
    ela_heatmap_base64: str | None = None


class UploadAccepted(BaseModel):
    job_id: str
    file_id: str | None
    sha256: str
    status: Literal["queued", "completed"]
    cached: bool = False


class JobView(BaseModel):
    job_id: str
    status: Literal["queued", "processing", "completed", "failed"]
    created_at: datetime
    error: str | None = None


class DisputeRequest(BaseModel):
    comment: str = Field(min_length=10, max_length=5000)
    contact: str | None = Field(default=None, max_length=320)


class DisputeAccepted(BaseModel):
    dispute_id: str
    job_id: str
    received_at: datetime
