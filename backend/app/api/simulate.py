"""
POST /api/simulate/step  →  simulate_step()

Tick handler — per step:
  1. Execute due burns: cooldown check, delta-v apply, Tsiolkovsky fuel deduct
  2. Propagate satellites + debris (RK4+J2, km/km/s, sub-steps ≤ 30s)
  3. Propagate nominal ghost orbit (same RK4, no maneuvers)
  4. Station-keeping check: drift > 10 km → status warning
  5. EOL check: fuel < threshold → flag EOL
  6. Conjunction assessment → CDMWarnings
  7. Fire-and-forget persist to Go adapter
  8. Return collisions_detected, maneuvers_executed
"""
from __future__ import annotations

import asyncio
from datetime import timedelta, datetime, timezone

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from state_store import simulation_state, CDMWarning, ScheduledBurn
from physics.propagator import propagate_rk2, propagate_rk4
from physics.conjunction import check_conjunctions
from physics.maneuver import rtn_to_eci, fuel_consumed, check_eol, validate_burn_limit, plan_recovery_burn
from physics.constants import BURN_COOLDOWN_S, STATION_KEEP_KM

router = APIRouter()

import os
GO_ADAPTER_URL = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")
INTEGRATOR_METHOD = os.getenv("INTEGRATOR_METHOD", "rk4").lower()


async def _post(url: str, payload: dict) -> None:
    """Fire-and-forget HTTP POST — never raises, never blocks the sim tick."""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(url, json=payload, timeout=2.0)
    except Exception:
        pass


async def _persist_snapshot(
    sim_time: str,
    sat_snapshot: dict,
    maneuvers: list[dict],
    cdm_warnings: list[dict],
    collisions: list[dict],
) -> None:
    base = GO_ADAPTER_URL
    # Bulk telemetry snapshot
    asyncio.create_task(_post(f"{base}/log/telemetry", {
        "timestamp": sim_time,
        "objects": [
            {"id": sid, **s} for sid, s in sat_snapshot.items()
        ],
    }))
    # Individual maneuver logs
    for m in maneuvers:
        asyncio.create_task(_post(f"{base}/log/maneuver", {
            "satellite_id":    m["satellite_id"],
            "burn_id":         m["burn_id"],
            "deltaV":          m["delta_v_kms"],
            "fuel_remaining":  m["fuel_remaining_kg"],
            "timestamp":       sim_time,
        }))
    # CDM logs
    for c in cdm_warnings:
        asyncio.create_task(_post(f"{base}/log/cdm", {
            "sat_id":       c["object_1_id"],
            "deb_id":       c["object_2_id"],
            "tca":          c["tca"],
            "miss_distance": c["miss_distance_km"],
        }))
    # Collision logs (CRITICAL severity)
    for col in collisions:
        asyncio.create_task(_post(f"{base}/log/collision", {
            "sat_id":    col["object_1_id"],
            "deb_id":    col["object_2_id"],
            "timestamp": sim_time,
        }))


class InitObject(BaseModel):
    id: str
    object_type: str          # "satellite" or "debris"
    position: list[float]     # ECI km [x, y, z]
    velocity: list[float]     # ECI km/s [vx, vy, vz]
    fuel_kg: float = 0.5
    mass_kg: float = 4.0
    status: str = "nominal"


class InitRequest(BaseModel):
    objects: list[InitObject]


@router.post("/init", summary="Seed simulation state with satellites and debris")
async def init_simulation(req: InitRequest):
    """
    Replaces the current simulation state with the provided objects.
    Call this once on frontend startup to register all satellites and debris.
    """
    async with simulation_state.lock:
        simulation_state.satellites.clear()
        simulation_state.debris.clear()
        simulation_state.maneuver_queue.clear()
        simulation_state.cdm_warnings.clear()
        simulation_state.trajectory_log.clear()
        simulation_state.sim_time = datetime.now(timezone.utc)

        for obj in req.objects:
            if obj.object_type == "satellite":
                sat = simulation_state.get_or_create_satellite(obj.id)
                sat.position = list(obj.position)
                sat.velocity = list(obj.velocity)
                sat.fuel_kg = obj.fuel_kg
                sat.initial_fuel_kg = obj.fuel_kg
                sat.mass_kg = obj.mass_kg
                sat.status = obj.status  # type: ignore[assignment]
                sat.nominal_slot = {
                    "position": list(obj.position),
                    "velocity": list(obj.velocity),
                }
            else:
                simulation_state.get_or_create_debris(obj.id, obj.position, obj.velocity)

    return {"initialized": len(req.objects), "sim_time": simulation_state.sim_time.isoformat()}


class StepRequest(BaseModel):
    step_seconds: float
    force_recompute_from_db: bool = False


@router.post("/step", summary="Advance simulation by N ticks of dt seconds")
async def simulate_step(req: StepRequest):
    if req.step_seconds <= 0:
        raise HTTPException(status_code=422, detail="step_seconds must be > 0")

    dt_step = min(req.step_seconds, 10.0)
    steps = int(req.step_seconds / dt_step)
    if steps == 0:
        steps = 1
        dt_step = req.step_seconds

    maneuvers_executed: list[dict] = []
    cooldown_rejected:  list[dict] = []

    async with simulation_state.lock:
        if req.force_recompute_from_db:
            # Extreme test mode: recompute from DB
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{GO_ADAPTER_URL}/objects", timeout=5.0)
                    resp.raise_for_status()
                    data = resp.json()
                    # Update state from DB
                    for sat_data in data.get("satellites", []):
                        sat = simulation_state.get_or_create_satellite(sat_data["id"])
                        sat.position = [sat_data["r"]["x"], sat_data["r"]["y"], sat_data["r"]["z"]]
                        sat.velocity = [sat_data["v"]["x"], sat_data["v"]["y"], sat_data["v"]["z"]]
                        if "fuel_kg" in sat_data:
                            sat.fuel_kg = sat_data["fuel_kg"]
                        if "status" in sat_data:
                            sat.status = sat_data["status"]
                        sat.last_updated = datetime.fromisoformat(sat_data.get("updated_at", simulation_state.sim_time.isoformat())).replace(tzinfo=timezone.utc)
                    for deb_data in data.get("debris", []):
                        deb = simulation_state.get_or_create_debris(deb_data["id"], 
                            [deb_data["r"]["x"], deb_data["r"]["y"], deb_data["r"]["z"]], 
                            [deb_data["v"]["x"], deb_data["v"]["y"], deb_data["v"]["z"]])
                        deb.position = [deb_data["r"]["x"], deb_data["r"]["y"], deb_data["r"]["z"]]
                        deb.velocity = [deb_data["v"]["x"], deb_data["v"]["y"], deb_data["v"]["z"]]
                        deb.last_updated = datetime.fromisoformat(deb_data.get("updated_at", simulation_state.sim_time.isoformat())).replace(tzinfo=timezone.utc)
            except Exception as e:
                # Log but continue
                print(f"Failed to recompute from DB: {e}")

        if not simulation_state.satellites and not simulation_state.debris:
            raise HTTPException(
                status_code=409,
                detail="No objects in state. POST /api/telemetry first.",
            )

        for _step in range(steps):
            t_now = simulation_state.sim_time

            # ── 1. Execute due burns ──────────────────────────────────────
            for burn in simulation_state.pop_due_burns():
                if burn.satellite_id not in simulation_state.satellites:
                    continue
                sat = simulation_state.satellites[burn.satellite_id]

                # Cooldown enforcement: reject if < 600s since last burn
                if sat.last_burn_time is not None:
                    elapsed = (t_now - sat.last_burn_time).total_seconds()
                    if elapsed < BURN_COOLDOWN_S:
                        cooldown_rejected.append({
                            "burn_id":     burn.burn_id,
                            "satellite_id": burn.satellite_id,
                            "reason":      f"cooldown: {elapsed:.0f}s < {BURN_COOLDOWN_S}s",
                        })
                        continue

                pos = np.array(sat.position)
                vel = np.array(sat.velocity)
                state = np.concatenate([pos, vel])
                dv_eci = rtn_to_eci(np.array(burn.delta_v_rtn), state)
                dv_mag = float(np.linalg.norm(dv_eci))

                # Validate burn limit
                try:
                    validate_burn_limit(dv_mag)
                except BurnLimitExceeded as e:
                    cooldown_rejected.append({
                        "burn_id":     burn.burn_id,
                        "satellite_id": burn.satellite_id,
                        "reason":      str(e),
                    })
                    continue
                
                burned    = fuel_consumed(sat.mass_kg, dv_mag)

                sat.fuel_kg       = max(0.0, sat.fuel_kg - burned)
                sat.mass_kg       = max(sat.mass_kg - burned, sat.mass_kg * 0.5)
                sat.velocity      = (vel + dv_eci).tolist()
                sat.status        = "maneuver"
                sat.last_burn_time = t_now
                burn.executed     = True

                maneuvers_executed.append({
                    "burn_id":          burn.burn_id,
                    "satellite_id":     burn.satellite_id,
                    "delta_v_kms":      dv_mag,
                    "fuel_burned_kg":   burned,
                    "fuel_remaining_kg": sat.fuel_kg,
                })

                # Write updated velocity to Atlas immediately after burn
                from atlas_sync import upsert_satellite_velocity
                asyncio.create_task(asyncio.get_event_loop().run_in_executor(
                    None, upsert_satellite_velocity,
                    burn.satellite_id, sat.position, sat.velocity,
                    sat.fuel_kg, sat.mass_kg,
                ))

            # ── 2. Propagate satellites ───────────────────────────────────
            for sat in simulation_state.satellites.values():
                if INTEGRATOR_METHOD == "rk2":
                    result = propagate_rk2(sat.eci, dt_step, dt_step)
                    nom = propagate_rk2(sat.nominal_eci, dt_step, dt_step)
                else:
                    result = propagate_rk4(sat.eci, dt_step, dt_step)
                    nom = propagate_rk4(sat.nominal_eci, dt_step, dt_step)

                sat.position = result[-1][:3]
                sat.velocity = result[-1][3:]
                sat.nominal_slot["position"] = nom[-1][:3]
                sat.nominal_slot["velocity"] = nom[-1][3:]

                # ── 4. Station-keeping check ──────────────────────────────
                sat.total_seconds += dt_step
                if sat.drift_km <= STATION_KEEP_KM:
                    sat.uptime_seconds += dt_step
                    if sat.status not in ("maneuver", "safe-hold", "comms-loss"):
                        sat.status = "nominal"
                else:
                    # Out-of-box drift triggers service outage state
                    if sat.status != "safe-hold":
                        sat.status = "safe-hold"
                        # Schedule immediate recovery burn to nominal slot
                        rec = plan_recovery_burn(
                            sat.position, sat.velocity,
                            sat.nominal_slot["position"], sat.nominal_slot["velocity"],
                        )
                        if rec and rec["delta_v_magnitude_kms"] > 0:
                            sim_burn = ScheduledBurn(
                                satellite_id=sat.satellite_id,
                                delta_v_rtn=rec["delta_v_rtn"],
                                burn_time=simulation_state.sim_time + timedelta(seconds=60),
                            )
                            simulation_state.enqueue_burn(sim_burn)

                # Reset maneuver flag after tick
                if sat.status == "maneuver":
                    sat.status = "nominal"

                simulation_state.log_state(sat.satellite_id, t_now, sat.eci)

            # ── 5. Propagate debris ───────────────────────────────────────
            for deb in simulation_state.debris.values():
                if INTEGRATOR_METHOD == "rk2":
                    result = propagate_rk2(deb.eci, dt_step, dt_step)
                else:
                    result = propagate_rk4(deb.eci, dt_step, dt_step)
                deb.position = result[-1][:3]
                deb.velocity = result[-1][3:]
                simulation_state.log_state(deb.debris_id, t_now, deb.eci)

            # ── Advance clock ─────────────────────────────────────────────
            simulation_state.sim_time += timedelta(seconds=dt_step)

        # ── 6. EOL check (after all steps) ───────────────────────────────
        eol_flags: list[dict] = []
        for sid, sat in simulation_state.satellites.items():
            eol = check_eol(sid, sat.fuel_kg, sat.position, sat.velocity)
            if eol:
                sat.status = "decommissioned"
                eol_flags.append(eol)

        # ── 7. Conjunction assessment ─────────────────────────────────────
        all_bodies = (
            [{"id": sid, "position": s.position, "velocity": s.velocity}
             for sid, s in simulation_state.satellites.items()]
            + [{"id": did, "position": d.position, "velocity": d.velocity}
               for did, d in simulation_state.debris.items()]
        )
        raw_conjunctions = check_conjunctions(all_bodies)
        for c in raw_conjunctions:
            simulation_state.add_cdm(CDMWarning(
                object_1_id=c["sat1"],
                object_2_id=c["sat2"],
                tca=simulation_state.sim_time,
                miss_distance_km=c["miss_distance_km"],
                issued_at=simulation_state.sim_time,
            ))

        # Build response snapshot
        sat_snapshot = {
            sid: {
                "position":        s.position,
                "velocity":        s.velocity,
                "mass_kg":         s.mass_kg,
                "fuel_kg":         s.fuel_kg,
                "status":          s.status,
                "drift_km":        round(s.drift_km, 3),
                "uptime_pct":      round(100.0 * s.uptime_seconds / max(s.total_seconds, 1), 2),
            }
            for sid, s in simulation_state.satellites.items()
        }
        cdm_snapshot = [
            {
                "warning_id":       w.warning_id,
                "object_1_id":      w.object_1_id,
                "object_2_id":      w.object_2_id,
                "tca":              w.tca.isoformat(),
                "miss_distance_km": w.miss_distance_km,
                "severity":         "CRITICAL" if w.miss_distance_km < 0.100 else "WARNING",
            }
            for w in simulation_state.active_cdm_warnings
        ]

    # ── 8. Fire-and-forget persist ────────────────────────────────────────
    collisions = [w for w in cdm_snapshot if w["severity"] == "CRITICAL"]
    asyncio.create_task(_persist_snapshot(
        sim_time=simulation_state.sim_time.isoformat(),
        sat_snapshot=sat_snapshot,
        maneuvers=maneuvers_executed,
        cdm_warnings=cdm_snapshot,
        collisions=collisions,
    ))

    return {
        "status": "STEP_COMPLETE",
        "new_timestamp": simulation_state.sim_time.isoformat(),
        "collisions_detected": len([c for c in cdm_snapshot if c["severity"] == "CRITICAL"]),
        "maneuvers_executed": len(maneuvers_executed)
    }


@router.get("/state", summary="Current simulation state without advancing")
async def get_sim_state():
    async with simulation_state.lock:
        return {
            "sim_time": simulation_state.sim_time.isoformat(),
            "satellites": {
                sid: {
                    "position":    s.position,
                    "velocity":    s.velocity,
                    "mass_kg":     s.mass_kg,
                    "fuel_kg":     s.fuel_kg,
                    "status":      s.status,
                    "drift_km":    round(s.drift_km, 3),
                    "uptime_pct":  round(100.0 * s.uptime_seconds / max(s.total_seconds, 1), 2),
                    "nominal_slot": s.nominal_slot,
                }
                for sid, s in simulation_state.satellites.items()
            },
            "debris_count":        len(simulation_state.debris),
            "pending_burns":       len(simulation_state.maneuver_queue),
            "active_cdm_warnings": len(simulation_state.active_cdm_warnings),
        }


@router.get("/config", summary="Simulation configuration and dynamic population stats")
async def get_sim_config():
    async with simulation_state.lock:
        return {
            "satellite_count": len(simulation_state.satellites),
            "debris_count": len(simulation_state.debris),
            "station_keeping_radius_km": STATION_KEEP_KM,
            "burn_cooldown_s": BURN_COOLDOWN_S,
            "integrator": INTEGRATOR_METHOD,
        }


import math as _math


def _orbital_radius(pos: list[float]) -> float:
    return _math.sqrt(sum(x * x for x in pos))


def _inclination(pos: list[float], vel: list[float]) -> float:
    """Inclination of the current orbit plane in radians."""
    # h = r × v
    hx = pos[1] * vel[2] - pos[2] * vel[1]
    hy = pos[2] * vel[0] - pos[0] * vel[2]
    hz = pos[0] * vel[1] - pos[1] * vel[0]
    h = _math.sqrt(hx * hx + hy * hy + hz * hz)
    if h == 0:
        return 0.0
    return _math.acos(max(-1.0, min(1.0, hz / h)))


def _orbit_phase(pos: list[float], inc: float) -> float:
    """Approximate current phase angle in the orbit plane (radians)."""
    # Project position onto the equatorial plane and compute angle
    return _math.atan2(pos[1], pos[0])


_STATUS_FRONTEND = {
    "nominal":        "nominal",
    "maneuver":       "nominal",
    "safe-hold":      "warning",
    "comms-loss":     "warning",
    "decommissioned": "critical",
}


@router.get("/snapshot", summary="Simulation snapshot in frontend-compatible shape")
async def get_snapshot():
    """
    Returns satellites and debris in the exact shape the React frontend expects.
    Each satellite includes a live `conjunctions` array computed from current positions
    using the linear TCA formula — ready for the DetailPanel proximity display.
    """
    async with simulation_state.lock:
        # ── Build per-satellite conjunction data ──────────────────────────
        # Gather all bodies (sats + debris) for proximity check
        import numpy as np
        from physics.conjunction import compute_tca, compute_relative_state

        COARSE_KM = 500.0          # only check objects within this radius
        SAFETY_KM = 0.100          # 100 m violation threshold
        T_WINDOW  = 5400.0         # 90-minute lookahead

        all_bodies: list[dict] = []
        for sid, sat in simulation_state.satellites.items():
            all_bodies.append({"id": sid, "type": "sat",
                                "pos": sat.position, "vel": sat.velocity})
        for did, deb in simulation_state.debris.items():
            all_bodies.append({"id": did, "type": "deb",
                                "pos": deb.position, "vel": deb.velocity})

        # Build per-satellite conjunction list
        sat_conjunctions: dict[str, list[dict]] = {
            sid: [] for sid in simulation_state.satellites
        }

        for sid in simulation_state.satellites:
            sat = simulation_state.satellites[sid]
            sat_pos = np.array(sat.position)

            for body in all_bodies:
                if body["id"] == sid:
                    continue
                body_pos = np.array(body["pos"])
                current_sep = float(np.linalg.norm(sat_pos - body_pos))
                if current_sep > COARSE_KM:
                    continue

                state_a = np.array(sat.position + sat.velocity)
                state_b = np.array(body["pos"] + body["vel"])
                tau, d_min, dr_tca = compute_tca(state_a, state_b)

                # Include if TCA is in future window OR currently very close
                if (0 <= tau <= T_WINDOW) or current_sep < COARSE_KM * 0.1:
                    sat_conjunctions[sid].append({
                        "object_b_id":    body["id"],
                        "d_min_km":       round(d_min, 4),
                        "current_sep_km": round(current_sep, 4),
                        "tau_seconds":    round(tau, 2),
                        "tau_minutes":    round(tau / 60, 2),
                        "is_violation":   d_min < SAFETY_KM,
                        "delta_r_tca":    [round(x, 4) for x in dr_tca.tolist()],
                    })

            # Sort by d_min ascending — most dangerous first
            sat_conjunctions[sid].sort(key=lambda e: e["d_min_km"])

        # ── CDM risk pairs ────────────────────────────────────────────────
        risk_pairs: dict[str, str] = {}
        for w in simulation_state.active_cdm_warnings:
            risk_pairs[w.object_1_id] = w.object_2_id
            risk_pairs[w.object_2_id] = w.object_1_id

        # Also flag from live conjunctions
        for sid, conjs in sat_conjunctions.items():
            if conjs and conjs[0]["is_violation"]:
                risk_pairs.setdefault(sid, conjs[0]["object_b_id"])

        # ── Satellites ────────────────────────────────────────────────────
        satellites_out = []
        for sid, sat in simulation_state.satellites.items():
            r = _orbital_radius(sat.position)
            inc = _inclination(sat.position, sat.velocity)
            phase = _orbit_phase(sat.position, inc)
            speed_kms = _math.sqrt(sum(v * v for v in sat.velocity))
            orbit_speed = speed_kms / r if r > 0 else 0.0

            fuel_pct = round(100.0 * sat.fuel_kg / max(sat.initial_fuel_kg, 1e-9))
            fuel_pct = max(0, min(100, fuel_pct))

            frontend_status = _STATUS_FRONTEND.get(sat.status, "nominal")
            if sid in risk_pairs:
                frontend_status = "critical"

            satellites_out.append({
                "id":               sid,
                "name":             sid,
                "status":           frontend_status,
                "fuel":             fuel_pct,
                "pos":              sat.position,
                "vel":              sat.velocity,
                "orbitRadius":      round(r, 3),
                "orbitInclination": round(inc, 6),
                "orbitPhase":       round(phase, 6),
                "orbitSpeed":       round(orbit_speed, 8),
                "collisionRisk":    sid in risk_pairs,
                "riskTarget":       risk_pairs.get(sid),
                "conjunctions":     sat_conjunctions.get(sid, []),
            })

        # ── Debris ────────────────────────────────────────────────────────
        debris_out = []
        for did, deb in simulation_state.debris.items():
            r = _orbital_radius(deb.position)
            inc = _inclination(deb.position, deb.velocity)
            phase = _orbit_phase(deb.position, inc)
            speed_kms = _math.sqrt(sum(v * v for v in deb.velocity))
            orbit_speed = speed_kms / r if r > 0 else 0.0
            debris_out.append({
                "x": deb.position[0], "y": deb.position[1], "z": deb.position[2],
                "vx": deb.velocity[0], "vy": deb.velocity[1], "vz": deb.velocity[2],
                "r": round(r, 3),
                "phase": round(phase, 6),
                "speed": round(orbit_speed, 8),
                "inclination": round(inc, 6),
            })

        cdm_out = [
            {
                "warning_id":       w.warning_id,
                "object_1_id":      w.object_1_id,
                "object_2_id":      w.object_2_id,
                "tca":              w.tca.isoformat(),
                "miss_distance_km": w.miss_distance_km,
                "severity":         "CRITICAL" if w.miss_distance_km < 0.100 else "WARNING",
            }
            for w in simulation_state.active_cdm_warnings
        ]

        return {
            "sim_time":     simulation_state.sim_time.isoformat(),
            "satellites":   satellites_out,
            "debris":       debris_out,
            "cdm_warnings": cdm_out,
        }


# ── /api/simulate/init ────────────────────────────────────────────────────────

class InitObject(BaseModel):
    id: str
    object_type: str          # "satellite" | "debris"
    position: list[float]     # ECI km
    velocity: list[float]     # km/s
    fuel_kg: float = 0.5
    mass_kg: float = 4.0
    status: str = "nominal"


class InitRequest(BaseModel):
    objects: list[InitObject]


@router.post("/init", summary="Seed simulation state from frontend initial objects")
async def init_simulation(req: InitRequest):
    """
    Called once by usePhysicsSimulation on mount.
    Registers all satellites and debris into SimulationState.
    """
    from state_store import ScheduledBurn
    async with simulation_state.lock:
        # Clear existing state for a clean init
        simulation_state.satellites.clear()
        simulation_state.debris.clear()
        simulation_state.maneuver_queue.clear()
        simulation_state.cdm_warnings.clear()
        simulation_state.trajectory_log.clear()

        for obj in req.objects:
            if obj.object_type == "satellite":
                sat = simulation_state.get_or_create_satellite(obj.id)
                sat.position = list(obj.position)
                sat.velocity = list(obj.velocity)
                sat.fuel_kg = obj.fuel_kg
                sat.initial_fuel_kg = obj.fuel_kg
                sat.mass_kg = obj.mass_kg
                sat.status = obj.status  # type: ignore[assignment]
                sat.nominal_slot = {
                    "position": list(obj.position),
                    "velocity": list(obj.velocity),
                }
            else:
                simulation_state.get_or_create_debris(
                    obj.id, list(obj.position), list(obj.velocity)
                )

    return {"ok": True, "satellites": len(simulation_state.satellites),
            "debris": len(simulation_state.debris),
            "initialized": len(req.objects)}


