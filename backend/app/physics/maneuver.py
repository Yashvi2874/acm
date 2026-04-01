"""
RTN frame math + Tsiolkovsky fuel model + evasion/recovery/EOL logic.

Units (throughout):
  positions  : km
  velocities : km/s
  delta-v    : km/s
  mass/fuel  : kg
  time       : seconds

Key constants (spec-exact):
  G0  = 9.80665e-3  km/s²   (= 9.80665 m/s² converted)
  ISP = 300.0 s
  MAX_BURN_KMS = 0.015 km/s  (15 m/s per-burn cap)
  BURN_COOLDOWN_S = 600 s
"""
from __future__ import annotations

import math
import numpy as np
from numpy.linalg import norm

# ── Constants ─────────────────────────────────────────────────────────────────
G0  = 9.80665e-3   # km/s²  (spec: convert 9.80665 m/s² → km/s²)
ISP = 300.0        # seconds

MAX_BURN_KMS    = 0.015   # km/s  (15 m/s per-burn cap)
BURN_COOLDOWN_S = 600.0   # seconds between burns on same satellite

FUEL_EOL_THRESHOLD_KG = 2.5   # 5% of nominal 50 kg initial fuel
GRAVEYARD_RAISE_KM    = 200.0 # km above constellation altitude


# ── RTN frame construction ────────────────────────────────────────────────────

def eci_to_rtn_matrix(r_vec: np.ndarray, v_vec: np.ndarray) -> np.ndarray:
    """
    Build the ECI→RTN rotation matrix (rows are RTN basis vectors).

    R_hat : radial      (along position vector)
    N_hat : normal      (along angular momentum h = r × v)
    T_hat : transverse  (completes right-hand system: N × R)
    """
    R_hat = r_vec / norm(r_vec)
    N_hat = np.cross(r_vec, v_vec)
    N_hat = N_hat / norm(N_hat)
    T_hat = np.cross(N_hat, R_hat)
    # Rows are basis vectors → matrix transforms ECI vector to RTN components
    return np.array([R_hat, T_hat, N_hat])


def rtn_to_eci(delta_v_rtn: np.ndarray, r_vec: np.ndarray, v_vec: np.ndarray) -> np.ndarray:
    """
    Rotate a delta-v from RTN frame to ECI frame.
    M.T maps RTN → ECI (M maps ECI → RTN, so transpose inverts it).
    """
    M = eci_to_rtn_matrix(r_vec, v_vec)
    return M.T @ delta_v_rtn


def eci_to_rtn(delta_v_eci: np.ndarray, r_vec: np.ndarray, v_vec: np.ndarray) -> np.ndarray:
    """Rotate a delta-v from ECI frame to RTN frame."""
    M = eci_to_rtn_matrix(r_vec, v_vec)
    return M @ delta_v_eci


# ── Tsiolkovsky fuel model ────────────────────────────────────────────────────

def fuel_consumed(m_current: float, delta_v_kms: float, isp: float = ISP) -> float:
    """
    Tsiolkovsky rocket equation — spec-exact.

    Args:
        m_current    : current wet mass (kg)
        delta_v_kms  : delta-v magnitude (km/s)
        isp          : specific impulse (s)

    Returns:
        propellant mass consumed (kg)
    """
    exponent = delta_v_kms / (isp * G0)
    return m_current * (1.0 - math.exp(-exponent))


def fuel_mass(delta_v_ms: float, dry_mass: float, isp: float = ISP) -> float:
    """
    Compatibility wrapper — accepts delta_v in m/s (legacy callers).
    Converts to km/s and delegates to fuel_consumed.
    """
    return fuel_consumed(dry_mass, delta_v_ms / 1000.0, isp)


# ── Evasion maneuver ──────────────────────────────────────────────────────────

def plan_evasion_burn(
    sat_pos: list[float],
    sat_vel: list[float],
    debris_pos: list[float],
    debris_vel: list[float],
    tca_seconds: float,
) -> dict:
    """
    Plan a prograde evasion burn to avoid a conjunction.

    Strategy:
      - Preferred direction: prograde (+T) to phase ahead of debris.
      - If debris is approaching from behind, use retrograde (-T).
      - Magnitude: 0.01 km/s default, capped at MAX_BURN_KMS.
      - A prograde burn of 0.01–0.05 km/s shifts position ~10–50 km
        after one orbit (~90 min at LEO).

    Returns dict with delta_v_rtn (km/s) and metadata.
    """
    r = np.array(sat_pos)
    v = np.array(sat_vel)
    r_deb = np.array(debris_pos)
    v_deb = np.array(debris_vel)

    # Relative position of debris w.r.t. satellite
    dr = r_deb - r

    # dot(dr, v_hat) > 0  → debris is ahead in the orbit → prograde burn
    #                        phases satellite forward, increasing separation
    # dot(dr, v_hat) <= 0 → debris is behind → retrograde burn moves us away
    prograde = float(np.dot(dr, v / norm(v))) > 0

    dv_mag = min(0.01, MAX_BURN_KMS)   # default 10 m/s

    # RTN: T-direction is index 1
    dv_rtn = np.array([0.0, dv_mag if prograde else -dv_mag, 0.0])

    # Fuel cost
    m_dummy = 4.0  # will be recalculated by caller with actual mass
    cost = fuel_consumed(m_dummy, dv_mag)

    return {
        "delta_v_rtn": dv_rtn.tolist(),
        "delta_v_magnitude_kms": dv_mag,
        "direction": "prograde" if prograde else "retrograde",
        "estimated_separation_km": dv_mag * tca_seconds * 0.5,  # rough estimate
        "fuel_cost_per_kg": cost / m_dummy,
    }


def plan_recovery_burn(
    sat_pos: list[float],
    sat_vel: list[float],
    nominal_pos: list[float],
    nominal_vel: list[float],
) -> dict | None:
    """
    Plan a recovery burn to return satellite within 10 km of nominal slot.

    Strategy:
      - Compute drift in RTN frame.
      - Apply opposite-direction burn of same magnitude as evasion.
      - Time it ~half-orbit later (T/2 ≈ 2700 s for 400 km LEO).
      - Returns None if already within 10 km box.
    """
    r = np.array(sat_pos)
    v = np.array(sat_vel)
    r_nom = np.array(nominal_pos)

    drift_km = float(norm(r - r_nom))
    if drift_km <= 10.0:
        return None   # already within box

    # Drift vector in RTN
    drift_eci = r_nom - r
    drift_rtn = eci_to_rtn(drift_eci, r, v)

    # Burn magnitude: proportional to drift, capped at MAX_BURN_KMS
    # Rule of thumb: 0.01 km/s ≈ 10 km correction per orbit
    dv_mag = min(drift_km * 0.001, MAX_BURN_KMS)
    dv_rtn = (drift_rtn / norm(drift_rtn)) * dv_mag

    half_orbit_s = 2700.0  # ~45 min, half of 90-min LEO orbit

    return {
        "delta_v_rtn": dv_rtn.tolist(),
        "delta_v_magnitude_kms": round(dv_mag, 6),
        "execute_after_seconds": half_orbit_s,
        "drift_km": round(drift_km, 3),
    }


# ── EOL check ─────────────────────────────────────────────────────────────────

def check_eol(
    satellite_id: str,
    fuel_kg: float,
    sat_pos: list[float],
    sat_vel: list[float],
    constellation_alt_km: float = 400.0,
) -> dict | None:
    """
    Check if satellite has reached end-of-life fuel threshold.
    If so, plan a graveyard orbit maneuver (prograde burn to raise perigee
    ~200 km above constellation altitude).

    Returns a graveyard burn dict, or None if fuel is sufficient.
    """
    if fuel_kg >= FUEL_EOL_THRESHOLD_KG:
        return None

    r = np.array(sat_pos)
    v = np.array(sat_vel)

    # Hohmann first burn: raise apogee to graveyard altitude
    # Semi-major axis of transfer ellipse: a = (r_current + r_graveyard) / 2
    MU = 398600.4418   # km³/s²
    r_mag    = float(norm(r))
    r_grave  = r_mag + GRAVEYARD_RAISE_KM
    a_trans  = (r_mag + r_grave) / 2.0
    v_circ   = math.sqrt(MU / r_mag)           # current circular velocity
    v_trans  = math.sqrt(MU * (2.0 / r_mag - 1.0 / a_trans))  # transfer perigee velocity
    dv_graveyard = min(abs(v_trans - v_circ), MAX_BURN_KMS)

    dv_rtn = [0.0, dv_graveyard, 0.0]   # prograde

    return {
        "satellite_id": satellite_id,
        "trigger": "EOL_FUEL_LOW",
        "fuel_remaining_kg": round(fuel_kg, 4),
        "threshold_kg": FUEL_EOL_THRESHOLD_KG,
        "graveyard_burn": {
            "delta_v_rtn": dv_rtn,
            "delta_v_magnitude_kms": round(dv_graveyard, 6),
            "direction": "prograde",
            "target_altitude_km": round(constellation_alt_km + GRAVEYARD_RAISE_KM, 1),
        },
    }
