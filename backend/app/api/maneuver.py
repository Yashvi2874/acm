"""
POST /api/maneuver/schedule  →  schedule_maneuver()

Validates delta-v (km/s RTN), checks fuel budget, inserts a ScheduledBurn
into the maneuver_queue sorted by burn_time (UTC datetime).
"""
import math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from state_store import simulation_state, ScheduledBurn
from physics.maneuver import fuel_consumed
from physics.ground_station import visible_stations_eci

router = APIRouter()

MAX_DV_KMS = 0.5    # km/s — 500 m/s sanity cap


class DeltaVVector(BaseModel):
    x: float
    y: float
    z: float

class ManeuverSequenceItem(BaseModel):
    burn_id: str
    burnTime: datetime | None = None
    deltaV_vector: DeltaVVector

class ManeuverRequest(BaseModel):
    satelliteId: str
    maneuver_sequence: list[ManeuverSequenceItem]

@router.post("/schedule", summary="Schedule a maneuver for a satellite", status_code=202)
async def schedule_maneuver(req: ManeuverRequest):
    async with simulation_state.lock:
        sat = simulation_state.get_or_create_satellite(req.satelliteId)
        
        # LOS Validation
        visible = visible_stations_eci(sat.position, simulation_state.sim_time)
        has_los = len(visible) > 0
        
        if not has_los:
             # Reject standard commands during a blackout zone
             return {
                 "status": "REJECTED_LOS",
                 "validation": {
                     "ground_station_los": False,
                     "sufficient_fuel": True,
                     "projected_mass_remaining_kg": sat.mass_kg
                 }
             }

        projected_mass = sat.mass_kg

        for item in req.maneuver_sequence:
            dv = item.deltaV_vector
            dv_mag_kms = math.sqrt(dv.x**2 + dv.y**2 + dv.z**2)
            
            if dv_mag_kms > MAX_DV_KMS:
                raise HTTPException(
                    status_code=422,
                    detail=f"delta-v {dv_mag_kms:.4f} km/s exceeds limit {MAX_DV_KMS} km/s",
                )

            required_fuel = fuel_consumed(sat.mass_kg, dv_mag_kms)
            if required_fuel > sat.fuel_kg:
                return {
                    "status": "REJECTED_FUEL",
                    "validation": {
                        "ground_station_los": True,
                        "sufficient_fuel": False,
                        "projected_mass_remaining_kg": round(projected_mass, 2)
                    }
                }
            
            projected_mass -= required_fuel
            
            # Enforce 10-second signal latency
            min_burn_time = simulation_state.sim_time + timedelta(seconds=10)
            burn_time = item.burnTime or min_burn_time
            if burn_time.tzinfo is None:
                burn_time = burn_time.replace(tzinfo=timezone.utc)
                
            if burn_time < min_burn_time:
                burn_time = min_burn_time
            
            burn = ScheduledBurn(
                burn_id=item.burn_id,
                satellite_id=req.satelliteId,
                delta_v_rtn=[dv.x, dv.y, dv.z],
                burn_time=burn_time,
            )
            simulation_state.enqueue_burn(burn)

    return {
        "status": "SCHEDULED",
        "validation": {
            "ground_station_los": has_los,
            "sufficient_fuel": True,
            "projected_mass_remaining_kg": round(projected_mass, 2)
        }
    }


@router.get("/pending", summary="List all pending (unexecuted) burns")
async def list_pending():
    async with simulation_state.lock:
        return {
            "pending": [
                {
                    "burn_id": b.burn_id,
                    "satellite_id": b.satellite_id,
                    "delta_v_rtn_kms": b.delta_v_rtn,
                    "burn_time": b.burn_time.isoformat(),
                }
                for b in simulation_state.maneuver_queue
            ]
        }

@router.get("/history", summary="Get history of all executed maneuvers")
async def get_history():
    async with simulation_state.lock:
        # Sort descending by timestamp (newest first)
        history = list(reversed(simulation_state.maneuver_history))
        return {"history": history}


@router.delete("/{burn_id}", summary="Cancel a scheduled burn")
async def cancel_burn(burn_id: str):
    async with simulation_state.lock:
        before = len(simulation_state.maneuver_queue)
        simulation_state.maneuver_queue = [
            b for b in simulation_state.maneuver_queue if b.burn_id != burn_id
        ]
        removed = before - len(simulation_state.maneuver_queue)

    if not removed:
        raise HTTPException(status_code=404, detail=f"Burn {burn_id} not found")
    return {"burn_id": burn_id, "cancelled": True}


# ── Evasion + Recovery + EOL endpoints ───────────────────────────────────────

from physics.maneuver import plan_evasion_burn, plan_recovery_burn, check_eol
from physics.conjunction import time_of_closest_approach
from datetime import timedelta


class EvasionRequest(BaseModel):
    satellite_id: str
    debris_id: str
    tca_seconds: float = 3600.0


@router.post("/evasion", summary="Plan and schedule an evasion burn for a conjunction")
async def schedule_evasion(req: EvasionRequest):
    async with simulation_state.lock:
        if req.satellite_id not in simulation_state.satellites:
            raise HTTPException(status_code=404, detail="Satellite not found")
        if req.debris_id not in simulation_state.debris:
            raise HTTPException(status_code=404, detail="Debris not found")

        sat = simulation_state.satellites[req.satellite_id]
        deb = simulation_state.debris[req.debris_id]

        plan = plan_evasion_burn(
            sat.position, sat.velocity,
            deb.position, deb.velocity,
            req.tca_seconds,
        )

        dv_kms = plan["delta_v_magnitude_kms"]
        required_fuel = fuel_consumed(sat.mass_kg, dv_kms)
        if required_fuel > sat.fuel_kg:
            raise HTTPException(
                status_code=409,
                detail=f"Insufficient fuel for evasion: need {required_fuel:.6f} kg",
            )

        burn = ScheduledBurn(
            satellite_id=req.satellite_id,
            delta_v_rtn=plan["delta_v_rtn"],
            burn_time=simulation_state.sim_time,
        )
        simulation_state.enqueue_burn(burn)

        # Schedule recovery burn half-orbit later
        recovery = plan_recovery_burn(
            sat.position, sat.velocity,
            sat.nominal_slot["position"], sat.nominal_slot["velocity"],
        )
        recovery_burn_id = None
        if recovery:
            r_burn = ScheduledBurn(
                satellite_id=req.satellite_id,
                delta_v_rtn=recovery["delta_v_rtn"],
                burn_time=simulation_state.sim_time + timedelta(
                    seconds=recovery["execute_after_seconds"]
                ),
            )
            simulation_state.enqueue_burn(r_burn)
            recovery_burn_id = r_burn.burn_id

    return {
        "evasion_burn_id": burn.burn_id,
        "recovery_burn_id": recovery_burn_id,
        "evasion_plan": plan,
        "recovery_plan": recovery,
    }


@router.get("/eol/{satellite_id}", summary="Check EOL status and get graveyard burn plan")
async def eol_check(satellite_id: str):
    async with simulation_state.lock:
        if satellite_id not in simulation_state.satellites:
            raise HTTPException(status_code=404, detail="Satellite not found")
        sat = simulation_state.satellites[satellite_id]
        result = check_eol(satellite_id, sat.fuel_kg, sat.position, sat.velocity)

    if result is None:
        return {"satellite_id": satellite_id, "eol": False, "fuel_kg": sat.fuel_kg}
    return {"satellite_id": satellite_id, "eol": True, **result}
