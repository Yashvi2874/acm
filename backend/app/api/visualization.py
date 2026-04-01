"""
GET /api/visualization/snapshot  ->  get_snapshot()

Spec-exact response:
  satellites : per-sat dict, status in {NOMINAL, MANEUVERING, OUTAGE, EOL}
  debris     : flat list of [id, lat, lon, alt_km] tuples (compact cloud format)
  cdm_warnings, ground_stations, sim_time
"""
from __future__ import annotations
import math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from state_store import simulation_state
from physics.ground_station import load_ground_stations, visible_stations

router = APIRouter()

RE_KM       = 6378.137
EARTH_OMEGA = 7.2921150e-5
J2000       = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def _gmst(sim_time: datetime) -> float:
    return EARTH_OMEGA * (sim_time - J2000).total_seconds()


def _eci_to_lla(pos_km: list[float], gmst: float) -> tuple[float, float, float]:
    x, y, z = pos_km
    c, s = math.cos(gmst), math.sin(gmst)
    xe =  c * x + s * y
    ye = -s * x + c * y
    ze = z
    r_xy = math.sqrt(xe * xe + ye * ye)
    lat  = math.degrees(math.atan2(ze, r_xy))
    lon  = math.degrees(math.atan2(ye, xe))
    alt  = math.sqrt(xe * xe + ye * ye + ze * ze) - RE_KM
    return round(lat, 4), round(lon, 4), round(alt, 3)


def _orbital_elements(pos_km: list[float], vel_kms: list[float]) -> dict:
    import numpy as np
    MU    = 398600.4418
    r_vec = np.array(pos_km)
    v_vec = np.array(vel_kms)
    r = float(np.linalg.norm(r_vec))
    v = float(np.linalg.norm(v_vec))
    a = 1.0 / (2.0 / r - v * v / MU)
    e_vec = ((v * v - MU / r) * r_vec - float(np.dot(r_vec, v_vec)) * v_vec) / MU
    e = float(np.linalg.norm(e_vec))
    h_vec = np.cross(r_vec, v_vec)
    h = float(np.linalg.norm(h_vec))
    inc = math.degrees(math.acos(float(np.clip(h_vec[2] / h, -1.0, 1.0))))
    return {
        "semi_major_axis_km": round(a, 3),
        "eccentricity":       round(e, 6),
        "inclination_deg":    round(inc, 4),
        "altitude_km":        round(r - RE_KM, 3),
        "speed_kms":          round(v, 4),
    }


_STATUS_MAP = {
    "nominal":        "NOMINAL",
    "maneuver":       "MANEUVERING",
    "safe-hold":      "OUTAGE",
    "comms-loss":     "OUTAGE",
    "decommissioned": "EOL",
}


def _display_status(sat) -> str:
    base = _STATUS_MAP.get(sat.status, "NOMINAL")
    if base == "NOMINAL" and sat.drift_km > 10.0:
        return "OUTAGE"
    return base


@router.get("/snapshot", summary="Full visualization snapshot")
async def get_snapshot():
    async with simulation_state.lock:
        t      = simulation_state.sim_time
        gmst   = _gmst(t)
        stations = load_ground_stations()

        # ── Satellites ────────────────────────────────────────────────────
        sat_out = {}
        for sid, sat in simulation_state.satellites.items():
            lat, lon, alt = _eci_to_lla(sat.position, gmst)
            elements = _orbital_elements(sat.position, sat.velocity)

            # Ground track: last 540 logged points (~90 min at 10s steps)
            ground_track = []
            for log_t, log_eci in simulation_state.trajectory_log.get(sid, [])[-540:]:
                glat, glon, _ = _eci_to_lla(log_eci[:3], _gmst(log_t))
                ground_track.append({"lat": glat, "lon": glon})

            vis = visible_stations(sat.position, stations)

            sat_out[sid] = {
                "position":                {"lat": lat, "lon": lon, "alt_km": alt},
                "eci_km":                  sat.position,
                "eci_vel_kms":             sat.velocity,
                "status":                  _display_status(sat),
                "orbital_elements":        elements,
                "mass_kg":                 sat.mass_kg,
                "fuel_kg":                 sat.fuel_kg,
                "drift_km":                round(sat.drift_km, 3),
                "uptime_pct":              round(100.0 * sat.uptime_seconds / max(sat.total_seconds, 1), 2),
                "nominal_position":        sat.nominal_slot["position"],
                "ground_track":            ground_track,
                "visible_ground_stations": vis,
                "last_telemetry":          sat.last_telemetry,
                "last_updated":            sat.last_updated.isoformat(),
            }

        # ── Debris cloud — flat tuples [id, lat, lon, alt_km] ─────────────
        debris_out = [
            [did,
             *_eci_to_lla(d.position, gmst)]
            for did, d in simulation_state.debris.items()
        ]

        # ── CDM warnings ──────────────────────────────────────────────────
        cdm_out = [
            {
                "warning_id":               w.warning_id,
                "object_1_id":              w.object_1_id,
                "object_2_id":              w.object_2_id,
                "tca":                      w.tca.isoformat(),
                "miss_distance_km":         w.miss_distance_km,
                "probability_of_collision": w.probability_of_collision,
                "severity": "CRITICAL" if w.miss_distance_km < 0.1 else "WARNING",
            }
            for w in simulation_state.active_cdm_warnings
        ]

        return {
            "sim_time":       t.isoformat(),
            "satellites":     sat_out,
            "debris":         debris_out,
            "cdm_warnings":   cdm_out,
            "ground_stations": [
                {"id": gs["id"], "name": gs["name"],
                 "lat": gs["lat"], "lon": gs["lon"]}
                for gs in stations
            ],
        }


@router.get("/ground-track/{satellite_id}")
async def ground_track(satellite_id: str):
    async with simulation_state.lock:
        if satellite_id not in simulation_state.satellites:
            raise HTTPException(status_code=404, detail="Satellite not found")
        track = [
            {"lat": lat, "lon": lon, "t": log_t.isoformat()}
            for log_t, log_eci in simulation_state.trajectory_log.get(satellite_id, [])
            for lat, lon, _ in [_eci_to_lla(log_eci[:3], _gmst(log_t))]
        ]
        return {"satellite_id": satellite_id, "ground_track": track}


@router.get("/cdm")
async def list_cdm():
    async with simulation_state.lock:
        return {
            "cdm_warnings": [
                {
                    "warning_id":       w.warning_id,
                    "object_1_id":      w.object_1_id,
                    "object_2_id":      w.object_2_id,
                    "tca":              w.tca.isoformat(),
                    "miss_distance_km": w.miss_distance_km,
                    "issued_at":        w.issued_at.isoformat(),
                    "resolved":         w.resolved,
                }
                for w in simulation_state.cdm_warnings
            ]
        }
