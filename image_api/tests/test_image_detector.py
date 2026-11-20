import base64
import io

from PIL import ExifTags, Image

from app.services.aggregator import aggregate_image_analysis
from app.services.image_detector import analyze_image_file
from app.services.providers import RemoteC2PAVerifier, RemoteImageAiDetector


def test_exif_software_and_jpeg_ela_are_reported(tmp_path):
    exif = Image.Exif()
    exif[305] = "Adobe Photoshop"
    image_path = tmp_path / "edited.jpg"
    Image.new("RGB", (96, 96), "orange").save(image_path, format="JPEG", exif=exif)

    result = analyze_image_file(image_path, "image/jpeg")

    assert result["signals"]["software_editing_hint"] is True
    assert any(item["code"] == "exif_software" for item in result["evidence"])
    heatmap = base64.b64decode(result["ela_heatmap_base64"], validate=True)
    with Image.open(io.BytesIO(heatmap)) as image:
        assert image.format == "PNG"
        assert image.size[0] <= 512 and image.size[1] <= 512


def test_exif_capture_time_mismatch_is_reported_as_an_observation(tmp_path):
    exif = Image.Exif()
    exif[306] = "2024:01:01 10:00:00"
    exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
    exif_ifd[36867] = "2024:01:01 10:00:00"
    exif_ifd[36868] = "2024:01:03 10:00:00"
    image_path = tmp_path / "timestamp-mismatch.jpg"
    Image.new("RGB", (48, 48), "green").save(image_path, format="JPEG", exif=exif)

    result = analyze_image_file(image_path, "image/jpeg")

    assert result["signals"]["timestamp_mismatch"] is True
    assert any(item["code"] == "exif_timestamp_mismatch" for item in result["evidence"])


def test_aggregator_uses_inconclusive_for_low_confidence_and_never_fakes_missing_scores():
    detector_output = {
        "file_type": "image/png",
        "evidence": [],
        "limitations": [],
        "signals": {"software_editing_hint": False, "timestamp_mismatch": False, "ela_high": False},
        "ela_heatmap_base64": None,
    }
    provenance = {
        "status": "unavailable",
        "verified": None,
        "claim": None,
        "summary": "No verifier configured.",
    }

    result = aggregate_image_analysis(
        detector_output=detector_output,
        ai_output=None,
        provenance=provenance,
        sha256="a" * 64,
    )

    assert result["ai_generated"] == {"score": None, "confidence": "Low"}
    assert result["edited"] == {"score": None, "confidence": "Low"}
    assert result["status"] == "Inconclusive"
    assert {"file_type", "ai_generated", "edited", "evidence", "limitations", "language_supported"} <= result.keys()
    assert any("để trống" in item for item in result["limitations"])


def test_verified_ai_claim_can_raise_confidence_only_with_a_model_result():
    detector_output = {
        "file_type": "image/jpeg",
        "evidence": [],
        "limitations": [],
        "signals": {"software_editing_hint": False, "timestamp_mismatch": False, "ela_high": False},
        "ela_heatmap_base64": None,
    }
    result = aggregate_image_analysis(
        detector_output=detector_output,
        ai_output={"score": 91, "confidence": "High", "label": "AI-generated"},
        provenance={
            "status": "verified",
            "verified": True,
            "claim": "AI-generated",
            "summary": "Signed claim verified.",
        },
        sha256="b" * 64,
    )

    assert result["ai_generated"] == {"score": 91, "confidence": "High"}
    assert result["status"] == "Inconclusive"


def test_optional_provider_wrappers_are_explicitly_unavailable_without_configuration(monkeypatch):
    monkeypatch.delenv("IMAGE_AI_DETECTOR_URL", raising=False)
    monkeypatch.delenv("C2PA_VERIFY_URL", raising=False)
    assert RemoteImageAiDetector(endpoint="").endpoint is None
    verifier = RemoteC2PAVerifier(endpoint="")
    assert verifier.endpoint is None
