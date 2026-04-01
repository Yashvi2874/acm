"""
POST /api/telemetry  →  update_telemetry()

Merges incoming telemetry into SimulationState under the asyncio lock,
then forwards to the Go adapter for persistence.

Units: positions km, velocities km/s, timestamps UTC ISO-8601.
"""
import os
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from state_store import simulation_state

router = APIRouter()

GO_ADAPTER_URL = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")


class TelemetryPayload(BaseModel):
    satellite_id: str
    position: list[float] | None = None    # ECI km  [x, y, z]
    velocity: list[float] | None = None    # ECI km/s [vx, vy, vz]
    mass_kg: float | None = None
    fuel_kg: float | None = None
    status: str | None = None
    timestamp: datetime | None = None      # UTC; defaults to now
    data: dict = {}                        # arbitrary sensor readings

    @field_validator("position", "velocity")
    @classmethod
    def must_be_3(cls, v):
        if v is not None and len(v) != 3:
            raise ValueError("must have exactly 3 components")
        return v


@router.post("", summary="Ingest telemetry and update simulation state")
async def update_telemetry(payload: TelemetryPayload):
    ts = payload.timestamp or datetime.now(timezone.utc)

    async with simulation_state.lock:
        sat = simulation_state.get_or_create_satellite(payload.satellite_id)

        if payload.position is not None:
            sat.position = payload.position
        if payload.velocity is not None:
            sat.velocity = payload.velocity
        if payload.mass_kg is not None:
            sat.mass_kg = payload.mass_kg
        if payload.fuel_kg is not None:
            sat.fuel_kg = payload.fuel_kg
        if payload.status is not None:
            sat.status = payload.status  # type: ignore[assignment]

        sat.last_telemetry = payload.data
        sat.last_updated = ts

        # Advance sim clock to latest telemetry if it's ahead
        if ts > simulation_state.sim_time:
            simulation_state.sim_time = ts

    # Persist to Go adapter — non-fatal if unreachable
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{GO_ADAPTER_URL}/telemetry/{payload.satellite_id}",
                json={
                    "position": payload.position,
                    "velocity": payload.velocity,
                    "timestamp": ts.isoformat(),
                    **payload.data,
                },
                timeout=3.0,
            )
    except httpx.RequestError:
        pass

    return {
        "satellite_id": payload.satellite_id,
        "sim_time": simulation_state.sim_time.isoformat(),
        "accepted": True,
    }


@router.get("/{satellite_id}", summary="Get latest telemetry from Go adapter")
async def get_telemetry(satellite_id: str):
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{GO_ADAPTER_URL}/telemetry/{satellite_id}", timeout=5.0
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail="Telemetry not found")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Go adapter unreachable: {e}")


@router.get("/{satellite_id}/history", summary="Get telemetry history from Go adapter")
async def get_telemetry_history(satellite_id: str, limit: int = 100):
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{GO_ADAPTER_URL}/telemetry/{satellite_id}/history",
                params={"limit": limit},
                timeout=5.0,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Go adapter unreachable: {e}")
