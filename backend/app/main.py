import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import httpx
from api import telemetry, maneuver, simulate, visualization
from background_propagator import initialize_propagator, shutdown_propagator
from state_store import simulation_state

# Enable logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# ── App lifecycle ────────────────────────────────────────────────────────────

async def _load_objects_from_db() -> int:
    """
    Load all satellites and debris from database (Go adapter/MongoDB).
    Returns count of objects loaded.
    """
    go_adapter_url = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{go_adapter_url}/objects", timeout=5.0)
            response.raise_for_status()
            data = response.json()
            
            count = 0
            async with simulation_state.lock:
                # Load satellites
                for sat_data in data.get("satellites", []):
                    sat = simulation_state.get_or_create_satellite(sat_data["id"])
                    sat.position = [sat_data["r"]["x"], sat_data["r"]["y"], sat_data["r"]["z"]]
                    sat.velocity = [sat_data["v"]["x"], sat_data["v"]["y"], sat_data["v"]["z"]]
                    sat.db_velocity = list(sat.velocity)
                    sat.velocity_dirty = False
                    if "fuel_kg" in sat_data:
                        sat.fuel_kg = sat_data["fuel_kg"]
                    if "status" in sat_data:
                        sat.status = sat_data["status"]
                    count += 1
                
                # Load debris
                for deb_data in data.get("debris", []):
                    deb = simulation_state.get_or_create_debris(
                        deb_data["id"],
                        [deb_data["r"]["x"], deb_data["r"]["y"], deb_data["r"]["z"]],
                        [deb_data["v"]["x"], deb_data["v"]["y"], deb_data["v"]["z"]]
                    )
                    deb.db_velocity = list(deb.velocity)
                    count += 1
            
            logger.info(f"Loaded {count} objects from database")
            return count
    except Exception as e:
        logger.warning(f"Failed to load objects from database: {e}")
        return 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context — runs on startup and shutdown.
    
    Startup:
      - Load satellites/debris from database
      - Initialize background propagation task
    
    Shutdown:
      - Gracefully stop background propagator
    """
    # ── STARTUP ──
    logger.info("=" * 60)
    logger.info("Starting CubeSat Mission Control API...")
    logger.info("=" * 60)
    
    go_adapter_url = os.getenv("GO_ADAPTER_URL", "http://go-adapter:8080")
    
    # Load existing objects from database
    logger.info("Loading objects from database...")
    count = await _load_objects_from_db()
    if count == 0:
        logger.warning("No objects loaded from database. Waiting for POST /api/telemetry or /api/simulate/init")
    else:
        logger.info(f"✓ {count} objects loaded from database")
    
    # Start background propagator
    try:
        await initialize_propagator(go_adapter_url)
        logger.info("✓ Background propagator started (updates every 60 seconds)")
    except Exception as e:
        logger.error(f"Failed to initialize propagator: {e}")
    
    logger.info("=" * 60)
    logger.info("API is ready. Listening for requests...")
    logger.info("=" * 60)
    
    yield  # App is running
    
    # ── SHUTDOWN ──
    logger.info("=" * 60)
    logger.info("Shutting down CubeSat Mission Control API...")
    logger.info("=" * 60)
    try:
        await shutdown_propagator()
        logger.info("✓ Background propagator stopped")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")


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

app.include_router(telemetry.router,      prefix="/api/telemetry",           tags=["telemetry"])
app.include_router(maneuver.router,       prefix="/api/maneuver",            tags=["maneuver"])
app.include_router(simulate.router,       prefix="/api/simulate",            tags=["simulate"])
app.include_router(visualization.router,  prefix="/api/visualization",       tags=["visualization"])


@app.get("/health", tags=["health"])
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Status endpoint ──────────────────────────────────────────────────────────

from datetime import datetime, timezone

@app.get("/status", tags=["status"], summary="System status and object count")
async def system_status():
    """Returns current system status, object counts, and propagation state."""
    async with simulation_state.lock:
        return {
            "status": "operational",
            "sim_time": simulation_state.sim_time.isoformat(),
            "satellites_count": len(simulation_state.satellites),
            "debris_count": len(simulation_state.debris),
            "pending_burns": len(simulation_state.maneuver_queue),
            "active_cdm_warnings": len(simulation_state.active_cdm_warnings),
            "propagation_interval_seconds": 60,
        }
