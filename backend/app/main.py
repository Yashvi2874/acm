import os
import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import telemetry, maneuver, simulate, visualization
from background_propagator import initialize_propagator, shutdown_propagator
from state_store import simulation_state
from atlas_sync import start_sync_loop
from seed_state import load_objects, apply_objects, save_state, mongodb_collection_counts

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ──────────────────────────────────────────────────────────────
    logger.info("=" * 60)
    logger.info("Starting CubeSat Mission Control API...")

    # 1. Load from Atlas → local JSON → generated defaults
    objects = load_objects()
    async with simulation_state.lock:
        apply_objects(simulation_state, objects)
    logger.info("Seeded: %d satellites, %d debris",
                len(simulation_state.satellites), len(simulation_state.debris))

    # 2. Background RK4 propagator (updates every 10 s)
    try:
        go_url = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")
        await initialize_propagator(go_url)
        logger.info("Background propagator started (every 10s)")
    except Exception as e:
        logger.warning("Propagator init failed: %s", e)

    # 3. Periodic local save every 30 s
    async def _save_loop():
        while True:
            await asyncio.sleep(30)
            try:
                async with simulation_state.lock:
                    save_state(simulation_state)
            except Exception as e:
                logger.warning("save_loop: %s", e)

    asyncio.create_task(_save_loop())

    # 4. Atlas sync every 60 s (no-op if unreachable)
    asyncio.create_task(start_sync_loop(simulation_state, interval_seconds=60))

    logger.info("API ready on port 8000")
    logger.info("=" * 60)

    yield  # ── APP RUNNING ──

    # ── SHUTDOWN ─────────────────────────────────────────────────────────────
    try:
        await shutdown_propagator()
    except Exception:
        pass
    try:
        async with simulation_state.lock:
            save_state(simulation_state)
        logger.info("State saved on shutdown.")
    except Exception:
        pass


app = FastAPI(
    title="CubeSat Mission Control API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(telemetry.router,      prefix="/api/telemetry",      tags=["telemetry"])
app.include_router(maneuver.router,       prefix="/api/maneuver",       tags=["maneuver"])
app.include_router(simulate.router,       prefix="/api/simulate",       tags=["simulate"])
app.include_router(visualization.router,  prefix="/api/visualization",  tags=["visualization"])


@app.get("/health", tags=["health"])
async def health():
    out = {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "satellites": len(simulation_state.satellites),
        "debris": len(simulation_state.debris),
    }
    mc = mongodb_collection_counts()
    if mc is not None:
        out["mongodb_satellites"] = mc["satellites"]
        out["mongodb_debris"]     = mc["debris"]
    return out


@app.get("/status", tags=["status"])
async def system_status():
    async with simulation_state.lock:
        return {
            "status": "operational",
            "sim_time": simulation_state.sim_time.isoformat(),
            "satellites_count": len(simulation_state.satellites),
            "debris_count": len(simulation_state.debris),
            "pending_burns": len(simulation_state.maneuver_queue),
            "active_cdm_warnings": len(simulation_state.active_cdm_warnings),
            "propagation_interval_seconds": 10,
        }
