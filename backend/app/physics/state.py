"""
SimObject data model for orbital simulation.

All state vectors are in the Earth-Centered Inertial (ECI) frame, J2000 epoch:
  - Positions in km
  - Velocities in km/s
  - Time in seconds
"""

from dataclasses import dataclass, field
from typing import List
import numpy as np


@dataclass
class SimObject:
    """Represents any object in the simulation — satellite or debris."""

    id: str                          # Unique identifier, e.g. "SAT-001", "DEB-042"
    object_type: str                 # "satellite" or "debris"
    state: np.ndarray                # Shape (6,): [x, y, z, vx, vy, vz] in ECI (km, km/s)
    history: List[np.ndarray] = field(default_factory=list)  # State vector at each timestep
