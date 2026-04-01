"""RK4 orbit propagator with J2 perturbation."""
import numpy as np

MU = 3.986004418e14   # Earth gravitational parameter (m^3/s^2)
RE = 6378137.0        # Earth equatorial radius (m)
J2 = 1.08262668e-3    # J2 coefficient


def _acceleration(state: np.ndarray) -> np.ndarray:
    x, y, z = state[0], state[1], state[2]
    r = np.sqrt(x**2 + y**2 + z**2)
    r2 = r * r
    r5 = r2 * r2 * r

    # Two-body
    a = -MU / r**3 * state[:3]

    # J2 perturbation
    factor = 1.5 * J2 * MU * RE**2 / r5
    z2_r2 = 5 * z**2 / r2
    a[0] += factor * x * (z2_r2 - 1)
    a[1] += factor * y * (z2_r2 - 1)
    a[2] += factor * z * (z2_r2 - 3)

    return a


def _derivatives(state: np.ndarray) -> np.ndarray:
    vel = state[3:6]
    acc = _acceleration(state)
    return np.concatenate([vel, acc])


def _rk4_step(state: np.ndarray, dt: float) -> np.ndarray:
    k1 = _derivatives(state)
    k2 = _derivatives(state + 0.5 * dt * k1)
    k3 = _derivatives(state + 0.5 * dt * k2)
    k4 = _derivatives(state + dt * k3)
    return state + (dt / 6.0) * (k1 + 2*k2 + 2*k3 + k4)


def propagate_rk4(state: list[float], duration: float, dt: float = 10.0) -> list[list[float]]:
    """
    Propagate state vector [x,y,z,vx,vy,vz] (m, m/s) for `duration` seconds.
    Returns list of state vectors at each step.
    """
    s = np.array(state, dtype=float)
    trajectory = [s.tolist()]
    t = 0.0
    while t < duration:
        step = min(dt, duration - t)
        s = _rk4_step(s, step)
        trajectory.append(s.tolist())
        t += step
    return trajectory
