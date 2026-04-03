"""
Direct MongoDB Atlas sync — bypasses Go adapter entirely.

Writes satellite + debris state to Atlas every 60 seconds (background task).
Also writes on maneuver execution (velocity change only).

Connection string: set MONGO_ATLAS_URI env var or hardcode below.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Connection ────────────────────────────────────────────────────────────────
# Replace <db_password> with your actual password
_ATLAS_URI = os.getenv(
    "MONGO_ATLAS_URI",
    "mongodb+srv://yashasvig_db_user:ENzdThDvVBAg6VUi@cluster0.ltykwqy.mongodb.net/?appName=ACM&tls=true&tlsInsecure=true"
)
_DB_NAME      = os.getenv("MONGO_DB", "cubesat")
_ATLAS_ENABLED = True

_client = None
_db     = None


def _get_db():
    global _client, _db
    if _db is not None:
        return _db
    if not _ATLAS_ENABLED:
        return None
    try:
        from pymongo import MongoClient
        # URI already contains tls=true&tlsInsecure=true — no extra flags needed
        _client = MongoClient(_ATLAS_URI, serverSelectionTimeoutMS=8000)
        _client.admin.command("ping")
        _db = _client[_DB_NAME]
        logger.info("Atlas connected: db=%s", _DB_NAME)
    except Exception as e:
        logger.warning("Atlas unavailable (%s) — running without persistence", str(e)[:80])
        _db = None
    return _db


# ── Write helpers ─────────────────────────────────────────────────────────────

def upsert_objects(satellites: dict, debris: dict) -> None:
    """
    Upsert all satellites and debris into Atlas.
    Called from the background sync task every 60 s.
    """
    db = _get_db()
    if db is None:
        return
    try:
        from pymongo import UpdateOne
        ts = datetime.now(timezone.utc).isoformat()

        sat_ops = [
            UpdateOne(
                {"_id": sid},
                {"$set": {
                    "id": sid,
                    "type": "SATELLITE",
                    "r": {"x": s.position[0], "y": s.position[1], "z": s.position[2]},
                    "v": {"x": s.velocity[0], "y": s.velocity[1], "z": s.velocity[2]},
                    "fuel_kg": s.fuel_kg,
                    "mass_kg": s.mass_kg,
                    "status": s.status,
                    "updated_at": ts,
                }},
                upsert=True,
            )
            for sid, s in satellites.items()
        ]
        deb_ops = [
            UpdateOne(
                {"_id": did},
                {"$set": {
                    "id": did,
                    "type": "DEBRIS",
                    "r": {"x": d.position[0], "y": d.position[1], "z": d.position[2]},
                    "v": {"x": d.velocity[0], "y": d.velocity[1], "z": d.velocity[2]},
                    "updated_at": ts,
                }},
                upsert=True,
            )
            for did, d in debris.items()
        ]

        if sat_ops:
            db["satellites"].bulk_write(sat_ops, ordered=False)
        if deb_ops:
            db["debris"].bulk_write(deb_ops, ordered=False)

        logger.debug("Atlas sync: %d sats, %d debris", len(sat_ops), len(deb_ops))
    except Exception as e:
        logger.warning("Atlas upsert failed: %s", e)


def upsert_satellite_velocity(sat_id: str, position: list, velocity: list,
                               fuel_kg: float, mass_kg: float) -> None:
    """
    Write updated velocity (and position) for a single satellite after a maneuver.
    Called immediately after burn execution — not on a timer.
    """
    db = _get_db()
    if db is None:
        return
    try:
        db["satellites"].update_one(
            {"_id": sat_id},
            {"$set": {
                "r": {"x": position[0], "y": position[1], "z": position[2]},
                "v": {"x": velocity[0], "y": velocity[1], "z": velocity[2]},
                "fuel_kg": fuel_kg,
                "mass_kg": mass_kg,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        logger.warning("Atlas velocity update failed for %s: %s", sat_id, e)


# ── Background sync task ──────────────────────────────────────────────────────

async def start_sync_loop(simulation_state, interval_seconds: int = 60) -> None:
    """
    Background coroutine: syncs all objects to Atlas every `interval_seconds`.
    Start with: asyncio.create_task(start_sync_loop(simulation_state))
    """
    logger.info("Atlas sync loop started (interval=%ds)", interval_seconds)
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            async with simulation_state.lock:
                sats  = dict(simulation_state.satellites)
                debs  = dict(simulation_state.debris)
            # Run blocking pymongo call in thread pool to avoid blocking event loop
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, upsert_objects, sats, debs)
        except Exception as e:
            logger.warning("Sync loop error: %s", e)
