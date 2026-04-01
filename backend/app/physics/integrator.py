"""
RK4 numerical integrator for orbital simulation (ECI frame, J2000).

All state vectors are NumPy arrays of shape (6,): [x, y, z, vx, vy, vz]
Time is in seconds, positions in km, velocities in km/s.
"""

import numpy as np
from .acceleration import state_derivative
from .constants import R_E


class OrbitalDecayError(Exception):
    """Raised when an object's trajectory intersects Earth's surface."""
    pass


def rk4_step(state: np.ndarray, h: float) -> np.ndarray:
    """
    Advance state vector by one RK4 timestep.

    Args:
        state: (6,) array [x, y, z, vx, vy, vz]
        h:     timestep in seconds

    Returns:
        (6,) array — updated state after timestep h

    Raises:
        OrbitalDecayError: if the new position is below Earth's surface
    """
    k1 = state_derivative(state)
    k2 = state_derivative(state + (h / 2) * k1)
    k3 = state_derivative(state + (h / 2) * k2)
    k4 = state_derivative(state + h * k3)

    new_state = state + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)

    r_mag = np.linalg.norm(new_state[:3])
    if r_mag < R_E:
        raise OrbitalDecayError(
            f"Object has impacted Earth's surface. |r| = {r_mag:.3f} km, below R_E = 6378.137 km"
        )

    return new_state


def propagate_single(state: np.ndarray, h: float, n_steps: int) -> list:
    """
    Propagate a single object forward n_steps RK4 steps.

    Args:
        state:   (6,) array — initial state vector
        h:       timestep in seconds
        n_steps: number of RK4 steps to perform

    Returns:
        List of (6,) arrays — trajectory including the initial state.
        If OrbitalDecayError occurs, returns trajectory up to that point.
    """
    trajectory = [state]

    for _ in range(n_steps):
        try:
            state = rk4_step(state, h)
        except OrbitalDecayError:
            break
        trajectory.append(state)

    return trajectory
