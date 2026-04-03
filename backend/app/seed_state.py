"""
Persist simulation state to a local JSON file so it survives backend restarts.
Loaded automatically on startup. Updated every 30 seconds and on clean shutdown.
"""
from __future__ import annotations
import json, math, os, logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
STATE_FILE = os.path.join(os.path.dirname(__file__), "_sim_state.json")

# Same Atlas as load_objects — used for /health parity checks
_DEFAULT_ATLAS_URI = "mongodb+srv://yashasvig_db_user:ENzdThDvVBAg6VUi@cluster0.ltykwqy.mongodb.net/?appName=ACM&tls=true&tlsInsecure=true"


def mongodb_collection_counts() -> dict[str, int] | None:
    """
    Document counts in Atlas satellites + debris collections (same DB as load_objects).
    Returns None if Atlas is unreachable.
    """
    try:
        from pymongo import MongoClient

        uri = os.getenv("MONGO_ATLAS_URI", _DEFAULT_ATLAS_URI)
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client[os.getenv("MONGO_DB", "cubesat")]
        out = {
            "satellites": db["satellites"].count_documents({}),
            "debris": db["debris"].count_documents({}),
        }
        client.close()
        return out
    except Exception:
        return None

MU = 398600.4418
RE = 6378.137

# ── Save / Load ───────────────────────────────────────────────────────────────

def save_state(simulation_state) -> None:
    try:
        sats = [{"id": sid, "object_type": "satellite",
                 "position": s.position, "velocity": s.velocity,
                 "fuel_kg": s.fuel_kg, "mass_kg": s.mass_kg, "status": s.status}
                for sid, s in simulation_state.satellites.items()]
        debs = [{"id": did, "object_type": "debris",
                 "position": d.position, "velocity": d.velocity,
                 "fuel_kg": 0.0, "mass_kg": 0.1, "status": "nominal"}
                for did, d in simulation_state.debris.items()]
        with open(STATE_FILE, "w") as f:
            json.dump({"objects": sats + debs,
                       "sim_time": simulation_state.sim_time.isoformat()}, f)
    except Exception as e:
        logger.warning("save_state failed: %s", e)


def load_objects() -> list[dict]:
    """
    Load objects exclusively from Atlas.
    Returns empty list if Atlas is unreachable or has no data.
    Never generates synthetic defaults — only real DB data is shown.
    """
    try:
        from pymongo import MongoClient
        ATLAS_URI = os.getenv("MONGO_ATLAS_URI", _DEFAULT_ATLAS_URI)
        client = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=6000)
        client.admin.command("ping")
        db = client["cubesat"]

        sats = list(db["satellites"].find({}, {"_id": 0}))
        debs = list(db["debris"].find({}, {"_id": 0}))
        client.close()

        objects = []
        for s in sats:
            r = s.get("r", {}); v = s.get("v", {})
            objects.append({
                "id": s["id"], "object_type": "satellite",
                "position": [r.get("x", 0), r.get("y", 0), r.get("z", 0)],
                "velocity": [v.get("x", 0), v.get("y", 0), v.get("z", 0)],
                "fuel_kg": float(s.get("fuel_kg", 0.5)),
                "mass_kg": float(s.get("mass_kg", 4.0)),
                "status": s.get("status", "nominal"),
            })
        for d in debs:
            r = d.get("r", {}); v = d.get("v", {})
            objects.append({
                "id": d["id"], "object_type": "debris",
                "position": [r.get("x", 0), r.get("y", 0), r.get("z", 0)],
                "velocity": [v.get("x", 0), v.get("y", 0), v.get("z", 0)],
                "fuel_kg": 0.0, "mass_kg": 0.1, "status": "nominal",
            })

        logger.info("Loaded %d objects from Atlas (sats=%d debris=%d)",
                    len(objects), len(sats), len(debs))
        return objects

    except Exception as e:
        logger.warning("Atlas load failed (%s) — starting with empty state", str(e)[:80])
        return []


def apply_objects(simulation_state, objects: list[dict]) -> None:
    """Seed simulation_state from a list of object dicts."""
    simulation_state.satellites.clear()
    simulation_state.debris.clear()
    simulation_state.maneuver_queue.clear()
    simulation_state.cdm_warnings.clear()
    simulation_state.trajectory_log.clear()
    simulation_state.sim_time = datetime.now(timezone.utc)

    for obj in objects:
        pos = obj["position"]; vel = obj["velocity"]
        if obj["object_type"] == "satellite":
            sat = simulation_state.get_or_create_satellite(obj["id"])
            sat.position = list(pos); sat.velocity = list(vel)
            sat.fuel_kg = float(obj.get("fuel_kg", 0.5))
            sat.initial_fuel_kg = sat.fuel_kg
            sat.mass_kg = float(obj.get("mass_kg", 4.0))
            sat.status = obj.get("status", "nominal")
            sat.nominal_slot = {"position": list(pos), "velocity": list(vel)}
        else:
            simulation_state.get_or_create_debris(obj["id"], list(pos), list(vel))
