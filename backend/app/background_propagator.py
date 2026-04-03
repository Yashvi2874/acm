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
        Propagate all satellites and debris, persist position updates to database.
        
        Flow:
          1. Sync latest state from MongoDB
          2. Acquire lock on simulation_state
          3. For each satellite/debris:
             - Propagate by PROPAGATION_INTERVAL_SECONDS using RK4+J2
             - Update in-memory position
             - Track if velocity changed (maneuver)
          4. Release lock
          5. Persist position updates to Go adapter/MongoDB
        """
        
        # Sync with database first to get latest state
        await self._sync_from_database()
        
        async with simulation_state.lock:
            if not simulation_state.satellites and not simulation_state.debris:
                logger.debug("No objects to propagate")
                return
            
            t_now = simulation_state.sim_time
            dt = PROPAGATION_INTERVAL_SECONDS
            
            # Collect updates for persistence
            updates = []
            
            # ── Propagate satellites ────────────────────────────────────────
            for sat_id, sat in simulation_state.satellites.items():
                try:
                    # RK4 propagation
                    state_vec = sat.eci  # [x, y, z, vx, vy, vz]
                    trajectory = propagate_rk4(state_vec, dt, RK4_SUB_STEP_MAX)
                    
                    if trajectory is not None and len(trajectory) > 0:
                        new_state = trajectory[-1]
                        
                        # Ensure it's a list
                        if hasattr(new_state, 'tolist'):
                            new_state = new_state.tolist()
                        elif not isinstance(new_state, list):
                            new_state = list(new_state)
                        
                        new_pos = [float(x) for x in new_state[:3]]
                        new_vel = [float(x) for x in new_state[3:]]
                        
                        # Update in-memory state
                        sat.position = new_pos
                        sat.velocity = new_vel
                        sat.last_updated = t_now + timedelta(seconds=dt)
                        
                        # Log trajectory
                        simulation_state.log_state(sat_id, sat.last_updated, new_state)
                        
                        # Track for persistence
                        updates.append({
                            "id": sat_id,
                            "type": "SATELLITE",
                            "r": {"x": new_pos[0], "y": new_pos[1], "z": new_pos[2]},
                            "v": {"x": new_vel[0], "y": new_vel[1], "z": new_vel[2]},
                            "fuel_kg": sat.fuel_kg,
                            "status": sat.status,
                            "mass_kg": sat.mass_kg,
                        })
                        
                        logger.debug(f"Propagated {sat_id}: pos={new_pos}, vel={new_vel}")
                except Exception as e:
                    logger.error(f"Error propagating satellite {sat_id}: {e}", exc_info=True)
            
            # ── Propagate debris ────────────────────────────────────────────
            for deb_id, deb in simulation_state.debris.items():
                try:
                    # RK4 propagation
                    state_vec = deb.eci  # [x, y, z, vx, vy, vz]
                    trajectory = propagate_rk4(state_vec, dt, RK4_SUB_STEP_MAX)
                    
                    if trajectory is not None and len(trajectory) > 0:
                        new_state = trajectory[-1]
                        
                        # Ensure it's a list
                        if hasattr(new_state, 'tolist'):
                            new_state = new_state.tolist()
                        elif not isinstance(new_state, list):
                            new_state = list(new_state)
                        
                        new_pos = [float(x) for x in new_state[:3]]
                        new_vel = [float(x) for x in new_state[3:]]
                        
                        # Update in-memory state
                        deb.position = new_pos
                        deb.velocity = new_vel
                        deb.last_updated = t_now + timedelta(seconds=dt)
                        
                        # Log trajectory
                        simulation_state.log_state(deb_id, deb.last_updated, new_state)
                        
                        # Track for persistence
                        updates.append({
                            "id": deb_id,
                            "type": "DEBRIS",
                            "r": {"x": new_pos[0], "y": new_pos[1], "z": new_pos[2]},
                            "v": {"x": new_vel[0], "y": new_vel[1], "z": new_vel[2]},
                        })
                        
                        logger.debug(f"Propagated {deb_id}: pos={new_pos}, vel={new_vel}")
                except Exception as e:
                    logger.error(f"Error propagating debris {deb_id}: {e}", exc_info=True)
            
            # Advance sim clock
            simulation_state.sim_time += timedelta(seconds=dt)
            logger.info(f"Propagation cycle complete: {len(updates)} objects updated, sim_time={simulation_state.sim_time}")
        
        # ── Persist to MongoDB via Go adapter ────────────────────────────────
        if updates:
            await self._persist_updates(updates)
    
    async def _persist_updates(self, updates: list[dict]) -> None:
        """
        Persist position updates to MongoDB via Go adapter.
        
        This is fire-and-forget; failures don't block the propagation loop.
        """
        try:
            # Format updates for Go adapter /log/telemetry endpoint
            formatted_objects = []
            for obj in updates:
                formatted_obj = {
                    "id": obj["id"],
                    "type": obj["type"],
                    "r": obj["r"],
                    "v": obj["v"],
                }
                if "fuel_kg" in obj:
                    formatted_obj["fuel_kg"] = obj["fuel_kg"]
                if "status" in obj:
                    formatted_obj["status"] = obj["status"]
                if "mass_kg" in obj:
                    formatted_obj["mass_kg"] = obj["mass_kg"]
                formatted_objects.append(formatted_obj)
            
            payload = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "objects": formatted_objects,
            }
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.go_adapter_url}/log/telemetry",
                    json=payload,
                    timeout=5.0,
                )
                response.raise_for_status()
                logger.info(f"✓ Persisted {len(updates)} objects to MongoDB")
        except Exception as e:
            logger.error(f"Failed to persist updates to MongoDB: {e}")


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
