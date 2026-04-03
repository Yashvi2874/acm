"""
POST /api/telemetry  — spec-exact bulk ingestion endpoint

Spec format:
  {
    "timestamp": "2026-03-12T08:00:00.000Z",
    "objects": [
      {"id": "DEB-99421", "type": "DEBRIS",
       "r": {"x": 4500.2, "y": -2100.5, "z": 4800.1},
       "v": {"x": -1.25,  "y": 6.84,    "z": 3.12}}
    ]
  }

Response:
  {"status": "ACK", "processed_count": 1, "active_cdm_warnings": 3}
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from state_store import simulation_state

router = APIRouter()
GO_ADAPTER_URL = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")

# Track last processed timestamp per object ID to handle rapid updates
_last_processed = {}


# ── Spec-exact request models ─────────────────────────────────────────────────

class Vec3(BaseModel):
    x: float
    y: float
    z: float


class TelemetryObject(BaseModel):
    id: str
    type: str          # "SATELLITE" | "DEBRIS"
    r: Vec3            # position km
    v: Vec3            # velocity km/s
    mass_kg: float | None = None
    fuel_kg: float | None = None
    status: str | None = None


class TelemetryBatch(BaseModel):
    timestamp: datetime
    objects: list[TelemetryObject]


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("", summary="Bulk telemetry ingestion — spec-exact format")
async def ingest_telemetry(batch: TelemetryBatch):
    ts = batch.timestamp.replace(tzinfo=timezone.utc) if batch.timestamp.tzinfo is None \
         else batch.timestamp

    async with simulation_state.lock:
        for obj in batch.objects:
            obj_id = obj.id
            last_ts = _last_processed.get(obj_id)
            if last_ts and (ts - last_ts) < timedelta(seconds=1):
                # Incoming telemetry of same ID within last second: override queue when collisions
                # Skip processing to avoid rapid duplicate updates
                continue
            
            pos = [obj.r.x, obj.r.y, obj.r.z]
            vel = [obj.v.x, obj.v.y, obj.v.z]

            if obj.type.upper() == "DEBRIS":
                deb = simulation_state.get_or_create_debris(obj_id, pos, vel)
                deb.position = pos
                deb.velocity = vel
                deb.db_velocity = list(vel)
                deb.last_updated = ts
            else:
                # SATELLITE or any other controllable object
                sat = simulation_state.get_or_create_satellite(obj_id)
                sat.position = pos
                sat.velocity = vel
                sat.db_velocity = list(vel)
                sat.velocity_dirty = False
                if obj.mass_kg is not None:
                    sat.mass_kg = obj.mass_kg
                if obj.fuel_kg is not None:
                    sat.fuel_kg = obj.fuel_kg
                    sat.initial_fuel_kg = max(sat.initial_fuel_kg, obj.fuel_kg)
                if obj.status is not None:
                    sat.status = obj.status  # type: ignore[assignment]
                sat.last_updated = ts
            
            _last_processed[obj_id] = ts

        # Advance sim clock
        if ts > simulation_state.sim_time:
            simulation_state.sim_time = ts

        active_cdm = len(simulation_state.active_cdm_warnings)

    # Fire-and-forget persist to Go adapter
    asyncio.create_task(_persist_batch(ts, batch.objects))

    return {
        "status": "ACK",
        "processed_count": len(batch.objects),
        "active_cdm_warnings": active_cdm,
    }


async def _persist_batch(ts: datetime, objects: list[TelemetryObject]) -> None:
    payload = {
        "timestamp": ts.isoformat(),
        "objects": [
            {
                "id": o.id,
                "type": o.type,
                "r": {"x": o.r.x, "y": o.r.y, "z": o.r.z},
                "v": {"x": o.v.x, "y": o.v.y, "z": o.v.z},
            }
            for o in objects
        ],
    }
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{GO_ADAPTER_URL}/log/telemetry",
                json=payload,
                timeout=3.0,
            )
    except Exception:
        pass


# ── GET endpoints (read from Go adapter / Atlas) ──────────────────────────────

@router.get("/objects", summary="Get all current objects from Atlas")
async def get_all_objects():
    """Returns latest state of all satellites and debris from Atlas."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{GO_ADAPTER_URL}/objects", timeout=5.0)
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError:
            # Fallback: return in-memory state
            async with simulation_state.lock:
                return {
                    "satellites": [
                        {"id": sid, "type": "SATELLITE",
                         "r": {"x": s.position[0], "y": s.position[1], "z": s.position[2]},
                         "v": {"x": s.velocity[0], "y": s.velocity[1], "z": s.velocity[2]},
                         "status": s.status, "fuel_kg": s.fuel_kg}
                        for sid, s in simulation_state.satellites.items()
                    ],
                    "debris": [
                        {"id": did, "type": "DEBRIS",
                         "r": {"x": d.position[0], "y": d.position[1], "z": d.position[2]},
                         "v": {"x": d.velocity[0], "y": d.velocity[1], "z": d.velocity[2]}}
                        for did, d in simulation_state.debris.items()
                    ],
                }


@router.get("/{object_id}", summary="Get latest telemetry for one object")
async def get_object_telemetry(object_id: str):
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{GO_ADAPTER_URL}/telemetry/{object_id}", timeout=5.0
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError:
            pass
    # Fallback to in-memory
    async with simulation_state.lock:
        if object_id in simulation_state.satellites:
            s = simulation_state.satellites[object_id]
            return {"id": object_id, "type": "SATELLITE",
                    "r": {"x": s.position[0], "y": s.position[1], "z": s.position[2]},
                    "v": {"x": s.velocity[0], "y": s.velocity[1], "z": s.velocity[2]}}
        if object_id in simulation_state.debris:
            d = simulation_state.debris[object_id]
            return {"id": object_id, "type": "DEBRIS",
                    "r": {"x": d.position[0], "y": d.position[1], "z": d.position[2]},
                    "v": {"x": d.velocity[0], "y": d.velocity[1], "z": d.velocity[2]}}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"{object_id} not found")


# ── Admin endpoints ────────────────────────────────────────────────────────────

@router.post("/admin/clear", summary="Clear all satellites and debris from Atlas")
async def clear_database():
    """
    Clear all satellites and debris from MongoDB Atlas via Go adapter.
    
    This sends a request to the Go adapter to drop both collections
    and clear the in-memory simulation state.
    
    Response:
      {"status": "ACK", "message": "Database cleared"}
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{GO_ADAPTER_URL}/admin/clear",
                timeout=10.0,
            )
            resp.raise_for_status()
            result = resp.json()
            
            # Also clear in-memory state
            async with simulation_state.lock:
                simulation_state.satellites.clear()
                simulation_state.debris.clear()
                simulation_state.cdm_warnings.clear()
                
            return result
    except httpx.RequestError as e:
        # If Go adapter is unavailable, just clear in-memory state
        async with simulation_state.lock:
            simulation_state.satellites.clear()
            simulation_state.debris.clear()
            simulation_state.cdm_warnings.clear()
        
        return {
            "status": "PARTIAL",
            "message": "Cleared in-memory state only (Go adapter unavailable)",
        }
