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


def _has_los(sat_pos_km: np.ndarray, gs_pos_km: np.ndarray) -> bool:
    """True if the line sat→gs does not intersect Earth (radius RE_KM)."""
    d = sat_pos_km - gs_pos_km
    a = float(np.dot(d, d))
    b = float(2.0 * np.dot(gs_pos_km, d))
    c = float(np.dot(gs_pos_km, gs_pos_km)) - RE_KM ** 2
    disc = b * b - 4.0 * a * c
    if disc < 0:
        return True
    t1 = (-b - np.sqrt(disc)) / (2.0 * a)
    t2 = (-b + np.sqrt(disc)) / (2.0 * a)
    return not (0.0 < t1 < 1.0 or 0.0 < t2 < 1.0)


def load_ground_stations(csv_path: str | None = None) -> list[dict]:
    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(__file__), "../data/ground_stations.csv")
    stations = []
    with open(csv_path, newline="") as f:
        for row in csv.DictReader(f):
            stations.append({
                "id":   row["id"],
                "name": row["name"],
                "lat":  float(row["lat"]),
                "lon":  float(row["lon"]),
                "alt":  float(row.get("alt", 0)) / 1000.0,  # CSV stores metres → km
            })
    return stations


def visible_stations(sat_pos_km: list[float], stations: list[dict] | None = None) -> list[str]:
    """Return IDs of ground stations with LOS to the satellite (position in km)."""
    if stations is None:
        stations = load_ground_stations()
    sat = np.array(sat_pos_km)
    return [
        gs["id"] for gs in stations
        if _has_los(sat, _lla_to_ecef_km(gs["lat"], gs["lon"], gs["alt"]))
    ]
