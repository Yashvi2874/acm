"""
Integration test for /api/visualization/snapshot response shape.
Run with: python -m pytest backend/tests/test_visualization.py -v
"""

import pytest
from fastapi.testclient import TestClient
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'app'))

from app.main import app

client = TestClient(app)

def test_visualization_snapshot_shape():
    # First, seed some data
    telemetry_payload = {
        "timestamp": "2026-04-03T12:00:00.000Z",
        "objects": [
            {
                "id": "SAT-001",
                "type": "SATELLITE",
                "r": {"x": 6771.0, "y": 0.0, "z": 0.0},
                "v": {"x": 0.0, "y": 7.5, "z": 0.0},
                "mass_kg": 100.0,
                "fuel_kg": 0.5,
                "status": "nominal"
            },
            {
                "id": "DEB-001",
                "type": "DEBRIS",
                "r": {"x": 6771.0, "y": 100.0, "z": 0.0},
                "v": {"x": 0.0, "y": 7.5, "z": 0.0}
            }
        ]
    }
    response = client.post("/api/telemetry", json=telemetry_payload)
    assert response.status_code == 200

    config_resp = client.get("/api/simulate/config")
    assert config_resp.status_code == 200
    config_data = config_resp.json()
    assert config_data["satellite_count"] == 1
    assert config_data["debris_count"] == 1
    assert config_data["station_keeping_radius_km"] == 10.0

    # The station-keeping drift check should trigger status update for far drift.

    # Now test snapshot
    response = client.get("/api/visualization/snapshot")
    assert response.status_code == 200
    data = response.json()

    # Check structure
    assert "timestamp" in data
    assert "satellites" in data
    assert "debris_cloud" in data
    assert "cdm_warnings" in data
    assert "ground_stations" in data

    # Check satellites
    assert isinstance(data["satellites"], list)
    if data["satellites"]:
        sat = data["satellites"][0]
        assert "id" in sat
        assert "lat" in sat
        assert "lon" in sat
        assert "fuel_kg" in sat
        assert "status" in sat
        assert "eci_km" in sat
        assert "eci_vel_kms" in sat
        assert isinstance(sat["eci_km"], list) and len(sat["eci_km"]) == 3
        assert isinstance(sat["eci_vel_kms"], list) and len(sat["eci_vel_kms"]) == 3

    # Check debris_cloud
    assert isinstance(data["debris_cloud"], list)
    if data["debris_cloud"]:
        deb = data["debris_cloud"][0]
        assert isinstance(deb, list) and len(deb) == 10  # id, lat, lon, alt, px, py, pz, vx, vy, vz


def test_station_keeping_outage_and_recovery_planning():
    telemetry_payload = {
        "timestamp": "2026-04-03T12:10:00.000Z",
        "objects": [
            {
                "id": "SAT-OUTAGE",
                "type": "SATELLITE",
                # 25 km drift from a reference near 6778 km orbit
                "r": {"x": 6803.0, "y": 0.0, "z": 0.0},
                "v": {"x": 0.0, "y": 7.5, "z": 0.0},
                "mass_kg": 100.0,
                "fuel_kg": 5.0,
                "status": "nominal"
            }
        ]
    }
    response = client.post("/api/telemetry", json=telemetry_payload)
    assert response.status_code == 200

    snap_resp = client.get("/api/visualization/snapshot")
    assert snap_resp.status_code == 200
    snap_data = snap_resp.json()

    sat_list = [s for s in snap_data["satellites"] if s["id"] == "SAT-OUTAGE"]
    assert len(sat_list) == 1
    assert sat_list[0]["status"] == "OUTAGE"


def test_maneuver_rtn_is_converted_to_eci_on_schedule():
    telemetry_payload = {
        "timestamp": "2026-04-03T12:20:00.000Z",
        "objects": [
            {
                "id": "SAT-RTN",
                "type": "SATELLITE",
                "r": {"x": 6771.0, "y": 0.0, "z": 0.0},
                "v": {"x": 0.0, "y": 7.5, "z": 0.0},
                "mass_kg": 100.0,
                "fuel_kg": 0.5,
                "status": "nominal"
            }
        ]
    }
    response = client.post("/api/telemetry", json=telemetry_payload)
    assert response.status_code == 200

    schedule_payload = {
        "satelliteId": "SAT-RTN",
        "maneuver_sequence": [
            {
                "burn_id": "BURN-RTN",
                "burnTime": "2026-04-03T12:20:00.000Z",
                "deltaV_vector": {"x": 0.001, "y": 0.0, "z": 0.0}
            }
        ]
    }
    response = client.post("/api/maneuver/schedule", json=schedule_payload)
    assert response.status_code == 202

    step_resp = client.post("/api/simulate/step", json={"step_seconds": 10})
    assert step_resp.status_code == 200
    step_data = step_resp.json()
    assert step_data["status"] == "STEP_COMPLETE"

    # Validate RTN-to-ECI conversion exists and works for basic aligned state vectors.
    from physics.maneuver import rtn_to_eci, apply_delta_v
    import numpy as np
    state = np.array([6771.0, 0.0, 0.0, 0.0, 7.5, 0.0])
    dv_rtn = np.array([0.001, 0.0, 0.0])
    dv_eci = rtn_to_eci(dv_rtn, state)
    assert np.allclose(dv_eci, np.array([0.001, 0.0, 0.0]), atol=1e-9)
    new_state = apply_delta_v(state, dv_eci)
    assert np.isclose(new_state[3], 0.001, atol=1e-12)

    snap_resp = client.get("/api/visualization/snapshot")
    assert snap_resp.status_code == 200
    snap_data = snap_resp.json()

    sat = next((s for s in snap_data["satellites"] if s["id"] == "SAT-RTN"), None)
    assert sat is not None
    assert sat["fuel_kg"] < 0.5
