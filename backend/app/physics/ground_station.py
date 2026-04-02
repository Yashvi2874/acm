"""
Line-of-sight checker between satellites and ground stations.
Units: km throughout (matches state_store convention).
"""
import numpy as np
import csv
import os

RE_KM = 6378.137   # Earth radius (km)


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
