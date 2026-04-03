"""
Seed the local backend (no Docker/MongoDB needed).
Uses POST /api/simulate/init directly.
Generates 50 satellites + 50 debris in LEO.
"""
import json, math, random, urllib.request

MU = 398600.4418
RE = 6378.137
random.seed(42)

def circular_velocity(alt_km):
    r = RE + alt_km
    return math.sqrt(MU / r)

def orbit_state(alt_km, inc_deg, raan_deg, ta_deg):
    r   = RE + alt_km
    v   = circular_velocity(alt_km)
    inc  = math.radians(inc_deg)
    raan = math.radians(raan_deg)
    ta   = math.radians(ta_deg)
    px = r * math.cos(ta);  py = r * math.sin(ta)
    pos = [
        px * math.cos(raan) - py * math.cos(inc) * math.sin(raan),
        px * math.sin(raan) + py * math.cos(inc) * math.cos(raan),
        py * math.sin(inc),
    ]
    vx = -v * math.sin(ta);  vy = v * math.cos(ta)
    vel = [
        vx * math.cos(raan) - vy * math.cos(inc) * math.sin(raan),
        vx * math.sin(raan) + vy * math.cos(inc) * math.cos(raan),
        vy * math.sin(inc),
    ]
    return pos, vel

objects = []

# 50 satellites at 550 km, Walker-like
for i in range(50):
    raan = (360.0 / 50) * i
    ta   = random.uniform(0, 360)
    pos, vel = orbit_state(550, 53, raan, ta)
    objects.append({
        "id": f"SAT-{i+1:03d}",
        "object_type": "satellite",
        "position": [round(x, 4) for x in pos],
        "velocity": [round(x, 6) for x in vel],
        "fuel_kg": round(random.uniform(0.3, 0.5), 4),
        "mass_kg": 4.0,
        "status": "nominal",
    })

# 50 debris at 400-800 km
for i in range(50):
    alt  = random.uniform(400, 800)
    inc  = random.uniform(0, 98)
    raan = random.uniform(0, 360)
    ta   = random.uniform(0, 360)
    pos, vel = orbit_state(alt, inc, raan, ta)
    objects.append({
        "id": f"DEB-{10000+i:05d}",
        "object_type": "debris",
        "position": [round(x, 4) for x in pos],
        "velocity": [round(x, 6) for x in vel],
        "fuel_kg": 0.0,
        "mass_kg": 0.1,
        "status": "nominal",
    })

payload = json.dumps({"objects": objects}).encode()
req = urllib.request.Request(
    "http://localhost:8000/api/simulate/init",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=15) as resp:
    result = json.loads(resp.read())

print(f"Seeded: {result}")
print(f"50 satellites + 50 debris ready.")
print(f"Open http://localhost:5173 and refresh.")
