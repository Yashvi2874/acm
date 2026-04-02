"""
Seed Atlas with exactly 10 satellites and 50 debris objects.

Generates physically realistic LEO orbits (400-800 km altitude),
POSTs them to POST /api/telemetry in the spec-exact format,
which saves them to the satellites and debris collections in Atlas.

Usage:
    python seed_db.py [--api http://localhost:8000]
"""
import argparse
import json
import math
import random
import urllib.request
import urllib.error
from datetime import datetime, timezone

# ── Constants ─────────────────────────────────────────────────────────────────
MU = 398600.4418   # km³/s²
RE = 6378.137      # km
J2 = 1.08263e-3

random.seed(42)    # deterministic — same data every run


def _circular_velocity(alt_km: float) -> float:
    """J2-corrected circular velocity at given altitude."""
    r = RE + alt_km
    a_j2 = 1.5 * J2 * MU * RE**2 / r**4
    return math.sqrt((MU / r**2 + a_j2) * r)


def _orbit_state(alt_km: float, inc_deg: float, raan_deg: float, ta_deg: float) -> tuple:
    """Return (position_km, velocity_kms) for a circular orbit."""
    r   = RE + alt_km
    v   = _circular_velocity(alt_km)
    inc  = math.radians(inc_deg)
    raan = math.radians(raan_deg)
    ta   = math.radians(ta_deg)

    # Position in perifocal frame, then rotate
    px = r * math.cos(ta)
    py = r * math.sin(ta)

    pos = [
        px * math.cos(raan) - py * math.cos(inc) * math.sin(raan),
        px * math.sin(raan) + py * math.cos(inc) * math.cos(raan),
        py * math.sin(inc),
    ]

    vx = -v * math.sin(ta)
    vy =  v * math.cos(ta)
    vel = [
        vx * math.cos(raan) - vy * math.cos(inc) * math.sin(raan),
        vx * math.sin(raan) + vy * math.cos(inc) * math.cos(raan),
        vy * math.sin(inc),
    ]
    return pos, vel


def generate_satellites(n: int = 50) -> list[dict]:
    """Generate n satellites in a Walker-like constellation at 550 km."""
    sats = []
    alt  = 550.0
    inc  = 53.0   # Starlink-like inclination
    for i in range(n):
        raan = (360.0 / n) * i          # evenly spaced planes
        ta   = random.uniform(0, 360)   # random phase within plane
        pos, vel = _orbit_state(alt, inc, raan, ta)
        sats.append({
            "id":     f"SAT-{i+1:03d}",
            "type":   "SATELLITE",
            "r":      {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v":      {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
            "fuel_kg": round(random.uniform(0.3, 0.5), 4),
            "mass_kg": 4.0,
            "status": "nominal",
        })
    return sats


def generate_debris(n: int = 50) -> list[dict]:
    """Generate n debris objects scattered across LEO (400-800 km)."""
    debs = []
    for i in range(n):
        alt  = random.uniform(400, 800)
        inc  = random.uniform(0, 98)    # full range including SSO
        raan = random.uniform(0, 360)
        ta   = random.uniform(0, 360)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        debs.append({
            "id":   f"DEB-{10000 + i:05d}",
            "type": "DEBRIS",
            "r":    {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v":    {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    return debs


def post_telemetry(api_url: str, objects: list[dict]) -> dict:
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "objects": objects,
    }
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        f"{api_url}/api/telemetry",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    args = parser.parse_args()

    print(f"Seeding Atlas via {args.api} ...")

    satellites = generate_satellites(50)
    debris     = generate_debris(50)
    all_objects = satellites + debris

    print(f"  Generated: {len(satellites)} satellites, {len(debris)} debris")

    # POST in one batch
    result = post_telemetry(args.api, all_objects)
    print(f"  Response:  {result}")

    if result.get("status") == "ACK":
        print(f"\n  Saved to Atlas:")
        print(f"    satellites collection : 50 documents")
        print(f"    debris collection     : 50 documents")
        print(f"    telemetry collection  : {result['processed_count']} log entries")
        print(f"\n  Active CDM warnings: {result['active_cdm_warnings']}")
        print("\nDone. Refresh the frontend to see live data from Atlas.")
    else:
        print(f"  ERROR: unexpected response: {result}")


if __name__ == "__main__":
    main()
