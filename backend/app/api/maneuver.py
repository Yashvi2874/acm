from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ManeuverRequest(BaseModel):
    satellite_id: str
    delta_v: list[float]  # [dv_r, dv_t, dv_n] in RTN frame (m/s)


@router.post("/plan")
def plan_maneuver(req: ManeuverRequest):
    """Plan a maneuver given a delta-v in RTN frame."""
    from physics.maneuver import rtn_to_eci
    return {"satellite_id": req.satellite_id, "delta_v_rtn": req.delta_v}


@router.get("/history/{satellite_id}")
def maneuver_history(satellite_id: str):
    return {"satellite_id": satellite_id, "maneuvers": []}
