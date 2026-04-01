from fastapi import APIRouter

router = APIRouter()


@router.get("/ground-track/{satellite_id}")
def ground_track(satellite_id: str, duration: float = 5400.0):
    """Return ground track lat/lon points for a satellite."""
    return {"satellite_id": satellite_id, "ground_track": []}


@router.get("/coverage")
def coverage():
    """Return ground station coverage windows."""
    return {"coverage": []}
