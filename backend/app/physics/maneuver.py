"""RTN <-> ECI frame conversion and fuel calculation (Tsiolkovsky)."""
import numpy as np

G0 = 9.80665   # m/s^2
ISP_DEFAULT = 220.0  # seconds (cold gas thruster typical)


def rtn_to_eci(dv_rtn: np.ndarray, pos_eci: np.ndarray, vel_eci: np.ndarray) -> np.ndarray:
    """
    Convert delta-v from RTN frame to ECI frame.
    R = radial (pos direction), T = transverse (along-track), N = normal (cross-track)
    """
    r_hat = pos_eci / np.linalg.norm(pos_eci)
    h = np.cross(pos_eci, vel_eci)
    n_hat = h / np.linalg.norm(h)
    t_hat = np.cross(n_hat, r_hat)

    # RTN -> ECI rotation matrix (columns are basis vectors)
    rot = np.column_stack([r_hat, t_hat, n_hat])
    return rot @ dv_rtn


def eci_to_rtn(dv_eci: np.ndarray, pos_eci: np.ndarray, vel_eci: np.ndarray) -> np.ndarray:
    """Convert delta-v from ECI frame to RTN frame."""
    r_hat = pos_eci / np.linalg.norm(pos_eci)
    h = np.cross(pos_eci, vel_eci)
    n_hat = h / np.linalg.norm(h)
    t_hat = np.cross(n_hat, r_hat)

    rot = np.column_stack([r_hat, t_hat, n_hat])
    return rot.T @ dv_eci


def fuel_mass(delta_v: float, dry_mass: float, isp: float = ISP_DEFAULT) -> float:
    """
    Tsiolkovsky rocket equation.
    delta_v in m/s, dry_mass in kg.
    Returns propellant mass in kg.
    """
    ve = isp * G0
    mass_ratio = np.exp(delta_v / ve)
    return dry_mass * (mass_ratio - 1)
