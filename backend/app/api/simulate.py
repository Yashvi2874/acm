"""
POST /api/simulate/step  →  simulate_step()

Advances sim_time by dt seconds per step for all satellites and debris:
  1. Acquire lock
  2. Pop due ScheduledBurns (burn_time <= sim_time), apply RTN→ECI delta-v
  3. RK4+J2 propagate satellites and debris (km/km/s units)
  4. Log trajectory points with UTC timestamps
  5. Run conjunction detection → emit CDMWarnings
  6. Advance sim_time by dt
  7. Release lock

Units: km / km/s throughout. Physics modules receive and return km/km/s.
"""
from datetime import timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import numpy as np

from state_store import simulation_state, CDMWarning
from physics.propagator import propagate_rk4
from physics.conjunction import check_conjunctions
from physics.maneuver import rtn_to_eci, fuel_consumed

router = APIRouter()


class StepRequest(BaseModel):
    dt: float = 10.0    # seconds per step
    steps: int = 1      # number of steps to advance


@router.post("/step", summary="Advance simulation clock by N × dt seconds")
async def simulate_step(req: StepRequest):
    if req.dt <= 0 or req.steps < 1:
        raise HTTPException(status_code=422, detail="dt must be > 0 and steps >= 1")
    if req.steps > 1000:
        raise HTTPException(status_code=422, detail="steps capped at 1000 per call")

    async with simulation_state.lock:
        if not simulation_state.satellites and not simulation_state.debris:
            raise HTTPException(
                status_code=409,
                detail="No objects in state. POST /api/telemetry first.",
            )

        for _ in range(req.steps):
            # ── 1. Apply due burns ────────────────────────────────────────
            for burn in simulation_state.pop_due_burns():
                if burn.satellite_id not in simulation_state.satellites:
                    continue
                sat = simulation_state.satellites[burn.satellite_id]
                pos = np.array(sat.position)   # km
                vel = np.array(sat.velocity)   # km/s

                dv_eci_kms = rtn_to_eci(np.array(burn.delta_v_rtn), pos, vel)
                dv_mag_kms = float(np.linalg.norm(dv_eci_kms))

                burned = fuel_consumed(sat.mass_kg, dv_mag_kms)
                sat.fuel_kg  = max(0.0, sat.fuel_kg - burned)
                sat.mass_kg  = max(sat.mass_kg - burned, sat.mass_kg * 0.5)
                sat.velocity = (vel + dv_eci_kms).tolist()
                sat.status   = "maneuver"
                burn.executed = True

            # ── 2. Propagate satellites (km/km/s native) ─────────────────
            for sat in simulation_state.satellites.values():
                result = propagate_rk4(sat.eci, req.dt, req.dt)[-1]
                sat.position = result[:3]
                sat.velocity = result[3:]

                if sat.status == "maneuver":
                    sat.status = "nominal"

                simulation_state.log_state(
                    sat.satellite_id,
                    simulation_state.sim_time,
                    sat.eci,
                )

            # ── 3. Propagate debris (km/km/s native) ─────────────────────
            for deb in simulation_state.debris.values():
                result = propagate_rk4(deb.eci, req.dt, req.dt)[-1]
                deb.position = result[:3]
                deb.velocity = result[3:]

                simulation_state.log_state(
                    deb.debris_id,
                    simulation_state.sim_time,
                    deb.eci,
                )

            # ── 4. Advance clock ──────────────────────────────────────────
            simulation_state.sim_time += timedelta(seconds=req.dt)

        # ── 5. Conjunction detection (after all steps) ────────────────────
        all_bodies = [
            {"id": sid, "position": s.position, "velocity": s.velocity}
            for sid, s in simulation_state.satellites.items()
        ] + [
            {"id": did, "position": d.position, "velocity": d.velocity}
            for did, d in simulation_state.debris.items()
        ]
        raw_conjunctions = check_conjunctions(all_bodies)

        # Emit CDMWarnings for new conjunctions (miss distance already in km from conjunction.py)
        for c in raw_conjunctions:
            warning = CDMWarning(
                object_1_id=c["sat1"],
                object_2_id=c["sat2"],
                tca=simulation_state.sim_time,
                miss_distance_km=c["miss_distance_km"],
                issued_at=simulation_state.sim_time,
            )
            simulation_state.add_cdm(warning)

        # Build response
        sat_snapshot = {
            sid: {
                "position": s.position,
                "velocity": s.velocity,
                "mass_kg": s.mass_kg,
                "fuel_kg": s.fuel_kg,
                "status": s.status,
            }
            for sid, s in simulation_state.satellites.items()
        }
        cdm_snapshot = [
            {
                "warning_id": w.warning_id,
                "object_1_id": w.object_1_id,
                "object_2_id": w.object_2_id,
                "tca": w.tca.isoformat(),
                "miss_distance_km": w.miss_distance_km,
            }
            for w in simulation_state.active_cdm_warnings
        ]

    return {
        "sim_time": simulation_state.sim_time.isoformat(),
        "steps_advanced": req.steps,
        "dt_seconds": req.dt,
        "satellites": sat_snapshot,
        "cdm_warnings": cdm_snapshot,
    }


@router.get("/state", summary="Current simulation state without advancing")
async def get_sim_state():
    async with simulation_state.lock:
        return {
            "sim_time": simulation_state.sim_time.isoformat(),
            "satellites": {
                sid: {
                    "position": s.position,
                    "velocity": s.velocity,
                    "mass_kg": s.mass_kg,
                    "fuel_kg": s.fuel_kg,
                    "status": s.status,
                    "nominal_slot": s.nominal_slot,
                }
                for sid, s in simulation_state.satellites.items()
            },
            "debris_count": len(simulation_state.debris),
            "pending_burns": len(simulation_state.maneuver_queue),
            "active_cdm_warnings": len(simulation_state.active_cdm_warnings),
        }
