from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class SimRequest(BaseModel):
    state: list[float]   # [x, y, z, vx, vy, vz] in ECI (m, m/s)
    duration: float      # seconds
    dt: float = 10.0     # step size in seconds


@router.post("/propagate")
def propagate(req: SimRequest):
    """Propagate orbit using RK4 + J2."""
    from physics.propagator import propagate_rk4
    trajectory = propagate_rk4(req.state, req.duration, req.dt)
    return {"trajectory": trajectory}


@router.post("/conjunction")
def check_conjunction(bodies: list[dict]):
    """Check conjunction risk between satellites."""
    from physics.conjunction import check_conjunctions
    results = check_conjunctions(bodies)
    return {"conjunctions": results}
