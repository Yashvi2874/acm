"""
Acceleration models for orbital simulation (ECI frame, J2000).

All inputs/outputs are NumPy arrays.
All constants imported from constants.py — never hardcoded.
"""

import numpy as np
from .constants import MU, R_E, J2


def compute_gravity(state: np.ndarray) -> np.ndarray:
    """
    Two-body gravitational acceleration.

    Args:
        state: (6,) array [x, y, z, vx, vy, vz] in km / km/s

    Returns:
        (3,) array [ax, ay, az] in km/s²
    """
    r = state[:3]
    r_mag = np.linalg.norm(r)
    return -(MU / r_mag**3) * r


def compute_j2(state: np.ndarray) -> np.ndarray:
    """
    J2 oblateness perturbation acceleration.

    Args:
        state: (6,) array [x, y, z, vx, vy, vz] in km / km/s

    Returns:
        (3,) array [ax_j2, ay_j2, az_j2] in km/s²
    """
    x, y, z = state[0], state[1], state[2]
    r_mag = np.linalg.norm(state[:3])

    factor = (3.0 * J2 * MU * R_E**2) / (2.0 * r_mag**5)
    z_ratio = (z / r_mag)**2

    return factor * np.array([
        x * (5.0 * z_ratio - 1.0),
        y * (5.0 * z_ratio - 1.0),
        z * (5.0 * z_ratio - 3.0),
    ])


def compute_acceleration(state: np.ndarray) -> np.ndarray:
    """
    Total acceleration = two-body gravity + J2 perturbation.

    Args:
        state: (6,) array [x, y, z, vx, vy, vz] in km / km/s

    Returns:
        (3,) array [ax_total, ay_total, az_total] in km/s²
    """
    return compute_gravity(state) + compute_j2(state)


def state_derivative(state: np.ndarray) -> np.ndarray:
    """
    Full time derivative of the state vector — called by the RK4 integrator.

    Args:
        state: (6,) array [x, y, z, vx, vy, vz] in km / km/s

    Returns:
        (6,) array [vx, vy, vz, ax, ay, az] — dS/dt
    """
    v = state[3:]
    a = compute_acceleration(state)
    return np.concatenate([v, a])
