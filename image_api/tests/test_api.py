import time

from PIL import Image
import io



def make_png(size=(24, 24)) -> bytes:
    output = io.BytesIO()
    Image.new("RGB", size, "blue").save(output, format="PNG")
    return output.getvalue()


def completed_result(client, job_id: str) -> dict:
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        job_response = client.get(f"/jobs/{job_id}")
        assert job_response.status_code == 200
        job = job_response.json()
        if job["status"] == "completed":
            result_response = client.get(f"/results/{job_id}")
            assert result_response.status_code == 200
            return result_response.json()
        if job["status"] == "failed":
            raise AssertionError(job["error"])
        time.sleep(0.01)
    raise AssertionError("Image job did not complete before timeout.")


def test_upload_job_result_schema_cache_dispute_and_file_delete(client):
    image_bytes = make_png()
    response = client.post(
        "/upload",
        files={"file": ("sample.png", image_bytes, "image/png")},
    )
    assert response.status_code == 202
    accepted = response.json()
    assert accepted["status"] == "queued"
    assert len(accepted["sha256"]) == 64

    result = completed_result(client, accepted["job_id"])
    assert list(client.app.state.image_store.directory.glob("image-*.upload")) == []
    assert result["file_type"] == "image/png"
    assert {"score", "confidence"} == result["ai_generated"].keys()
    assert {"score", "confidence"} == result["edited"].keys()
    assert isinstance(result["evidence"], list)
    assert isinstance(result["limitations"], list)
    assert result["language_supported"] == ["vi", "en"]
    assert result["status"] == "Inconclusive"

    dispute = client.post(
        f"/results/{accepted['job_id']}/dispute",
        json={"comment": "I believe this result missed relevant context."},
    )
    assert dispute.status_code == 201
    assert dispute.json()["job_id"] == accepted["job_id"]

    deleted = client.delete(f"/files/{accepted['file_id']}")
    assert deleted.status_code == 204

    cached = client.post(
        "/upload",
        files={"file": ("sample.png", image_bytes, "image/png")},
    )
    assert cached.status_code == 202
    assert cached.json()["cached"] is True
    assert cached.json()["status"] == "completed"
    assert cached.json()["file_id"] is None


def test_upload_rejects_mime_extension_mismatch_and_corrupt_images(client):
    image_bytes = make_png()

    wrong_mime = client.post(
        "/upload",
        files={"file": ("sample.png", image_bytes, "image/jpeg")},
    )
    assert wrong_mime.status_code == 415

    wrong_extension = client.post(
        "/upload",
        files={"file": ("sample.jpg", image_bytes, "image/png")},
    )
    assert wrong_extension.status_code == 415

    corrupt = client.post(
        "/upload",
        files={"file": ("broken.png", b"not an image", "image/png")},
    )
    assert corrupt.status_code == 422


def test_upload_rejects_oversized_files(client):
    response = client.post(
        "/upload",
        files={"file": ("large.png", b"x" * (1024 + 1), "image/png")},
    )
    assert response.status_code == 413
    assert "1 KB" in response.json()["detail"]


def test_upload_rate_limit_is_five_requests_per_minute(client):
    statuses = [
        client.post("/upload", headers={"Origin": "http://localhost:5173"}).status_code
        for _ in range(6)
    ]
    assert statuses[:5] == [422] * 5
    assert statuses[5] == 429
    response = client.post("/upload", headers={"Origin": "http://localhost:5173"})
    assert "5 yêu cầu" in response.json()["detail"]
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


