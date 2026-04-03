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

# ── Generate default 50-sat + 50-debris constellation ────────────────────────
import random as _rnd
_rnd.seed(42)

def _circ_vel(alt):
    return math.sqrt(MU / (RE + alt))

def _orbit_state(alt, inc_deg, raan_deg, ta_deg):
    r = RE + alt; v = _circ_vel(alt)
    inc = math.radians(inc_deg); raan = math.radians(raan_deg); ta = math.radians(ta_deg)
    px = r*math.cos(ta); py = r*math.sin(ta)
    pos = [px*math.cos(raan)-py*math.cos(inc)*math.sin(raan),
           px*math.sin(raan)+py*math.cos(inc)*math.cos(raan),
           py*math.sin(inc)]
    vx = -v*math.sin(ta); vy = v*math.cos(ta)
    vel = [vx*math.cos(raan)-vy*math.cos(inc)*math.sin(raan),
           vx*math.sin(raan)+vy*math.cos(inc)*math.cos(raan),
           vy*math.sin(inc)]
    return [round(x,4) for x in pos], [round(x,6) for x in vel]

def _default_objects():
    objs = []
    for i in range(50):
        pos, vel = _orbit_state(550, 53, (360/50)*i, _rnd.uniform(0,360))
        objs.append({"id": f"SAT-{i+1:03d}", "object_type": "satellite",
                     "position": pos, "velocity": vel,
                     "fuel_kg": round(_rnd.uniform(0.3,0.5),4), "mass_kg": 4.0, "status": "nominal"})
    for i in range(50):
        pos, vel = _orbit_state(_rnd.uniform(400,800), _rnd.uniform(0,98),
                                _rnd.uniform(0,360), _rnd.uniform(0,360))
        objs.append({"id": f"DEB-{10000+i:05d}", "object_type": "debris",
                     "position": pos, "velocity": vel, "fuel_kg": 0.0, "mass_kg": 0.1, "status": "nominal"})
    return objs

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
    Load objects in priority order:
    1. Atlas (satellites + debris collections)
    2. Local JSON snapshot (_sim_state.json)
    3. Generated defaults (50 sats + 50 debris)
    """
    # ── Try Atlas first ───────────────────────────────────────────────────────
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
                "position": [r.get("x",0), r.get("y",0), r.get("z",0)],
                "velocity": [v.get("x",0), v.get("y",0), v.get("z",0)],
                "fuel_kg": float(s.get("fuel_kg", 0.5)),
                "mass_kg": float(s.get("mass_kg", 4.0)),
                "status": s.get("status", "nominal"),
            })
        for d in debs:
            r = d.get("r", {}); v = d.get("v", {})
            objects.append({
                "id": d["id"], "object_type": "debris",
                "position": [r.get("x",0), r.get("y",0), r.get("z",0)],
                "velocity": [v.get("x",0), v.get("y",0), v.get("z",0)],
                "fuel_kg": 0.0, "mass_kg": 0.1, "status": "nominal",
            })

        if objects:
            logger.info("Loaded %d objects from Atlas (sats=%d debris=%d)",
                        len(objects), len(sats), len(debs))
            return objects
        logger.info("Atlas connected but empty — falling through to local state")
    except Exception as e:
        logger.warning("Atlas load failed (%s) — trying local state", str(e)[:60])

    # ── Try local JSON snapshot ───────────────────────────────────────────────
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                data = json.load(f)
            objs = data.get("objects", [])
            if objs:
                logger.info("Loaded %d objects from %s", len(objs), STATE_FILE)
                return objs
        except Exception as e:
            logger.warning("load_state failed: %s — using defaults", e)

    # ── Generate defaults ─────────────────────────────────────────────────────
    logger.info("No saved state — generating default 50-sat + 50-debris constellation")
    return _default_objects()


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
