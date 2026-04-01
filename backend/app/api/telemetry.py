import os
import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter()

GO_ADAPTER_URL = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")


@router.get("/{satellite_id}")
async def get_telemetry(satellite_id: str):
    """Fetch latest telemetry for a satellite from the Go adapter."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{GO_ADAPTER_URL}/telemetry/{satellite_id}", timeout=5.0)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            raise HTTPException(status_code=e.response.status_code, detail="Telemetry not found")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Go adapter unreachable: {e}")


@router.get("/{satellite_id}/history")
async def get_telemetry_history(satellite_id: str, limit: int = 100):
    """Fetch telemetry history for a satellite from the Go adapter."""
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


@router.post("/{satellite_id}")
async def post_telemetry(satellite_id: str, data: dict):
    """Forward telemetry data to the Go adapter for ingestion."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{GO_ADAPTER_URL}/telemetry/{satellite_id}",
                json=data,
                timeout=5.0,
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Go adapter unreachable: {e}")
