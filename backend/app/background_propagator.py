"""
Background propagation task — continuously updates database with new satellite positions.

Architecture:
  - Startup: Load all satellites/debris from database
  - Every 60 seconds:
    1. Propagate each object by 60s using RK4+J2
    2. Update database with new position
    3. Keep velocity unchanged (unless maneuver occurred)
  - Maneuvers: Update velocity immediately in database
  - Frontend: Polls /api/visualization/snapshot → reads from simulation_state (synced with DB)
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import numpy as np

from state_store import simulation_state, DebrisState, SatelliteState
from physics.propagator import propagate_rk4
from physics.constants import STATION_KEEP_KM

logger = logging.getLogger(__name__)

# Configuration
PROPAGATION_INTERVAL_SECONDS = 10  # Update DB every 10 seconds for smoother visualization
RK4_SUB_STEP_MAX = 10.0  # RK4 integration sub-step cap (seconds)

class BackgroundPropagator:
    """Continuous propagation task — keeps database in sync with physics simulation."""
    
    def __init__(self, go_adapter_url: str = "http://go-adapter:8080"):
        self.go_adapter_url = go_adapter_url
        self.running = False
        self.task: Optional[asyncio.Task] = None
        
    async def start(self) -> None:
        """Start the propagation loop."""
        if self.running:
            logger.warning("Propagator already running")
            return
        
        self.running = True
        self.task = asyncio.create_task(self._propagation_loop())
        logger.info("Background propagator started")
    
    async def stop(self) -> None:
        """Stop the propagation loop."""
        self.running = False
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=5.0)
            except asyncio.TimeoutError:
                self.task.cancel()
        logger.info("Background propagator stopped")
    
    async def _propagation_loop(self) -> None:
        """Main propagation loop — runs indefinitely."""
        while self.running:
            try:
                await asyncio.sleep(PROPAGATION_INTERVAL_SECONDS)
                await self._propagate_and_persist()
            except Exception as e:
                logger.error(f"Propagation loop error: {e}", exc_info=True)
                await asyncio.sleep(5.0)  # Back off on error
    
    async def _sync_from_database(self) -> None:
        """
        Sync latest satellite and debris state from MongoDB via Go adapter.
        This ensures we're propagating the most recent telemetry data.
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.go_adapter_url}/objects", timeout=5.0)
                response.raise_for_status()
                data = response.json()
                
                async with simulation_state.lock:
                    # Update satellites from database
                    for sat_data in data.get("satellites", []):
                        sat = simulation_state.get_or_create_satellite(sat_data["id"])
                        sat.position = [sat_data["r"]["x"], sat_data["r"]["y"], sat_data["r"]["z"]]
                        sat.velocity = [sat_data["v"]["x"], sat_data["v"]["y"], sat_data["v"]["z"]]
                        if "fuel_kg" in sat_data:
                            sat.fuel_kg = sat_data["fuel_kg"]
                        if "status" in sat_data:
                            sat.status = sat_data["status"]
                        if "mass_kg" in sat_data:
                            sat.mass_kg = sat_data["mass_kg"]
                    
                    # Update debris from database
                    for deb_data in data.get("debris", []):
                        deb = simulation_state.get_or_create_debris(
                            deb_data["id"],
                            [deb_data["r"]["x"], deb_data["r"]["y"], deb_data["r"]["z"]],
                            [deb_data["v"]["x"], deb_data["v"]["y"], deb_data["v"]["z"]]
                        )
                
                logger.debug(f"Synced {len(data.get('satellites', []))} satellites and {len(data.get('debris', []))} debris from database")
        except Exception as e:
            logger.warning(f"Failed to sync from database: {e}")
    
    async def _propagate_and_persist(self) -> None:
        """
        Trigger the full autonomous Constellation Manager pipeline.
        This hits the simulation engine directly to perform:
          1. Sync latest from Go Adapter
          2. Execute due/queued maneuvers
          3. Propagate RK4+J2
          4. Check Station Keeping & EOL
          5. Perform Conjunction Assessment (predict CDMs)
          6. Schedule Autonomous Evade Burns (COLA)
          7. Persist to MongoDB
        """
        from api.simulate import simulate_step, StepRequest
        try:
            # We bypass the HTTP layer and invoke the controller directly for performance
            await simulate_step(StepRequest(
                step_seconds=float(PROPAGATION_INTERVAL_SECONDS),
                force_recompute_from_db=True
            ))
            logger.info(f"Autonomous ACM pipeline cycle complete (dt={PROPAGATION_INTERVAL_SECONDS}s)")
        except Exception as e:
            logger.error(f"Failed to execute autonomous ACM pipeline: {e}", exc_info=True)


# Global instance
_propagator: Optional[BackgroundPropagator] = None


async def initialize_propagator(go_adapter_url: str = "http://go-adapter:8080") -> BackgroundPropagator:
    """Create and start the global propagator instance."""
    global _propagator
    _propagator = BackgroundPropagator(go_adapter_url)
    await _propagator.start()
    return _propagator


async def shutdown_propagator() -> None:
    """Stop the global propagator instance."""
    global _propagator
    if _propagator:
        await _propagator.stop()
        _propagator = None


def get_propagator() -> Optional[BackgroundPropagator]:
    """Get the current propagator instance."""
    return _propagator
