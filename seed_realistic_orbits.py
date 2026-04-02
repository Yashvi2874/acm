#!/usr/bin/env python3
"""
Enhanced Seed Script with Realistic Orbits and Collision Scenarios

Generates 10 satellites and 50 debris objects with:
- J2-corrected circular velocity
- ECI J2000 reference frame
- Intersecting orbits for collision testing
- Multiple conjunction scenarios
"""

import argparse
import json
import math
import random
import urllib.request
from datetime import datetime, timezone

MU = 398600.4418   # km³/s²
RE = 6378.137      # km
J2 = 1.08263e-3    # Earth's J2 harmonic


def _circular_velocity(alt_km: float) -> float:
    """J2-corrected circular velocity at given altitude."""
    r = RE + alt_km
    a_j2 = 1.5 * J2 * MU * RE**2 / r**4
    return math.sqrt((MU / r**2 + a_j2) * r)


def _orbit_state(alt_km: float, inc_deg: float, raan_deg: float, ta_deg: float, 
                 ecc: float = 0.0) -> tuple:
    """Generate state vector for orbit with J2 correction."""
    r_mag = RE + alt_km
    
    if ecc == 0.0:
        v = _circular_velocity(alt_km)
    else:
        a = r_mag / (2.0 - (r_mag * (1.0 + ecc)) / (RE + alt_km))
        v_circ = _circular_velocity(alt_km)
        v = v_circ * math.sqrt((2.0 / r_mag) - (1.0 / a))
    
    inc = math.radians(inc_deg)
    raan = math.radians(raan_deg)
    ta = math.radians(ta_deg)
    
    if ecc == 0.0:
        px = r_mag * math.cos(ta)
        py = r_mag * math.sin(ta)
    else:
        p = a * (1.0 - ecc**2)
        r = p / (1.0 + ecc * math.cos(ta))
        px = r * math.cos(ta)
        py = r * math.sin(ta)
    
    pos = [
        px * math.cos(raan) - py * math.cos(inc) * math.sin(raan),
        px * math.sin(raan) + py * math.cos(inc) * math.cos(raan),
        py * math.sin(inc),
    ]
    
    if ecc == 0.0:
        vx = -v * math.sin(ta)
        vy = v * math.cos(ta)
    else:
        h = math.sqrt(MU * p)
        vx = -h / p * math.sin(ta)
        vy = h / p * (ecc + math.cos(ta))
    
    vel = [
        vx * math.cos(raan) - vy * math.cos(inc) * math.sin(raan),
        vx * math.sin(raan) + vy * math.cos(inc) * math.cos(raan),
        vy * math.sin(inc),
    ]
    
    return pos, vel


def generate_satellites_with_conjunctions(n: int = 10) -> list[dict]:
    """Generate n satellites with intersecting orbits for collision testing."""
    sats = []
    
    # Group 1: Walker constellation (6 satellites)
    alt_walker = 550.0
    inc_walker = 53.0
    for i in range(6):
        raan = (360.0 / 6) * i
        ta = random.uniform(0, 360)
        pos, vel = _orbit_state(alt_walker, inc_walker, raan, ta)
        sats.append({
            "id": f"SAT-{len(sats)+1:03d}",
            "type": "SATELLITE",
            "r": {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v": {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
            "fuel_kg": round(random.uniform(0.3, 0.5), 4),
            "mass_kg": 4.0,
            "status": "nominal",
        })
    
    # Group 2: Crossing orbits (2 satellites)
    alt_cross = 580.0
    pos7, vel7 = _orbit_state(alt_cross, 97.5, 45.0, random.uniform(0, 360))
    sats.append({
        "id": "SAT-007",
        "type": "SATELLITE",
        "r": {"x": round(pos7[0], 4), "y": round(pos7[1], 4), "z": round(pos7[2], 4)},
        "v": {"x": round(vel7[0], 6), "y": round(vel7[1], 6), "z": round(vel7[2], 6)},
        "fuel_kg": 0.42,
        "mass_kg": 4.0,
        "status": "nominal",
    })
    pos8, vel8 = _orbit_state(alt_cross, 70.0, 120.0, random.uniform(0, 360))
    sats.append({
        "id": "SAT-008",
        "type": "SATELLITE",
        "r": {"x": round(pos8[0], 4), "y": round(pos8[1], 4), "z": round(pos8[2], 4)},
        "v": {"x": round(vel8[0], 6), "y": round(vel8[1], 6), "z": round(vel8[2], 6)},
        "fuel_kg": 0.38,
        "mass_kg": 4.0,
        "status": "nominal",
    })
    
    # Group 3: Co-orbital satellites (2 satellites)
    alt_co = 545.0
    inc_co = 53.0
    raan_co = 180.0
    pos9, vel9 = _orbit_state(alt_co, inc_co, raan_co, 0.0)
    sats.append({
        "id": "SAT-009",
        "type": "SATELLITE",
        "r": {"x": round(pos9[0], 4), "y": round(pos9[1], 4), "z": round(pos9[2], 4)},
        "v": {"x": round(vel9[0], 6), "y": round(vel9[1], 6), "z": round(vel9[2], 6)},
        "fuel_kg": 0.45,
        "mass_kg": 4.0,
        "status": "nominal",
    })
    pos10, vel10 = _orbit_state(alt_co, inc_co, raan_co, 180.0)
    sats.append({
        "id": "SAT-010",
        "type": "SATELLITE",
        "r": {"x": round(pos10[0], 4), "y": round(pos10[1], 4), "z": round(pos10[2], 4)},
        "v": {"x": round(vel10[0], 6), "y": round(vel10[1], 6), "z": round(vel10[2], 6)},
        "fuel_kg": 0.40,
        "mass_kg": 4.0,
        "status": "nominal",
    })
    
    return sats


def generate_debris_with_intersections(n: int = 50) -> list[dict]:
    """Generate n debris objects with intentional orbit intersections."""
    debs = []
    
    # Group 1: Random LEO debris (20 objects)
    for i in range(20):
        alt = random.uniform(400, 800)
        inc = random.uniform(0, 98)
        raan = random.uniform(0, 360)
        ta = random.uniform(0, 360)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        debs.append({
            "id": f"DEB-{10000 + len(debs):05d}",
            "type": "DEBRIS",
            "r": {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v": {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    
    # Group 2: Satellite-altitude debris (15 objects)
    for i in range(15):
        alt = random.uniform(520, 580)
        inc = random.choice([53.0, 70.0, 97.5])
        raan = random.uniform(0, 360)
        ta = random.uniform(0, 360)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        debs.append({
            "id": f"DEB-{10000 + len(debs):05d}",
            "type": "DEBRIS",
            "r": {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v": {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    
    # Group 3: Polar/SSO debris (10 objects)
    for i in range(10):
        alt = random.uniform(600, 800)
        inc = random.uniform(95, 98)
        raan = random.uniform(0, 360)
        ta = random.uniform(0, 360)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        debs.append({
            "id": f"DEB-{10000 + len(debs):05d}",
            "type": "DEBRIS",
            "r": {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v": {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    
    # Group 4: Near-collision debris (5 objects)
    critical_alts = [550.0, 550.0, 545.0, 580.0, 555.0]
    critical_incs = [53.0, 53.0, 53.0, 70.0, 97.5]
    
    for i in range(5):
        alt = critical_alts[i]
        inc = critical_incs[i]
        raan = random.uniform(0, 360)
        ta = random.uniform(0, 360)
        pos, vel = _orbit_state(alt, inc, raan, ta)
        
        offset = random.uniform(0, 0.001)
        pos[0] += offset * pos[0]
        pos[1] += offset * pos[1]
        pos[2] += offset * pos[2]
        
        debs.append({
            "id": f"DEB-{10000 + len(debs):05d}",
            "type": "DEBRIS",
            "r": {"x": round(pos[0], 4), "y": round(pos[1], 4), "z": round(pos[2], 4)},
            "v": {"x": round(vel[0], 6), "y": round(vel[1], 6), "z": round(vel[2], 6)},
        })
    
    return debs


def post_telemetry(api_url: str, objects: list[dict]) -> dict:
    """POST telemetry batch to backend API."""
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "objects": objects,
    }
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{api_url}/api/telemetry",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  HTTP Error {e.code}: {e.reason}")
        raise


def main():
    parser = argparse.ArgumentParser(description="Seed database with realistic orbits")
    parser.add_argument("--api", default="http://localhost:8000", help="Backend API URL")
    args = parser.parse_args()
    
    satellites = generate_satellites_with_conjunctions(10)
    debris = generate_debris_with_intersections(50)
    all_objects = satellites + debris
    
    result = post_telemetry(args.api, all_objects)
    
    if result.get("status") == "ACK":
        print(f"Seeded {len(satellites)} satellites and {len(debris)} debris to MongoDB Atlas")
        print(f"Active CDM warnings: {result['active_cdm_warnings']}")


if __name__ == "__main__":
    main()
