#!/usr/bin/env python3
"""
Emergency Database Seeder - Seeds MongoDB with initial satellite and debris data
This ensures the visualization shows objects immediately.
"""

import requests
import json
import math
import random
from datetime import datetime, timezone
import time
import sys

API_URL = "http://localhost:8000"

def state_from_orbital_elements(a_km, e, i_deg, raan_deg, omega_deg, nu_deg):
    """Convert orbital elements to ECI state vector."""
    i = math.radians(i_deg)
    raan = math.radians(raan_deg)
    omega = math.radians(omega_deg)
    nu = math.radians(nu_deg)
    
    mu = 398600.4418
    r = a_km * (1 - e**2) / (1 + e * math.cos(nu))
    
    x_pf = r * math.cos(nu)
    y_pf = r * math.sin(nu)
    
    v_pf_mag = math.sqrt(mu * (2/r - 1/a_km))
    vx_pf = -v_pf_mag * math.sin(nu)
    vy_pf = v_pf_mag * (e + math.cos(nu))
    
    cos_raan, sin_raan = math.cos(raan), math.sin(raan)
    cos_i, sin_i = math.cos(i), math.sin(i)
    cos_omega, sin_omega = math.cos(omega), math.sin(omega)
    
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

def generate_satellites(count=55):
    """Generate 55 satellites in diverse orbits."""
    satellites = []
    for i in range(count):
        if i < 35:
            a = 6378.137 + random.uniform(400, 1500)  # LEO
        elif i < 45:
            a = 6378.137 + random.uniform(8000, 15000)  # MEO
        else:
            a = 42164.0 + random.uniform(-500, 500)  # GEO
        
        e = random.uniform(0.0, 0.05)
        i_deg = random.uniform(10, 85)
        raan_deg = random.uniform(0, 360)
        omega_deg = random.uniform(0, 360)
        nu_deg = random.uniform(0, 360)
        
        x, y, z, vx, vy, vz = state_from_orbital_elements(a, e, i_deg, raan_deg, omega_deg, nu_deg)
        
        satellites.append({
            "id": f"SAT-{i+1:03d}",
            "type": "SATELLITE",
            "r": {"x": x, "y": y, "z": z},
            "v": {"x": vx, "y": vy, "z": vz},
            "mass_kg": 5.0,
            "fuel_kg": 0.5,
            "status": "nominal"
        })
    
    return satellites

def generate_debris(count=1200):
    """Generate 1200 debris objects."""
    debris = []
    for i in range(count):
        if i % 10 < 8:
            a = 6378.137 + random.uniform(300, 2000)
        else:
            a = 6378.137 + random.uniform(8000, 20000)
        
        e = random.uniform(0.0, 0.12)
        i_deg = random.uniform(0, 98)
        raan_deg = random.uniform(0, 360)
        omega_deg = random.uniform(0, 360)
        nu_deg = random.uniform(0, 360)
        
        x, y, z, vx, vy, vz = state_from_orbital_elements(a, e, i_deg, raan_deg, omega_deg, nu_deg)
        
        debris.append({
            "id": f"DEB-{i+1:05d}",
            "type": "DEBRIS",
            "r": {"x": x, "y": y, "z": z},
            "v": {"x": vx, "y": vy, "z": vz}
        })
    
    return debris

def post_telemetry_batch(objects, batch_size=100):
    """Post objects in batches."""
    total = len(objects)
    print(f"Posting {total} objects in batches of {batch_size}...")
    
    for i in range(0, total, batch_size):
        batch = objects[i:i + batch_size]
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "objects": batch
        }
        
        try:
            response = requests.post(f"{API_URL}/api/telemetry", json=payload, timeout=30)
            response.raise_for_status()
            result = response.json()
            print(f"✓ Batch {i//batch_size + 1}/{(total + batch_size - 1)//batch_size}: {len(batch)} objects (processed: {result.get('processed_count', 0)})")
        except Exception as e:
            print(f"✗ Failed batch {i//batch_size + 1}: {e}")
            return False
        
        time.sleep(0.05)
    
    return True

def check_backend_health():
    """Check if backend is running."""
    try:
        response = requests.get(f"{API_URL}/health", timeout=5)
        if response.status_code == 200:
            print("✓ Backend is running")
            return True
        else:
            print(f"✗ Backend returned status {response.status_code}")
            return False
    except Exception as e:
        print(f"✗ Cannot connect to backend at {API_URL}: {e}")
        return False

def main():
    print("="*70)
    print("EMERGENCY DATABASE SEEDER")
    print("="*70)
    
    # Check backend
    if not check_backend_health():
        print("\nERROR: Backend is not running!")
        print("Please start the backend first:")
        print("  cd backend && python -m uvicorn app.main:app --reload --port 8000")
        sys.exit(1)
    
    print("\nGenerating objects...")
    satellites = generate_satellites(55)
    debris = generate_debris(1200)
    all_objects = satellites + debris
    
    print(f"Generated {len(satellites)} satellites and {len(debris)} debris")
    print(f"Total: {len(all_objects)} objects\n")
    
    # Post to backend
    success = post_telemetry_batch(all_objects, batch_size=100)
    
    if success:
        print("\n" + "="*70)
        print("✅ SUCCESS! Database seeded with:")
        print(f"   • {len(satellites)} satellites")
        print(f"   • {len(debris)} debris objects")
        print("="*70)
        print("\nThe frontend should now show moving satellites and debris!")
        print("Refresh your browser to see the updated visualization.")
    else:
        print("\n❌ FAILED to seed database")
        sys.exit(1)

if __name__ == "__main__":
    main()
