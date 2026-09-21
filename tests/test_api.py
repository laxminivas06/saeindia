"""
Automated Test Suite for QR Box Detection Receiver API
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app, storage

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_storage():
    storage.clear()
    yield
    storage.clear()


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "total_scans" in data


def test_post_plain_qr_result():
    payload = {
        "box_id": "BOX001",
        "qr_data": "BOX001",
        "device_id": "PHONE001",
        "timestamp": "2026-09-15T19:30:00Z"
    }
    response = client.post("/api/qr-result", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "success"
    assert data["record"]["box_id"] == "BOX001"
    assert data["record"]["qr_data"] == "BOX001"


def test_post_json_qr_result():
    payload = {
        "box_id": "BOX_TARGET_9",
        "qr_data": {
            "box_id": "BOX_TARGET_9",
            "mission_id": "MISSION_ALPHA",
            "cargo": "SENSORS"
        },
        "device_id": "PHONE_FIELD_02",
        "metrics": {
            "sharpness": 88.4,
            "size_ratio": 32.5,
            "zoom_level": 1.6
        }
    }
    response = client.post("/api/qr-result", json=payload)
    assert response.status_code == 201
    record = response.json()["record"]
    assert record["box_id"] == "BOX_TARGET_9"
    assert record["qr_data"]["mission_id"] == "MISSION_ALPHA"
    assert record["metrics"]["sharpness"] == 88.4


def test_get_qr_results_and_search():
    # Insert multiple test records
    client.post("/api/qr-result", json={"box_id": "BOX001", "qr_data": "DATA1", "device_id": "DEV1"})
    client.post("/api/qr-result", json={"box_id": "BOX002", "qr_data": "DATA2", "device_id": "DEV2"})
    client.post("/api/qr-result", json={"box_id": "CARGO_A", "qr_data": "DATA3", "device_id": "DEV1"})

    # Get all
    res = client.get("/api/qr-results")
    assert res.status_code == 200
    assert res.json()["total"] == 3

    # Search filter by box_id
    res_search = client.get("/api/qr-results?q=CARGO")
    assert res_search.status_code == 200
    assert res_search.json()["count"] == 1
    assert res_search.json()["results"][0]["box_id"] == "CARGO_A"


def test_get_latest_qr_result():
    client.post("/api/qr-result", json={"box_id": "FIRST", "qr_data": "1"})
    client.post("/api/qr-result", json={"box_id": "LATEST_BOX", "qr_data": "2"})

    res = client.get("/api/qr-results/latest")
    assert res.status_code == 200
    assert res.json()["record"]["box_id"] == "LATEST_BOX"


def test_clear_qr_results():
    client.post("/api/qr-result", json={"box_id": "BOX_TO_DELETE", "qr_data": "DEL"})
    assert client.get("/api/qr-results").json()["total"] == 1

    del_res = client.delete("/api/qr-results")
    assert del_res.status_code == 200
    assert client.get("/api/qr-results").json()["total"] == 0
