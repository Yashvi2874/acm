"""
Conjunction detection — O(N log N) via scipy KDTree.

Algorithm
---------
1. Propagate all debris to T time steps over `horizon_seconds` (coarse grid).
2. At each time step build a KDTree from debris positions.
3. Query all satellite positions against the tree with radius = threshold_km.
4. For each candidate pair, refine TCA with scipy.optimize.minimize_scalar (bounded).
5. Flag miss_distance < CRITICAL_KM as CRITICAL in the CDM.

Units: km / km/s throughout.
"""
from __future__ import annotations

import numpy as np
from scipy.spatial import KDTree
from scipy.optimize import minimize_scalar
from typing import Any

from physics.propagator import propagate_rk4, propagate_ivp

COARSE_KM   = 5.0
CRITICAL_KM = 0.1
FINE_KM     = 5.0
COARSE_STEP_S = 60.0


def time_of_closest_approach(
    sat_state: list[float],
    deb_state: list[float],
    t0: float = 0.0,
    max_seconds: float = 3600.0,
) -> tuple[float, float]:
    """
    Refine TCA by minimising |r_sat(t) - r_deb(t)| with minimize_scalar (bounded).
    Returns (tca_seconds, miss_distance_km).
    """
    s0 = np.array(sat_state, dtype=np.float64)
    d0 = np.array(deb_state, dtype=np.float64)

    if max_seconds <= 0.0:
        return t0, float(np.linalg.norm(s0[:3] - d0[:3]))

    def separation(dt: float) -> float:
        if dt <= 0.0:
            return float(np.linalg.norm(s0[:3] - d0[:3]))
        sub = min(dt, 30.0)
        s = propagate_rk4(s0.tolist(), dt, sub)[-1]
        d = propagate_rk4(d0.tolist(), dt, sub)[-1]
        return float(np.linalg.norm(np.array(s[:3]) - np.array(d[:3])))

    result = minimize_scalar(
        separation,
        bounds=(max(t0, 1e-3), t0 + max_seconds),
        method="bounded",
        options={"xatol": 1.0},
    )
    return float(result.x), float(result.fun)


def find_conjunctions(
    satellites: list[dict[str, Any]],
    debris: list[dict[str, Any]],
    horizon_seconds: float = 86400.0,
    threshold_km: float = COARSE_KM,
) -> list[dict]:
    """
    Full look-ahead conjunction screen.

    Steps:
      1. Propagate all debris + satellites over horizon via IVP (adaptive, fast).
      2. At each coarse time step build KDTree from debris positions.
      3. Query each satellite — O(N log M) per step.
      4. Refine TCA for candidate pairs only with minimize_scalar.
      5. Flag < CRITICAL_KM as CRITICAL.
    """
    if not satellites or not debris:
        return []

    n_steps   = max(1, int(horizon_seconds / COARSE_STEP_S))
    time_grid = np.linspace(0.0, horizon_seconds, n_steps + 1)

    sat_ids = [s["id"] for s in satellites]
    deb_ids = [d["id"] for d in debris]

    sat_trajs = [
        propagate_ivp(
            list(s["position"]) + list(s["velocity"]),
            horizon_seconds,
            t_eval_step=COARSE_STEP_S,
        )
        for s in satellites
    ]
    deb_trajs = [
        propagate_ivp(
            list(d["position"]) + list(d["velocity"]),
            horizon_seconds,
            t_eval_step=COARSE_STEP_S,
        )
        for d in debris
    ]

    candidate_pairs: set[tuple[str, str]] = set()

    for step_i in range(len(time_grid)):
        deb_pos = np.array([
            deb_trajs[j][min(step_i, len(deb_trajs[j]) - 1)][:3]
            for j in range(len(debris))
        ])
        tree = KDTree(deb_pos)

        for si in range(len(satellites)):
            sat_pos = np.array(
                sat_trajs[si][min(step_i, len(sat_trajs[si]) - 1)][:3]
            )
            for di in tree.query_ball_point(sat_pos, r=threshold_km):
                candidate_pairs.add((sat_ids[si], deb_ids[di]))

    if not candidate_pairs:
        return []

    results = []
    for sat_id, deb_id in candidate_pairs:
        si = sat_ids.index(sat_id)
        di = deb_ids.index(deb_id)

        sat_state = list(satellites[si]["position"]) + list(satellites[si]["velocity"])
        deb_state = list(debris[di]["position"])     + list(debris[di]["velocity"])

        tca_s, miss_km = time_of_closest_approach(
            sat_state, deb_state,
            t0=0.0,
            max_seconds=min(horizon_seconds, 3600.0),
        )

        if miss_km > FINE_KM:
            continue

        results.append({
            "sat1":             sat_id,
            "sat2":             deb_id,
            "tca_seconds":      round(tca_s, 1),
            "miss_distance_km": round(miss_km, 4),
            "miss_distance_m":  round(miss_km * 1000.0, 1),
            "severity":         "CRITICAL" if miss_km < CRITICAL_KM else "WARNING",
        })

    results.sort(key=lambda x: x["miss_distance_km"])
    return results


def check_conjunctions(bodies: list[dict[str, Any]]) -> list[dict]:
    """
    Lightweight per-tick check. KDTree at current positions, TCA over 1 orbit.
    bodies: [{"id", "position" (km), "velocity" (km/s)}, ...]
    """
    if len(bodies) < 2:
        return []

    positions = np.array([list(b["position"]) for b in bodies])
    ids       = [b["id"] for b in bodies]

    tree  = KDTree(positions)
    pairs = tree.query_pairs(r=COARSE_KM)

    results = []
    for i, j in pairs:
        sat_state = list(bodies[i]["position"]) + list(bodies[i]["velocity"])
        deb_state = list(bodies[j]["position"]) + list(bodies[j]["velocity"])

        tca_s, miss_km = time_of_closest_approach(
            sat_state, deb_state, t0=0.0, max_seconds=3600.0
        )

        if miss_km > FINE_KM:
            continue

        results.append({
            "sat1":             ids[i],
            "sat2":             ids[j],
            "tca_seconds":      round(tca_s, 1),
            "miss_distance_km": round(miss_km, 4),
            "miss_distance_m":  round(miss_km * 1000.0, 1),
            "severity":         "CRITICAL" if miss_km < CRITICAL_KM else "WARNING",
        })

    results.sort(key=lambda x: x["miss_distance_km"])
    return results
