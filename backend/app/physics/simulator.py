"""
Multi-object orbital simulation orchestration layer.

This is the single entry point the API layer calls.
All state vectors are in ECI frame (J2000): km, km/s, seconds.
"""

import logging
from dataclasses import dataclass, field
from typing import List

import numpy as np

try:
    from .state import SimObject
    from .integrator import rk4_step, OrbitalDecayError
    from .constants import R_E
except ImportError:
    from state import SimObject  # type: ignore
    from integrator import rk4_step, OrbitalDecayError  # type: ignore
    from constants import R_E  # type: ignore

logger = logging.getLogger(__name__)


@dataclass
class SimConfig:
    t_start: float       # Simulation start time in seconds
    t_end: float         # Simulation end time in seconds
    h: float = 10.0      # RK4 timestep in seconds
    store_every: int = 1  # Store state in history every N steps


def propagate_all(objects: List[SimObject], config: SimConfig) -> List[SimObject]:
    """
    Propagate all objects forward in time using RK4.

    Args:
        objects: list of SimObject instances (satellites and/or debris)
        config:  SimConfig instance

    Returns:
        The same list of objects with populated history and decayed fields.
    """
    n_steps = int((config.t_end - config.t_start) / config.h)

    for obj in objects:
        obj.history.clear()
        obj.history.append(obj.state.copy())

        for step in range(1, n_steps + 1):
            try:
                obj.state = rk4_step(obj.state, config.h)
            except OrbitalDecayError as e:
                logger.warning(
                    "Object %s (%s) decayed at step %d: %s",
                    obj.id, obj.object_type, step, e
                )
                obj.decayed = True
                break

            if step % config.store_every == 0:
                obj.history.append(obj.state.copy())
        else:
            obj.decayed = False

    return objects


def serialize_results(objects: List[SimObject]) -> list:
    """
    Convert propagated SimObject list to a JSON-serializable structure.

    Returns:
        List of dicts with keys: id, object_type, decayed, trajectory.
        trajectory is a list of [x, y, z, vx, vy, vz] lists ordered by time.
    """
    return [
        {
            "id": obj.id,
            "object_type": obj.object_type,
            "decayed": obj.decayed,
            "trajectory": [state.tolist() for state in obj.history],
        }
        for obj in objects
    ]


def run_simulation(
    objects: List[SimObject],
    t_start: float,
    t_end: float,
    h: float = 10.0,
    store_every: int = 1,
) -> list:
    """
    Single public entry point for the API layer.

    Args:
        objects:     list of SimObject instances
        t_start:     simulation start time in seconds
        t_end:       simulation end time in seconds
        h:           RK4 timestep in seconds
        store_every: store state every N steps

    Returns:
        JSON-serializable list of simulation results.
    """
    config = SimConfig(t_start=t_start, t_end=t_end, h=h, store_every=store_every)
    propagate_all(objects, config)
    return serialize_results(objects)


if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from state import SimObject

    # ISS-like orbit: ~400 km altitude, circular
    sat1 = SimObject(
        id="SAT-001",
        object_type="satellite",
        state=np.array([6778.137, 0.0, 0.0, 0.0, 7.7102, 0.0]),
    )

    # Debris in slightly elliptical orbit
    deb1 = SimObject(
        id="DEB-001",
        object_type="debris",
        state=np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.2]),
    )

    results = run_simulation(
        objects=[sat1, deb1],
        t_start=0.0,
        t_end=5400.0,   # ~90 minutes, one full orbit
        h=10.0,         # 10 second timestep
        store_every=1,
    )

    for obj in results:
        print(f"{obj['id']} | decayed: {obj['decayed']} | steps stored: {len(obj['trajectory'])}")
        print(f"  Final state: {obj['trajectory'][-1]}")
