from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path) -> Iterator[TestClient]:
    application = create_app(
        storage_dir=tmp_path / "uploads",
        max_upload_bytes=1024,
    )
    with TestClient(application) as test_client:
        yield test_client
