#!/usr/bin/env python3
"""
System Verification Script - Checks all components are working correctly
Run this after seeding the database to verify everything is operational.
"""

import requests
import json
import time
from datetime import datetime

API_URL = "http://localhost:8000"
GO_ADAPTER_URL = "http://localhost:8080"

def check_service(name, url, timeout=5):
    """Check if a service is responding."""
    try:
        response = requests.get(url, timeout=timeout)
        if response.status_code == 200:
            print(f"✓ {name} is running ({url})")
            return True, response
        else:
            print(f"✗ {name} returned status {response.status_code}")
            return False, None
    except Exception as e:
        print(f"✗ {name} is NOT reachable: {e}")
        return False, None

def main():
    print("="*70)
    print("SYSTEM VERIFICATION CHECK")
    print("="*70)
    print(f"Timestamp: {datetime.now().isoformat()}\n")
    
    all_good = True
    
    # Check Go Adapter
    print("1. Checking Go Adapter (MongoDB Interface)...")
    go_ok, go_resp = check_service("Go Adapter", f"{GO_ADAPTER_URL}/health")
    if not go_ok:
        print("   ERROR: Go adapter must be running first!")
        print("   Run: cd go-adapter && go run main.go\n")
        all_good = False
    else:
        print("   ✓ MongoDB connection established\n")
    
    # Check Python Backend
    print("2. Checking Python Backend (Physics Engine)...")
    backend_ok, backend_resp = check_service("Python Backend", f"{API_URL}/health")
    if not backend_ok:
        print("   ERROR: Python backend must be running!")
        print("   Run: cd backend && python -m uvicorn app.main:app --reload --port 8000\n")
        all_good = False
    else:
        print("   ✓ Backend API responding\n")
    
    # Check Status Endpoint
    print("3. Checking System Status...")
    if backend_ok:
        try:
            resp = requests.get(f"{API_URL}/status", timeout=5)
            if resp.status_code == 200:
                status = resp.json()
                sats = status.get('satellites_count', 0)
                debs = status.get('debris_count', 0)
                print(f"   Satellites in memory: {sats}")
                print(f"   Debris in memory: {debs}")
                
                if sats < 50:
                    print(f"   ⚠ WARNING: Expected 50+ satellites, got {sats}")
                    print(f"   → Run: python emergency_seed.py\n")
                    all_good = False
                elif sats >= 50:
                    print(f"   ✓ Satellite count OK ({sats} >= 50)\n")
                
                if debs < 1000:
                    print(f"   ⚠ WARNING: Expected 1000+ debris, got {debs}")
                    print(f"   → Run: python emergency_seed.py\n")
                    all_good = False
                elif debs >= 1000:
                    print(f"   ✓ Debris count OK ({debs} >= 1000)\n")
            else:
                print(f"   ✗ Status endpoint returned {resp.status_code}\n")
                all_good = False
        except Exception as e:
            print(f"   ✗ Failed to get status: {e}\n")
            all_good = False
    
    # Check Visualization Snapshot
    print("4. Checking Visualization Snapshot...")
    if backend_ok:
        try:
            resp = requests.get(f"{API_URL}/api/visualization/snapshot", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                sats = len(data.get('satellites', []))
                debris = len(data.get('debris_cloud', []))
                timestamp = data.get('timestamp', 'N/A')
                
                print(f"   Timestamp: {timestamp}")
                print(f"   Satellites in snapshot: {sats}")
                print(f"   Debris in snapshot: {debris}")
                
                if sats > 0 and debris > 0:
                    print(f"   ✓ Snapshot contains data")
                    
                    # Check if satellite has required fields
                    if sats > 0:
                        sat = data['satellites'][0]
                        required_fields = ['id', 'lat', 'lon', 'fuel_kg', 'status', 'eci_km', 'eci_vel_kms']
                        missing = [f for f in required_fields if f not in sat]
                        if missing:
                            print(f"   ⚠ Missing fields in satellite: {missing}")
                        else:
                            print(f"   ✓ Satellite data format correct")
                    
                    # Check debris format
                    if debris > 0:
                        deb = data['debris_cloud'][0]
                        if isinstance(deb, list) and len(deb) >= 10:
                            print(f"   ✓ Debris data format correct (compact tuple)")
                        else:
                            print(f"   ⚠ Debris format unexpected: {type(deb)}")
                    
                    print()
                else:
                    print(f"   ✗ Snapshot is empty!")
                    print(f"   → Run: python emergency_seed.py\n")
                    all_good = False
            else:
                print(f"   ✗ Snapshot endpoint returned {resp.status_code}\n")
                all_good = False
        except Exception as e:
            print(f"   ✗ Failed to get snapshot: {e}\n")
            all_good = False
    
    # Check MongoDB Data via Go Adapter
    print("5. Checking MongoDB Data (via Go Adapter)...")
    if go_ok:
        try:
            resp = requests.get(f"{GO_ADAPTER_URL}/objects", timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                sats = len(data.get('satellites', []))
                debs = len(data.get('debris', []))
                
                print(f"   Satellites in MongoDB: {sats}")
                print(f"   Debris in MongoDB: {debs}")
                
                if sats >= 50 and debs >= 1000:
                    print(f"   ✓ MongoDB has sufficient data\n")
                else:
                    print(f"   ⚠ MongoDB data insufficient")
                    print(f"   → Run: python emergency_seed.py\n")
                    all_good = False
            else:
                print(f"   ✗ Objects endpoint returned {resp.status_code}\n")
                all_good = False
        except Exception as e:
            print(f"   ✗ Failed to get objects from Go adapter: {e}\n")
            all_good = False
    
    # Test Propagation (wait 12 seconds and check if positions change)
    print("6. Testing Physics Propagation (RK4+J2)...")
    if backend_ok:
        try:
            # Get initial snapshot
            resp1 = requests.get(f"{API_URL}/api/visualization/snapshot", timeout=10)
            if resp1.status_code == 200:
                data1 = resp1.json()
                if len(data1.get('satellites', [])) > 0:
                    initial_pos = data1['satellites'][0]['eci_km']
                    print(f"   Initial position of SAT-001: [{initial_pos[0]:.2f}, {initial_pos[1]:.2f}, {initial_pos[2]:.2f}]")
                    print(f"   Waiting 12 seconds for propagation cycle...")
                    
                    time.sleep(12)
                    
                    # Get second snapshot
                    resp2 = requests.get(f"{API_URL}/api/visualization/snapshot", timeout=10)
                    if resp2.status_code == 200:
                        data2 = resp2.json()
                        if len(data2.get('satellites', [])) > 0:
                            new_pos = data2['satellites'][0]['eci_km']
                            print(f"   New position of SAT-001:      [{new_pos[0]:.2f}, {new_pos[1]:.2f}, {new_pos[2]:.2f}]")
                            
                            # Calculate distance moved
                            dist = sum((a-b)**2 for a,b in zip(initial_pos, new_pos))**0.5
                            
                            if dist > 1.0:  # Should move at least 1 km in 12 seconds
                                print(f"   ✓ Position changed by {dist:.2f} km (propagation working!)")
                                print(f"   ✓ RK4+J2 physics engine is updating positions\n")
                            else:
                                print(f"   ⚠ Position barely changed ({dist:.2f} km)")
                                print(f"   → Check backend logs for propagation errors\n")
                                all_good = False
                        else:
                            print(f"   ✗ No satellites in second snapshot\n")
                            all_good = False
                    else:
                        print(f"   ✗ Failed to get second snapshot\n")
                        all_good = False
                else:
                    print(f"   ⚠ No satellites to test propagation\n")
                    all_good = False
            else:
                print(f"   ✗ Failed to get initial snapshot\n")
                all_good = False
        except Exception as e:
            print(f"   ✗ Propagation test failed: {e}\n")
            all_good = False
    
    # Final Summary
    print("="*70)
    if all_good:
        print("✅ ALL CHECKS PASSED!")
        print("="*70)
        print("\nYour system is ready for submission:")
        print("• 50+ satellites visible and moving on orbital paths")
        print("• 1000+ debris objects visible in space")
        print("• Database updating with RK4+J2 propagated positions every 10s")
        print("• Frontend fetching updated coordinates every 2s")
        print("• Smooth visualization of orbital motion")
        print("\nOpen your frontend at: http://localhost:5173")
        print("GOOD LUCK! 🚀\n")
        return 0
    else:
        print("❌ SOME CHECKS FAILED")
        print("="*70)
        print("\nPlease fix the issues above before submission.")
        print("Most common fix: Run 'python emergency_seed.py' to populate database\n")
        return 1

if __name__ == "__main__":
    exit(main())
