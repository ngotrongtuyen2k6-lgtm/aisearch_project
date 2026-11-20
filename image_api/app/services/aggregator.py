from datetime import datetime, timezone
from typing import Any

from app.schemas import Confidence, ImageResult


def _claim_matches(claim: str | None, terms: tuple[str, ...]) -> bool:
    claim_text = (claim or "").casefold()
    return any(term in claim_text for term in terms)


def aggregate_image_analysis(
    *,
    detector_output: dict[str, Any],
    ai_output: dict[str, Any] | None,
    provenance: dict[str, Any],
    sha256: str,
) -> dict[str, Any]:
    evidence = list(detector_output["evidence"])
    limitations = list(detector_output["limitations"])
    provenance = {
        "status": provenance.get("status", "unavailable"),
        "verified": provenance.get("verified"),
        "claim": provenance.get("claim"),
        "summary": provenance.get("summary", "Không có kết quả xác minh nguồn gốc."),
    }

    ai_score = None
    ai_confidence = Confidence.LOW
    if ai_output:
        ai_score = ai_output["score"]
        provider_confidence = Confidence(ai_output["confidence"])
        claim_supports_ai = (
            provenance["verified"] is True
            and _claim_matches(provenance["claim"], ("ai-generated", "ai generated", "synthetic"))
        )
        if provider_confidence == Confidence.HIGH and claim_supports_ai:
            ai_confidence = Confidence.HIGH
        elif provider_confidence in {Confidence.HIGH, Confidence.MEDIUM}:
            ai_confidence = Confidence.MEDIUM
        evidence.append({
            "code": "ai_detector",
            "kind": "inference",
            "title": "Kết quả bộ phân tích ảnh AI",
            "detail": (
                f"Bộ phân tích đã cấu hình trả điểm {ai_score}/100 với độ tin cậy "
                f"{provider_confidence.value}. Đây là ước lượng của mô hình, không phải bằng chứng xác thực."
            ),
        })
    else:
        limitations.append("Chưa cấu hình bộ phân tích AI chuyên dụng; điểm AI được để trống thay vì tạo số liệu giả.")

    signals = detector_output["signals"]
    edit_signal_weights = {
        "software_editing_hint": 25,
        "timestamp_mismatch": 25,
        "ela_high": 35,
    }
    active_edit_signals = [
        signal for signal, active in signals.items()
        if active and signal in edit_signal_weights
    ]
    edited_score = None
    edited_confidence = Confidence.LOW
    if active_edit_signals:
        edited_score = min(95, 35 + sum(edit_signal_weights[item] for item in active_edit_signals))
        signed_edit_claim = (
            provenance["verified"] is True
            and _claim_matches(provenance["claim"], ("edited", "editing", "modified"))
        )
        if signed_edit_claim:
            edited_confidence = Confidence.HIGH
        elif len(active_edit_signals) >= 2:
            edited_confidence = Confidence.MEDIUM
        evidence.append({
            "code": "edit_signal_aggregate",
            "kind": "inference",
            "title": "Tổng hợp dấu hiệu có thể liên quan đến chỉnh sửa",
            "detail": (
                f"Có {len(active_edit_signals)} nhóm dấu hiệu tham khảo. Điểm {edited_score}/100 "
                "là heuristic chưa được hiệu chuẩn, không phải xác suất pháp chứng."
            ),
        })
    else:
        limitations.append("Không có đủ dấu hiệu để tính điểm chỉnh sửa; điểm được để trống.")

    if provenance["status"] == "verified":
        evidence.append({
            "code": "c2pa_verified",
            "kind": "provenance",
            "title": "Đã xác minh chữ ký provenance",
            "detail": provenance["summary"],
        })
    elif provenance["status"] == "unverified":
        evidence.append({
            "code": "c2pa_unverified",
            "kind": "provenance",
            "title": "Không xác minh được chữ ký provenance",
            "detail": provenance["summary"],
        })
    else:
        limitations.append("Chưa có bộ xác minh C2PA được cấu hình; không thể xác nhận chữ ký nguồn gốc.")

    if detector_output["file_type"] != "image/jpeg":
        limitations.append("ELA là phép so sánh nén lại JPEG và không phải công cụ phát hiện chỉnh sửa đáng tin cậy cho định dạng ảnh này.")
    if active_edit_signals:
        limitations.append("Điểm chỉnh sửa là heuristic minh bạch từ các dấu hiệu yếu và chưa được hiệu chuẩn.")
    limitations.append("Kết quả chỉ mang tính tham khảo (Indicative, not proof), không phải kết luận pháp lý.")

    overall_confidence = min(
        (ai_confidence, edited_confidence),
        key=lambda level: [Confidence.LOW, Confidence.MEDIUM, Confidence.HIGH].index(level),
    )
    result = ImageResult(
        file_type=detector_output["file_type"],
        ai_generated={"score": ai_score, "confidence": ai_confidence},
        edited={"score": edited_score, "confidence": edited_confidence},
        evidence=evidence,
        limitations=list(dict.fromkeys(limitations)),
        language_supported=["vi", "en"],
        status="Inconclusive" if overall_confidence == Confidence.LOW else "Indicative",
        provenance=provenance,
        sha256=sha256,
        timestamp=datetime.now(timezone.utc),
        ela_heatmap_base64=detector_output["ela_heatmap_base64"],
    )
    return result.model_dump(mode="json")
