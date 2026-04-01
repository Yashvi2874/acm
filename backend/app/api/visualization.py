"""
GET /api/visualization/snapshot  →  get_snapshot()

Returns a visualization-ready snapshot:
  - Per-satellite position (lat/lon/alt), orbital elements, ground track
  - Debris positions
  - Active CDM warnings
  - Ground station visibility

Units in: km/km/s (from state). Units out: degrees, km (for UI).
"""
import math
from datetime import timezone
from fastapi import APIRouter, HTTPException

from state_store import simulation_state
from physics.ground_station import load_ground_stations, visible_stations
from physics.conjunction import check_conjunctions

router = APIRouter()

RE_KM      = 6378.137
EARTH_OMEGA = 7.2921150e-5   # rad/s


def _gmst_offset(sim_time) -> float:
    """Seconds since J2000 epoch → GMST angle in radians (approx)."""
    from datetime import datetime, timezone
    j2000 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    elapsed_s = (sim_time - j2000).total_seconds()
    return EARTH_OMEGA * elapsed_s


def _eci_to_lla(pos_km: list[float], gmst: float) -> tuple[float, float, float]:
    """ECI km → geodetic (lat_deg, lon_deg, alt_km)."""
    x, y, z = pos_km
    cos_t, sin_t = math.cos(gmst), math.sin(gmst)
    x_ecef =  cos_t * x + sin_t * y
    y_ecef = -sin_t * x + cos_t * y
    z_ecef = z

    r_xy = math.sqrt(x_ecef**2 + y_ecef**2)
    lon  = math.degrees(math.atan2(y_ecef, x_ecef))
    lat  = math.degrees(math.atan2(z_ecef, r_xy))
    alt  = math.sqrt(x_ecef**2 + y_ecef**2 + z_ecef**2) - RE_KM
    return lat, lon, alt


def _orbital_elements(pos_km: list[float], vel_kms: list[float]) -> dict:
    import numpy as np
    MU = 398600.4418   # km^3/s^2
    r_vec = np.array(pos_km)
    v_vec = np.array(vel_kms)
    r = float(np.linalg.norm(r_vec))
    v = float(np.linalg.norm(v_vec))

    a   = 1.0 / (2.0 / r - v**2 / MU)
    e_v = ((v**2 - MU / r) * r_vec - np.dot(r_vec, v_vec) * v_vec) / MU
    e   = float(np.linalg.norm(e_v))
    h_v = np.cross(r_vec, v_vec)
    h   = float(np.linalg.norm(h_v))
    inc = math.degrees(math.acos(float(np.clip(h_v[2] / h, -1.0, 1.0))))

    return {
        "semi_major_axis_km": round(a, 3),
        "eccentricity":       round(e, 6),
        "inclination_deg":    round(inc, 4),
        "altitude_km":        round(r - RE_KM, 3),
        "speed_kms":          round(v, 4),
    }


@router.get("/snapshot", summary="Full visualization snapshot")
async def get_snapshot():
    async with simulation_state.lock:
        t        = simulation_state.sim_time
        gmst     = _gmst_offset(t)
        stations = load_ground_stations()
        snapshot = {}

        for sid, sat in simulation_state.satellites.items():
            lat, lon, alt = _eci_to_lla(sat.position, gmst)
            elements      = _orbital_elements(sat.position, sat.velocity)

            # Ground track from trajectory log (last 540 points ≈ 90 min at 10 s steps)
            ground_track = []
            for log_t, log_eci in simulation_state.trajectory_log.get(sid, [])[-540:]:
                log_gmst = _gmst_offset(log_t)
                glat, glon, _ = _eci_to_lla(log_eci[:3], log_gmst)
                ground_track.append({"lat": round(glat, 4), "lon": round(glon, 4)})

            # Ground station LOS — convert position to metres for existing checker
            pos_m = [sat.position[0]*1e3, sat.position[1]*1e3, sat.position[2]*1e3]
            visible = visible_stations(pos_m, stations)

            snapshot[sid] = {
                "position":               {"lat": round(lat, 4), "lon": round(lon, 4), "alt_km": round(alt, 3)},
                "eci_km":                 sat.position,
                "eci_vel_kms":            sat.velocity,
                "orbital_elements":       elements,
                "mass_kg":                sat.mass_kg,
                "fuel_kg":                sat.fuel_kg,
                "status":                 sat.status,
                "nominal_slot":           sat.nominal_slot,
                "ground_track":           ground_track,
                "visible_ground_stations": visible,
                "last_telemetry":         sat.last_telemetry,
                "last_updated":           sat.last_updated.isoformat(),
            }

        # Debris snapshot
        debris_snapshot = {
            did: {
                "position": d.position,
                "velocity": d.velocity,
                "lla":      dict(zip(("lat", "lon", "alt_km"), _eci_to_lla(d.position, gmst))),
            }
            for did, d in simulation_state.debris.items()
        }

        # Active CDM warnings
        cdm_snapshot = [
            {
                "warning_id":       w.warning_id,
                "object_1_id":      w.object_1_id,
                "object_2_id":      w.object_2_id,
                "tca":              w.tca.isoformat(),
                "miss_distance_km": w.miss_distance_km,
                "probability_of_collision": w.probability_of_collision,
            }
            for w in simulation_state.active_cdm_warnings
        ]

        return {
            "sim_time":       t.isoformat(),
            "satellites":     snapshot,
            "debris":         debris_snapshot,
            "cdm_warnings":   cdm_snapshot,
            "ground_stations": [
                {"id": gs["id"], "name": gs["name"], "lat": gs["lat"], "lon": gs["lon"]}
                for gs in stations
            ],
        }


@router.get("/ground-track/{satellite_id}", summary="Ground track for one satellite")
async def ground_track(satellite_id: str):
    async with simulation_state.lock:
        if satellite_id not in simulation_state.satellites:
            raise HTTPException(status_code=404, detail="Satellite not found")

        track = []
        for log_t, log_eci in simulation_state.trajectory_log.get(satellite_id, []):
            gmst = _gmst_offset(log_t)
            lat, lon, _ = _eci_to_lla(log_eci[:3], gmst)
            track.append({"lat": round(lat, 4), "lon": round(lon, 4), "t": log_t.isoformat()})

        return {"satellite_id": satellite_id, "ground_track": track}


@router.get("/cdm", summary="List active CDM warnings")
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
