"""
RK4 + J2 orbit propagator.

Units (throughout this module):
  position  : km
  velocity  : km/s
  time      : seconds
  MU        : km³/s²

Two integration paths:
  propagate_rk4()     — fixed-step RK4, sub-steps ≤ MAX_SUBSTEP_S (fast, predictable)
  propagate_ivp()     — scipy RK45 adaptive, better for long arcs (>1 orbit)

The simulate/step endpoint calls propagate_rk4 for each 10 s tick.
For longer requested durations the caller should use propagate_ivp.
"""
import numpy as np
from numpy.linalg import norm
from scipy.integrate import solve_ivp

# ── Constants (spec-exact) ────────────────────────────────────────────────────
MU = 398600.4418   # km³/s²
RE = 6378.137      # km
J2 = 1.08263e-3

# Sub-step cap: never integrate more than this in one RK4 step.
# 30 s gives <1 m position error per step at LEO; 60 s is the speed/precision limit.
MAX_SUBSTEP_S = 30.0


# ── Core physics ──────────────────────────────────────────────────────────────

def j2_acceleration(r_vec: np.ndarray) -> np.ndarray:
    """J2 oblateness perturbation acceleration (km/s²)."""
    x, y, z = r_vec
    r = norm(r_vec)
    factor = (3.0 / 2.0) * J2 * MU * RE**2 / r**5
    z2_r2 = z**2 / r**2
    ax = factor * x * (5.0 * z2_r2 - 1.0)
    ay = factor * y * (5.0 * z2_r2 - 1.0)
    az = factor * z * (5.0 * z2_r2 - 3.0)
    return np.array([ax, ay, az])


def equations_of_motion(t: float, state: np.ndarray) -> np.ndarray:
    """State derivative: [v, a_grav + a_J2]."""
    r = state[:3]
    v = state[3:]
    r_norm = norm(r)
    a_grav = -MU / r_norm**3 * r
    a_j2   = j2_acceleration(r)
    return np.concatenate([v, a_grav + a_j2])


# ── Fixed-step RK4 ────────────────────────────────────────────────────────────

def rk2_step(state: np.ndarray, dt: float) -> np.ndarray:
    """Single 2nd-order Runge-Kutta (midpoint) step."""
    k1 = equations_of_motion(0.0, state)
    k2 = equations_of_motion(0.0, state + dt * k1)
    return state + dt * 0.5 * (k1 + k2)


def rk4_step(state: np.ndarray, dt: float) -> np.ndarray:
    """Single 4th-order Runge-Kutta step."""
    k1 = equations_of_motion(0.0, state)
    k2 = equations_of_motion(0.0, state + dt / 2.0 * k1)
    k3 = equations_of_motion(0.0, state + dt / 2.0 * k2)
    k4 = equations_of_motion(0.0, state + dt * k3)
    return state + dt / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4)


def propagate_rk2(
    state: list[float],
    duration: float,
    dt: float = 10.0,
) -> list[list[float]]:
    """Fixed-step RK2 propagation with J2 perturbation."""
    s = np.array(state, dtype=np.float64)
    trajectory: list[list[float]] = [s.tolist()]

    t_elapsed = 0.0
    while t_elapsed < duration - 1e-9:
        step = min(dt, duration - t_elapsed)
        if step > MAX_SUBSTEP_S:
            sub = s.copy()
            sub_t = 0.0
            while sub_t < step - 1e-9:
                h = min(MAX_SUBSTEP_S, step - sub_t)
                sub = rk2_step(sub, h)
                sub_t += h
            s = sub
        else:
            s = rk2_step(s, step)

        trajectory.append(s.tolist())
        t_elapsed += step

    return trajectory


def propagate_rk4(
    state: list[float] | np.ndarray,
    duration: float,
    dt: float = 10.0,
) -> list[list[float]]:
    """
    Fixed-step RK4 propagation.

    Args:
        state    : [x, y, z, vx, vy, vz]  km / km/s (list or numpy array)
        duration : total propagation time  seconds
        dt       : requested output interval (seconds); internally sub-stepped
                   at MAX_SUBSTEP_S for accuracy

    Returns:
        List of state vectors at each output interval (including t=0).
    """
    # Ensure state is a numpy array
    if isinstance(state, list):
        s = np.array(state, dtype=np.float64)
    else:
        s = np.asarray(state, dtype=np.float64)
    
    trajectory: list[list[float]] = [s.tolist()]

    t_elapsed = 0.0
    while t_elapsed < duration - 1e-9:
        step = min(dt, duration - t_elapsed)

        # Sub-step if the requested interval exceeds the precision cap
        if step > MAX_SUBSTEP_S:
            sub = s.copy()
            sub_t = 0.0
            while sub_t < step - 1e-9:
                h = min(MAX_SUBSTEP_S, step - sub_t)
                sub = rk4_step(sub, h)
                sub_t += h
            s = sub
        else:
            s = rk4_step(s, step)

        trajectory.append(s.tolist())
        t_elapsed += step

    return trajectory


# ── Adaptive RK45 (scipy) ─────────────────────────────────────────────────────

def propagate_ivp(
    state: list[float],
    duration: float,
    rtol: float = 1e-9,
    atol: float = 1e-9,
    t_eval_step: float | None = None,
) -> list[list[float]]:
    """
    Adaptive RK45 propagation via scipy.integrate.solve_ivp.

    Preferred for long arcs (> 1 orbit, ~5400 s) where fixed-step RK4
    accumulates error. The adaptive stepper self-tunes for speed + accuracy.

    Args:
        state       : [x, y, z, vx, vy, vz]  km / km/s
        duration    : seconds
        rtol/atol   : solver tolerances (1e-9 gives sub-metre accuracy at LEO)
        t_eval_step : if set, return states at this interval (seconds);
                      otherwise returns only start + end

    Returns:
        List of state vectors at requested evaluation times.
    """
    s0 = np.array(state, dtype=np.float64)

    t_eval = None
    if t_eval_step is not None and t_eval_step > 0:
        t_eval = np.arange(0.0, duration + t_eval_step, t_eval_step)
        t_eval = t_eval[t_eval <= duration + 1e-9]

    sol = solve_ivp(
        equations_of_motion,
        t_span=(0.0, duration),
        y0=s0,
        method="RK45",
        t_eval=t_eval,
        rtol=rtol,
        atol=atol,
        dense_output=False,
    )

    if not sol.success:
        raise RuntimeError(f"solve_ivp failed: {sol.message}")

    # sol.y shape: (6, n_points) — transpose to list of state vectors
    return sol.y.T.tolist()
