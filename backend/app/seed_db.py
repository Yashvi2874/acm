"""
Seed Atlas with 50 satellites and 10,000+ debris objects.

Generates physically realistic LEO orbits (400-800 km altitude),
POSTs them to POST /api/telemetry in the spec-exact format,
which saves them to the satellites and debris collections in Atlas.

Usage:
    python seed_db.py [--api http://localhost:8000]
"""
import argparse
import json
import math
import os
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
    """Generate n satellites with diverse altitudes and inclinations."""
    sats = []
    base_alt = 500.0
    for i in range(n):
        # Spread across multiple orbital shells to avoid single homogenous plane
        alt = base_alt + random.uniform(-20, 80) + (i % 5) * 15
        inc = random.uniform(42.0, 98.0)
        raan = random.uniform(0, 360)
        ta   = random.uniform(0, 360)

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
    """Generate n debris objects scattered across LEO (350-1200 km) with random orbits."""
    debs = []
    for i in range(n):
        alt  = random.uniform(350.0, 1200.0)
        inc  = random.uniform(0.0, 98.0)    # full range including SSO
        raan = random.uniform(0.0, 360.0)
        ta   = random.uniform(0.0, 360.0)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        debs.append({
            "id":   f"DEB-{10000 + i:05d}",
            "type": "DEBRIS",
            "r":    {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v":    {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    return debs


def post_telemetry_batch(api_url: str, objects: list[dict], batch_size: int = 100) -> dict:
    """Post telemetry in batches to avoid payload size limits."""
    total_processed = 0
    total_cdm = 0
    
    for i in range(0, len(objects), batch_size):
        batch = objects[i:i + batch_size]
        payload = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "objects": batch,
        }
        data = json.dumps(payload).encode()
        req  = urllib.request.Request(
            f"{api_url}/api/telemetry",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            if result.get("status") != "ACK":
                raise Exception(f"Batch {i//batch_size + 1} failed: {result}")
            total_processed += result["processed_count"]
            total_cdm = max(total_cdm, result["active_cdm_warnings"])
        
        print(f"    Batch {i//batch_size + 1}: {len(batch)} objects processed")
    
    return {"status": "ACK", "processed_count": total_processed, "active_cdm_warnings": total_cdm}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--satellites", type=int, default=int(os.getenv("SATELLITE_COUNT", "50")))
    parser.add_argument("--debris", type=int, default=int(os.getenv("DEBRIS_COUNT", "1000")))
    parser.add_argument("--batch", type=int, default=int(os.getenv("BATCH_SIZE", "200")))
    args = parser.parse_args()

    print(f"Seeding Atlas via {args.api} ...")
    print(f"Using dynamic population settings: satellites={args.satellites}, debris={args.debris}, batch={args.batch}")

    satellites = generate_satellites(args.satellites)
    debris     = generate_debris(args.debris)
    all_objects = satellites + debris

    print(f"  Generated: {len(satellites)} satellites, {len(debris)} debris")

    # POST in batches to avoid payload size limits
    result = post_telemetry_batch(args.api, all_objects, batch_size=args.batch)
    print(f"  Response:  {result}")

    if result.get("status") == "ACK":
        print(f"\n  Saved to Atlas:")
        print(f"    satellites collection : {len(satellites)} documents")
        print(f"    debris collection     : {len(debris)} documents")
        print(f"    telemetry collection  : {result['processed_count']} log entries")
        print(f"\n  Active CDM warnings: {result['active_cdm_warnings']}")
        print("\nDone. Refresh the frontend to see live data from Atlas.")
    else:
        print(f"  ERROR: unexpected response: {result}")


if __name__ == "__main__":
    main()
