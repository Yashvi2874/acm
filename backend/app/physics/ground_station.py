"""
Line-of-sight checker between satellites and ground stations.
Units: km throughout (matches state_store convention).
"""
import numpy as np
import csv
import os
from datetime import datetime, timezone

RE_KM = 6378.137   # Earth radius (km)
EARTH_OMEGA = 7.2921150e-5
J2000 = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def _lla_to_ecef_km(lat_deg: float, lon_deg: float, alt_km: float = 0.0) -> np.ndarray:
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    r   = RE_KM + alt_km
    return np.array([
        r * np.cos(lat) * np.cos(lon),
        r * np.cos(lat) * np.sin(lon),
        r * np.sin(lat),
    ])


def _elevation_angle_deg(sat_pos_km: np.ndarray, gs_pos_km: np.ndarray) -> float:
    """Calculate elevation angle of satellite from ground station."""
    d = sat_pos_km - gs_pos_km
    d_norm = np.linalg.norm(d)
    gs_norm = np.linalg.norm(gs_pos_km)
    
    if d_norm == 0 or gs_norm == 0:
        return -90.0
        
    sin_el = np.dot(gs_pos_km, d) / (gs_norm * d_norm)
    # Clip to valid range for arcsin to avoid floating point errors
    sin_el = max(-1.0, min(1.0, sin_el))
    return float(np.degrees(np.arcsin(sin_el)))


def _gmst(sim_time: datetime) -> float:
    if sim_time.tzinfo is None:
        sim_time = sim_time.replace(tzinfo=timezone.utc)
    return EARTH_OMEGA * (sim_time - J2000).total_seconds()


def _eci_to_ecef_km(pos_km: np.ndarray, gmst: float) -> np.ndarray:
    c, s = np.cos(gmst), np.sin(gmst)
    x, y, z = pos_km
    return np.array([
        c * x + s * y,
        -s * x + c * y,
        z,
    ])


def load_ground_stations(csv_path: str | None = None) -> list[dict]:
    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(__file__), "../data/ground_stations.csv")
    stations = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return []
        reader.fieldnames = [name.strip() for name in reader.fieldnames]
        
        for row in reader:
            sid = row.get("Station_ID", row.get("id", ""))
            name = row.get("Station_Name", row.get("name", ""))
            lat = float(row.get("Latitude", row.get("lat", 0)))
            lon = float(row.get("Longitude", row.get("lon", 0)))
            alt_m = float(row.get("Elevation_m", row.get("alt", 0)))
            min_angle = float(row.get("Min_Elevation_Angle_deg", row.get("min_angle_deg", 5.0)))
            
            stations.append({
                "id": sid,
                "name": name,
                "lat": lat,
                "lon": lon,
                "alt": alt_m / 1000.0,
                "min_angle": min_angle
            })
    return stations


def visible_stations(sat_pos_km: list[float], stations: list[dict] | None = None) -> list[str]:
    """Return IDs of ground stations with LOS exceeding min elevation."""
    if stations is None:
        stations = load_ground_stations()
    sat = np.array(sat_pos_km)
    
    visible = []
    for gs in stations:
        gs_pos = _lla_to_ecef_km(gs["lat"], gs["lon"], gs["alt"])
        el = _elevation_angle_deg(sat, gs_pos)
        if el >= gs["min_angle"]:
            visible.append(gs["id"])
            
    return visible


def visible_stations_eci(
    sat_pos_eci_km: list[float],
    sim_time: datetime,
    stations: list[dict] | None = None,
) -> list[str]:
    """Return IDs of visible ground stations for a satellite state expressed in ECI coordinates."""
    gmst = _gmst(sim_time)
    sat_ecef = _eci_to_ecef_km(np.array(sat_pos_eci_km), gmst)
    return visible_stations(sat_ecef.tolist(), stations)

def check_line_of_sight(sat_state: list[float], ground_station: dict) -> dict:
    import math
    r_sat = np.array(sat_state[:3])
    r_station = np.array(ground_station.get("r_ecef", [0.0, 0.0, 0.0]))
    
    # If not provided, fallback to convert from lat/lon/alt
    if np.linalg.norm(r_station) == 0:
         r_station = _lla_to_ecef_km(ground_station.get("lat", 0), ground_station.get("lon", 0), ground_station.get("alt", 0))

    r_rel = r_sat - r_station
    if np.linalg.norm(r_station) == 0 or np.linalg.norm(r_rel) == 0:
        return {"visible": False, "elevation": -90.0}
        
    r_station_unit = r_station / np.linalg.norm(r_station)
    
    dp = float(np.dot(r_rel, r_station))
    
    # Calculate elevation mathematically
    sin_el = np.dot(r_rel, r_station_unit) / np.linalg.norm(r_rel)
    sin_el = max(-1.0, min(1.0, sin_el))
    elevation = math.asin(sin_el)
    
    visible = dp > 0 and math.degrees(elevation) > ground_station.get("min_elevation", 5.0)
    
    return {
        "visible": visible,
        "elevation": float(math.degrees(elevation))
    }
