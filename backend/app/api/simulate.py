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

from state_store import simulation_state, CDMWarning
from physics.propagator import propagate_rk4
from physics.conjunction import check_conjunctions
from physics.maneuver import rtn_to_eci, fuel_consumed, check_eol, BURN_COOLDOWN_S

router = APIRouter()

STATION_KEEP_KM  = 10.0   # max allowed drift from nominal slot

import os
GO_ADAPTER_URL = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")


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


class StepRequest(BaseModel):
    dt: float = 10.0   # seconds per step (sub-stepped at ≤30s internally)
    steps: int = 1     # number of ticks to advance


@router.post("/step", summary="Advance simulation by N ticks of dt seconds")
async def simulate_step(req: StepRequest):
    if req.dt <= 0 or req.steps < 1:
        raise HTTPException(status_code=422, detail="dt must be > 0 and steps >= 1")
    if req.steps > 1000:
        raise HTTPException(status_code=422, detail="steps capped at 1000 per call")

    maneuvers_executed: list[dict] = []
    cooldown_rejected:  list[dict] = []

    async with simulation_state.lock:
        if not simulation_state.satellites and not simulation_state.debris:
            raise HTTPException(
                status_code=409,
                detail="No objects in state. POST /api/telemetry first.",
            )

        for _step in range(req.steps):
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
                dv_eci    = rtn_to_eci(np.array(burn.delta_v_rtn), pos, vel)
                dv_mag    = float(np.linalg.norm(dv_eci))
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

            # ── 2. Propagate satellites ───────────────────────────────────
            for sat in simulation_state.satellites.values():
                result = propagate_rk4(sat.eci, req.dt, req.dt)
                sat.position = result[-1][:3]
                sat.velocity = result[-1][3:]

                # ── 3. Propagate nominal ghost (no maneuvers ever) ────────
                nom = propagate_rk4(sat.nominal_eci, req.dt, req.dt)
                sat.nominal_slot["position"] = nom[-1][:3]
                sat.nominal_slot["velocity"] = nom[-1][3:]

                # ── 4. Station-keeping check ──────────────────────────────
                sat.total_seconds += req.dt
                if sat.drift_km <= STATION_KEEP_KM:
                    sat.uptime_seconds += req.dt
                    if sat.status not in ("maneuver", "safe-hold", "comms-loss"):
                        sat.status = "nominal"
                else:
                    if sat.status == "nominal":
                        sat.status = "nominal"  # drifted but not flagged as outage yet

                # Reset maneuver flag after tick
                if sat.status == "maneuver":
                    sat.status = "nominal"

                simulation_state.log_state(sat.satellite_id, t_now, sat.eci)

            # ── 5. Propagate debris ───────────────────────────────────────
            for deb in simulation_state.debris.values():
                result = propagate_rk4(deb.eci, req.dt, req.dt)
                deb.position = result[-1][:3]
                deb.velocity = result[-1][3:]
                simulation_state.log_state(deb.debris_id, t_now, deb.eci)

            # ── Advance clock ─────────────────────────────────────────────
            simulation_state.sim_time += timedelta(seconds=req.dt)

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
                "severity":         "CRITICAL" if w.miss_distance_km < 0.1 else "WARNING",
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
        "sim_time":             simulation_state.sim_time.isoformat(),
        "steps_advanced":       req.steps,
        "dt_seconds":           req.dt,
        "maneuvers_executed":   maneuvers_executed,
        "cooldown_rejected":    cooldown_rejected,
        "collisions_detected":  len([c for c in cdm_snapshot if c["severity"] == "CRITICAL"]),
        "satellites":           sat_snapshot,
        "cdm_warnings":         cdm_snapshot,
        "eol_flags":            eol_flags,
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
