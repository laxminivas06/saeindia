"""
FastAPI Backend for Responsive Mobile QR Box Detection & Auto-Scanning Application.
Provides REST API, WebSocket real-time live push updates, JSON persistence, and static file serving.
"""

import os
import json
import asyncio
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "backend" / "data"
FRONTEND_DIR = BASE_DIR / "frontend"
STORAGE_FILE = DATA_DIR / "scans.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="QR Box Scanner Receiver API",
    description="Autonomous Mobile QR Box Detection & Receiver Engine",
    version="1.0.0"
)

# Enable CORS for cross-device mobile field scanning
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Data Models ---
class QRResultPayload(BaseModel):
    box_id: Optional[str] = Field(default="UNKNOWN", description="Identifier of the target box")
    qr_data: Any = Field(..., description="Extracted payload (string, dict, etc.)")
    device_id: Optional[str] = Field(default="PHONE001", description="Device identifier of scanner")
    timestamp: Optional[str] = Field(default_factory=utc_now_iso)
    metrics: Optional[Dict[str, Any]] = Field(default=None, description="Detection telemetry (sharpness, zoom, size, etc.)")
    raw_payload: Optional[str] = Field(default=None, description="Original unparsed string")


class ConnectionManager:
    """Manages active WebSocket connections for real-time dashboard updates."""
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for dead in disconnected:
            self.disconnect(dead)


manager = ConnectionManager()


# --- In-Memory & Persistent Storage ---
class ScanStorage:
    def __init__(self, filepath: Path):
        self.filepath = filepath
        self.records: List[Dict[str, Any]] = []
        self._load()

    def _load(self):
        if self.filepath.exists():
            try:
                with open(self.filepath, "r", encoding="utf-8") as f:
                    self.records = json.load(f)
            except Exception:
                self.records = []
        else:
            self.records = []

    def _save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.records, f, indent=2)
        except Exception as e:
            print(f"Error persisting scan records: {e}")

    def add(self, item: Dict[str, Any]) -> Dict[str, Any]:
        item_id = f"SCAN-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
        record = {
            "id": item_id,
            "received_at": utc_now_iso(),
            **item
        }
        self.records.insert(0, record)  # Newest first
        if len(self.records) > 1000:
            self.records = self.records[:1000]
        self._save()
        return record

    def get_all(self, limit: int = 100, query: Optional[str] = None) -> List[Dict[str, Any]]:
        if not query:
            return self.records[:limit]
        q = query.lower()
        filtered = [
            r for r in self.records
            if q in str(r.get("box_id", "")).lower()
            or q in str(r.get("qr_data", "")).lower()
            or q in str(r.get("device_id", "")).lower()
        ]
        return filtered[:limit]

    def get_latest(self) -> Optional[Dict[str, Any]]:
        return self.records[0] if self.records else None

    def clear(self):
        self.records = []
        self._save()


storage = ScanStorage(STORAGE_FILE)


# --- API Routes ---

@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "service": "QR Box Receiver API",
        "timestamp": utc_now_iso(),
        "total_scans": len(storage.records),
        "active_receivers": len(manager.active_connections)
    }


@app.post("/api/qr-result", status_code=status.HTTP_201_CREATED)
async def receive_qr_result(payload: QRResultPayload):
    """
    Ingest scanned QR data from a mobile camera client.
    Broadcasts the scan event to all live receiver dashboard clients.
    """
    data = payload.model_dump()
    if not data.get("timestamp"):
        data["timestamp"] = utc_now_iso()
        
    # Auto-extract box_id if structured inside qr_data
    if (not data.get("box_id") or data["box_id"] == "UNKNOWN") and isinstance(data.get("qr_data"), dict):
        data["box_id"] = data["qr_data"].get("box_id") or data["qr_data"].get("boxId") or "UNKNOWN"

    record = storage.add(data)

    # Broadcast to all live receiver dashboards
    await manager.broadcast({
        "event": "new_scan",
        "data": record
    })

    return {
        "status": "success",
        "message": "QR result received and broadcasted",
        "record": record
    }


@app.get("/api/qr-results")
async def list_qr_results(
    limit: int = Query(100, ge=1, le=1000),
    q: Optional[str] = Query(None, description="Search query")
):
    """Retrieve scan detection history with optional search filtering."""
    results = storage.get_all(limit=limit, query=q)
    return {
        "count": len(results),
        "total": len(storage.records),
        "results": results
    }


@app.get("/api/qr-results/latest")
async def get_latest_qr_result():
    """Get the most recent QR scan result."""
    latest = storage.get_latest()
    if not latest:
        return JSONResponse(status_code=200, content={"status": "empty", "record": None})
    return {"status": "success", "record": latest}


@app.delete("/api/qr-results")
async def clear_qr_results():
    """Clear all scan records from memory and disk."""
    storage.clear()
    await manager.broadcast({
        "event": "history_cleared"
    })
    return {"status": "success", "message": "History cleared"}


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket stream for real-time receiver dashboard telemetry and live push updates."""
    await manager.connect(websocket)
    try:
        await websocket.send_json({
            "event": "connected",
            "message": "Connected to QR Box Receiver live stream",
            "total_scans": len(storage.records),
            "latest": storage.get_latest()
        })
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Mount static assets and frontend index
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")
