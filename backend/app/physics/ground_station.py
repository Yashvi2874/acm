"""Line-of-sight checker between satellites and ground stations."""
import numpy as np
import csv
import os

RE = 6378137.0  # Earth radius (m)
ATMO_HEIGHT = 0.0  # additional blocking height (m), set >0 for atmosphere margin


def _lla_to_ecef(lat_deg: float, lon_deg: float, alt_m: float = 0.0) -> np.ndarray:
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    x = (RE + alt_m) * np.cos(lat) * np.cos(lon)
    y = (RE + alt_m) * np.cos(lat) * np.sin(lon)
    z = (RE + alt_m) * np.sin(lat)
    return np.array([x, y, z])


def _has_los(sat_pos: np.ndarray, gs_pos: np.ndarray) -> bool:
    """True if line between sat and ground station doesn't intersect Earth."""
    d = sat_pos - gs_pos
    a = np.dot(d, d)
    b = 2 * np.dot(gs_pos, d)
    c = np.dot(gs_pos, gs_pos) - (RE + ATMO_HEIGHT) ** 2
    discriminant = b**2 - 4 * a * c
    if discriminant < 0:
        return True
    t1 = (-b - np.sqrt(discriminant)) / (2 * a)
    t2 = (-b + np.sqrt(discriminant)) / (2 * a)
    # Intersection within segment means blocked
    return not (0 < t1 < 1 or 0 < t2 < 1)


def load_ground_stations(csv_path: str | None = None) -> list[dict]:
    if csv_path is None:
        csv_path = os.path.join(os.path.dirname(__file__), "../data/ground_stations.csv")
    stations = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stations.append({
                "id": row["id"],
                "name": row["name"],
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "alt": float(row.get("alt", 0)),
            })
    return stations


def visible_stations(sat_pos_eci: list[float], stations: list[dict] | None = None) -> list[str]:
    """Return IDs of ground stations with line-of-sight to the satellite."""
    if stations is None:
        stations = load_ground_stations()
    sat = np.array(sat_pos_eci)
    visible = []
    for gs in stations:
        gs_pos = _lla_to_ecef(gs["lat"], gs["lon"], gs["alt"])
        if _has_los(sat, gs_pos):
            visible.append(gs["id"])
    return visible
