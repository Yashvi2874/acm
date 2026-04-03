#!/usr/bin/env python3
"""
Seed the database with initial satellite and debris data.
This script populates the backend with realistic orbital data for 50+ satellites and 10,000+ debris.

Key: Each satellite and debris MUST have INDEPENDENT orbital parameters:
  - Semi-major axis (a)
  - Eccentricity (e)
  - Inclination (i)
  - RAAN (Ω)
  - Argument of perigee (ω)
  - True anomaly (ν)

This ensures realistic collision scenarios and maneuver complexity.
"""

import argparse
import os
import requests
import json
from datetime import datetime, timezone
import math
import time
import random

# Backend API URL
API_URL = os.getenv("API_URL", "http://localhost:8000")

def state_from_orbital_elements(a_km, e, i_deg, raan_deg, omega_deg, nu_deg):
    """
    Convert orbital elements to ECI state vector [x, y, z, vx, vy, vz].
    
    All angles in degrees. Uses vis-viva equation for velocity magnitude.
    """
    # Convert to radians
    i = math.radians(i_deg)
    raan = math.radians(raan_deg)
    omega = math.radians(omega_deg)
    nu = math.radians(nu_deg)
    
    # Perifocal position and velocity
    mu = 398600.4418  # Earth GM
    r = a_km * (1 - e**2) / (1 + e * math.cos(nu))
    
    # Perifocal frame
    x_pf = r * math.cos(nu)
    y_pf = r * math.sin(nu)
    z_pf = 0.0
    
    v_pf_mag = math.sqrt(mu * (2/r - 1/a_km))
    vx_pf = -v_pf_mag * math.sin(nu)
    vy_pf = v_pf_mag * (e + math.cos(nu))
    vz_pf = 0.0
    
    # Rotation matrix from perifocal to ECI (three rotations)
    cos_raan, sin_raan = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(i), math.sin(i)
    cos_omega, sin_omega = math.cos(omega), math.sin(omega)
    
    # ECI coordinates
    x = (cos_raan * cos_omega - sin_raan * sin_omega * cos_i) * x_pf + \
        (-cos_raan * sin_omega - sin_raan * cos_omega * cos_i) * y_pf
    y = (sin_raan * cos_omega + cos_raan * sin_omega * cos_i) * x_pf + \
        (-sin_raan * sin_omega + cos_raan * cos_omega * cos_i) * y_pf
    z = sin_omega * sin_i * x_pf + cos_omega * sin_i * y_pf
    
    vx = (cos_raan * cos_omega - sin_raan * sin_omega * cos_i) * vx_pf + \
         (-cos_raan * sin_omega - sin_raan * cos_omega * cos_i) * vy_pf
    vy = (sin_raan * cos_omega + cos_raan * sin_omega * cos_i) * vx_pf + \
         (-sin_raan * sin_omega + cos_raan * cos_omega * cos_i) * vy_pf
    vz = sin_omega * sin_i * vx_pf + cos_omega * sin_i * vy_pf
    
    return x, y, z, vx, vy, vz


def generate_satellites(count=50):
    """Generate satellites in INDEPENDENT orbits with diverse parameters."""
    satellites = []
    
    for i in range(count):
        # Ensure each satellite has DIFFERENT orbital parameters
        # Mix of LEO, MEO, and some GEO
        if i < 30:
            # LEO: 400-2000 km altitude (most satellites)
            a = 6378.137 + random.uniform(400, 2000)
        elif i < 40:
            # MEO: 8000-20000 km altitude (GPS-like)
            a = 6378.137 + random.uniform(8000, 20000)
        else:
            # GEO: ~42164 km semi-major axis (geostationary)
            a = 42164.0 + random.uniform(-500, 500)
        
        # Eccentricity: 0.0 (circular) to 0.1 (slightly elliptical)
        e = random.uniform(0.0, 0.1)
        
        # Inclination: very diverse (equatorial to polar)
        i_deg = random.uniform(0, 90)
        
        # RAAN: random orientation
        raan_deg = random.uniform(0, 360)
        
        # Argument of perigee: random
        omega_deg = random.uniform(0, 360)
        
        # True anomaly: random starting position along orbit
        nu_deg = random.uniform(0, 360)
        
        # Convert to ECI
        x, y, z, vx, vy, vz = state_from_orbital_elements(a, e, i_deg, raan_deg, omega_deg, nu_deg)
        
        satellites.append({
            "id": f"SAT-{i+1:03d}",
            "type": "SATELLITE",
            "r": {"x": x, "y": y, "z": z},
            "v": {"x": vx, "y": vy, "z": vz},
            "mass_kg": max(2.0, min(10.0, 4.0 + random.uniform(-1.0, 2.0))),
            "fuel_kg": max(0.1, min(5.0, 0.5 + random.uniform(-0.2, 1.5))),
            "status": "nominal"
        })
    
    return satellites


def generate_debris(count=10000):
    """Generate debris in INDEPENDENT orbits across diverse altitudes."""
    debris = []
    
    for i in range(count):
        # Debris altitude: mostly LEO (200-2000 km) with some in MEO
        if i % 10 < 8:
            # 80% in LEO
            a = 6378.137 + random.uniform(200, 2000)
        else:
            # 20% in MEO
            a = 6378.137 + random.uniform(8000, 25000)
        
        # Higher eccentricity than satellites (more varied)
        e = random.uniform(0.0, 0.15)
        
        # Very diverse inclinations (equatorial to polar)
        i_deg = random.uniform(0, 98)
        
        # Random RAAN
        raan_deg = random.uniform(0, 360)
        
        # Random perigee direction
        omega_deg = random.uniform(0, 360)
        
        # Random starting position in orbit
        nu_deg = random.uniform(0, 360)
        
        # Convert to ECI
        x, y, z, vx, vy, vz = state_from_orbital_elements(a, e, i_deg, raan_deg, omega_deg, nu_deg)
        
        debris.append({
            "id": f"DEB-{i+1:05d}",
            "type": "DEBRIS",
            "r": {"x": x, "y": y, "z": z},
            "v": {"x": vx, "y": vy, "z": vz}
        })
    
    return debris


def post_telemetry_batch(objects, batch_size=200):
    """Post objects in batches to avoid payload size limits."""
    total_objects = len(objects)
    print(f"Posting {total_objects} objects in batches of {batch_size}...")
    
    for i in range(0, total_objects, batch_size):
        batch = objects[i:i + batch_size]
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "objects": batch
        }
        
        try:
            response = requests.post(f"{API_URL}/api/telemetry", json=payload, timeout=30)
            response.raise_for_status()
            print(f"✅ Posted batch {i//batch_size + 1}/{(total_objects + batch_size - 1)//batch_size} ({len(batch)} objects)")
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to post batch {i//batch_size + 1}: {e}")
            return False
        
        time.sleep(0.1)  # Small delay between batches
    
    return True
    
def main():
    """Main seeding function."""
    parser = argparse.ArgumentParser(description="Seed satellites and debris into the telemetry API")
    parser.add_argument("--api", default=os.getenv("API_URL", "http://localhost:8000"))
    parser.add_argument("--satellites", type=int, default=int(os.getenv("SATELLITE_COUNT", "50")))
    parser.add_argument("--debris", type=int, default=int(os.getenv("DEBRIS_COUNT", "10000")))
    parser.add_argument("--batch", type=int, default=int(os.getenv("BATCH_SIZE", "200")))
    args = parser.parse_args()

    global API_URL
    API_URL = args.api

    print("=" * 70)
    print("SATELLITE & DEBRIS DATABASE SEEDER")
    print("=" * 70)
    print(f"Using parameters: satellites={args.satellites}, debris={args.debris}, batch={args.batch}")

    # Generate objects
    satellites = generate_satellites(args.satellites)
    debris = generate_debris(args.debris)
    all_objects = satellites + debris

    print(f"Generated {len(satellites)} satellites and {len(debris)} debris objects")

    # Post in batches
    success = post_telemetry_batch(all_objects, batch_size=args.batch)

    if success:
        print("\n✅ Database seeded successfully!")
        print(f"   Total objects: {len(all_objects)}")
        print(f"   Satellites: {len(satellites)}")
        print(f"   Debris: {len(debris)}")
    else:
        print("\n❌ Failed to seed database")

    return success

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
