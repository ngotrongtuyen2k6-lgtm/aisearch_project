import base64
import io
import warnings
from datetime import datetime
from pathlib import Path

from PIL import (
    ExifTags,
    Image,
    ImageChops,
    ImageEnhance,
    ImageOps,
    ImageStat,
    UnidentifiedImageError,
)

from app.config import MAX_IMAGE_PIXELS, SUPPORTED_MIME_FORMATS


class InvalidImage(Exception):
    pass


class UnsupportedImage(InvalidImage):
    pass


class ImageTooLarge(InvalidImage):
    pass


def validate_uploaded_image(path: Path, declared_mime: str, filename: str) -> str:
    import os

    extension = Path(os.path.basename(filename)).suffix.lower()
    rule = SUPPORTED_MIME_FORMATS.get(declared_mime)
    if not rule or extension not in rule["extensions"]:
        raise UnsupportedImage("MIME type and filename extension must both be supported and match.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                actual_format = image.format
                width, height = image.size
                if width * height > MAX_IMAGE_PIXELS:
                    raise ImageTooLarge("Image dimensions exceed the safe processing limit.")
                image.verify()
    except ImageTooLarge:
        raise
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        UnidentifiedImageError,
        OSError,
        ValueError,
    ) as error:
        raise InvalidImage("The uploaded image is damaged or cannot be decoded.") from error

    if actual_format != rule["format"]:
        raise UnsupportedImage("The file contents do not match the declared MIME type.")
    return declared_mime


def _read_capture_time(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def _ela_heatmap(image: Image.Image) -> tuple[str, float]:
    working = image.convert("RGB")
    working.thumbnail((512, 512), Image.Resampling.LANCZOS)
    recompressed = io.BytesIO()
    working.save(recompressed, format="JPEG", quality=90)
    recompressed.seek(0)
    with Image.open(recompressed) as compressed:
        difference = ImageChops.difference(working, compressed.convert("RGB"))

    gray = ImageOps.grayscale(difference)
    mean_level = float(ImageStat.Stat(gray).mean[0])
    enhanced = ImageEnhance.Contrast(gray).enhance(5)
    heatmap = ImageOps.colorize(enhanced, black="#071b45", mid="#f0a000", white="#fff7df")
    output = io.BytesIO()
    heatmap.save(output, format="PNG", optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii"), mean_level


def analyze_image_file(path: Path, file_type: str) -> dict:
    evidence: list[dict[str, str]] = []
    limitations: list[str] = [
        "Dấu hiệu thị giác và metadata chỉ mang tính heuristic, không chứng minh ảnh thật hay đã chỉnh sửa.",
        "EXIF có thể bị xóa hoặc sửa; có hay không có metadata đều không đủ để kết luận.",
    ]
    signals = {
        "software_editing_hint": False,
        "timestamp_mismatch": False,
        "ela_high": False,
    }

    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as image:
            width, height = image.size
            if width * height > MAX_IMAGE_PIXELS:
                raise ImageTooLarge("Image dimensions exceed the safe processing limit.")

            exif = image.getexif()
            exif_ifd = {}
            try:
                exif_ifd = exif.get_ifd(ExifTags.IFD.Exif)
            except (AttributeError, KeyError, TypeError, ValueError):
                exif_ifd = {}

            software = exif.get(305)
            make = exif.get(271)
            model = exif.get(272)
            if software:
                software_text = str(software).strip()[:200]
                evidence.append({
                    "code": "exif_software",
                    "kind": "observed",
                    "title": "EXIF có trường phần mềm",
                    "detail": f"Metadata ghi nhận phần mềm: {software_text}. Trường này có thể được giữ lại hoặc sửa đổi.",
                })
                software_lower = software_text.casefold()
                signals["software_editing_hint"] = any(
                    marker in software_lower
                    for marker in ("photoshop", "lightroom", "gimp", "affinity", "snapseed", "canva")
                )
            else:
                evidence.append({
                    "code": "exif_software_missing",
                    "kind": "observed",
                    "title": "Không có thông tin phần mềm trong EXIF",
                    "detail": "Không tìm thấy trường Software; metadata có thể đã bị lược bỏ.",
                })

            if not make or not model:
                evidence.append({
                    "code": "camera_metadata_missing",
                    "kind": "observed",
                    "title": "Thiếu thông tin thiết bị chụp",
                    "detail": "EXIF không có đầy đủ hãng và model máy ảnh. Việc này tự nó không chứng minh ảnh là AI.",
                })

            original_time = _read_capture_time(exif_ifd.get(36867) or exif.get(36867))
            digitized_time = _read_capture_time(exif_ifd.get(36868) or exif.get(36868))
            image_time = _read_capture_time(exif.get(306))
            timestamps = [value for value in (original_time, digitized_time, image_time) if value]
            if len(timestamps) >= 2 and max(timestamps) - min(timestamps):
                if (max(timestamps) - min(timestamps)).total_seconds() > 24 * 60 * 60:
                    signals["timestamp_mismatch"] = True
                    evidence.append({
                        "code": "exif_timestamp_mismatch",
                        "kind": "observed",
                        "title": "Các mốc thời gian EXIF không khớp",
                        "detail": "Một số trường thời gian chụp/ghi ảnh lệch nhau hơn 24 giờ; đồng hồ thiết bị hoặc chỉnh sửa metadata cũng có thể gây ra.",
                    })

            heatmap = None
            if image.format == "JPEG":
                heatmap, mean_level = _ela_heatmap(image)
                signals["ela_high"] = mean_level >= 10
                evidence.append({
                    "code": "ela_analysis",
                    "kind": "observed",
                    "title": "Đã tạo bản đồ khác biệt ELA",
                    "detail": (
                        f"Mức khác biệt trung bình: {mean_level:.2f}/255. "
                        + ("Một số vùng có sai khác cao hơn; nén JPEG nhiều lần cũng có thể tạo dấu hiệu này."
                           if signals["ela_high"]
                           else "Không thấy sai khác nổi bật theo ngưỡng tham khảo.")
                    ),
                })
            else:
                limitations.append("ELA chỉ được diễn giải cho JPEG; định dạng ảnh này không hỗ trợ so sánh ELA đáng tin cậy.")

    return {
        "file_type": file_type,
        "width": width,
        "height": height,
        "evidence": evidence,
        "limitations": limitations,
        "signals": signals,
        "ela_heatmap_base64": heatmap,
    }
