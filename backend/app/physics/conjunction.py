"""
Conjunction detection — O(N log N) via scipy KDTree with 100m collision threshold.

Hackathon Specification:
  Collision when |r_sat(t) - r_deb(t)| < 0.100 km (100 meters)

Algorithm
---------
1. Build KDTree from debris positions (O(N log N) nearest-neighbor search)
2. Query satellite positions against tree with radius = threshold_km
3. For each candidate pair, refine TCA with scipy.optimize.minimize_scalar (bounded)
4. Flag miss_distance < 0.100 km as CRITICAL collision risk

Units: km / km/s throughout.
"""
from __future__ import annotations

import numpy as np
from dataclasses import dataclass
from scipy.spatial import KDTree
from scipy.optimize import minimize_scalar
from typing import Any

from physics.propagator import propagate_rk4, propagate_ivp

# ── Hackathon Spec-Exact Thresholds ───────────────────────────────────────────
COLLISION_THRESHOLD_KM = 0.100  # 100 meters - per hackathon specification
COARSE_KM              = 5.0    # Initial screening radius for KDTree query
CRITICAL_KM            = COLLISION_THRESHOLD_KM  # Alias for clarity
FINE_KM                = 5.0    # Refinement threshold
COARSE_STEP_S          = 60.0   # Time step for coarse grid


# ── 2C — Conjunction event dataclass ─────────────────────────────────────────

@dataclass
class ConjunctionEvent:
    """Single output unit of the conjunction pipeline — one instance per flagged pair."""
    object_a_id:        str           # id of first object
    object_b_id:        str           # id of second object
    tau:                float         # seconds from now until closest approach
    d_min:              float         # minimum separation distance in km
    delta_r_tca:        np.ndarray    # relative position vector at TCA, shape (3,)
    is_violation:       bool          # True if d_min < safety_threshold_km
    current_separation: float         # current distance between the two objects in km


# ── Step 1A — Relative State ──────────────────────────────────────────────────

def compute_relative_state(
    state_A: np.ndarray,
    state_B: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Compute the relative position, velocity, and scalar separation between two objects.

    Args:
        state_A: (6,) array [x, y, z, vx, vy, vz] for object A  (km, km/s)
        state_B: (6,) array [x, y, z, vx, vy, vz] for object B  (km, km/s)

    Returns:
        delta_r : (3,) ndarray — relative position vector A−B  (km)
        delta_v : (3,) ndarray — relative velocity vector A−B  (km/s)
        d       : float        — current scalar separation      (km)
    """
    r_A = state_A[:3]
    r_B = state_B[:3]
    v_A = state_A[3:]
    v_B = state_B[3:]

    delta_r = r_A - r_B
    delta_v = v_A - v_B
    d       = float(np.linalg.norm(delta_r))

    return delta_r, delta_v, d


# ── Step 1B/1C — Time of Closest Approach (linear) ───────────────────────────

def compute_tca(
    state_A: np.ndarray,
    state_B: np.ndarray,
) -> tuple[float, float, np.ndarray]:
    """
    Compute the linear Time of Closest Approach (TCA) between two objects.

    Uses the exact closed-form solution:
        tau = -dot(delta_r, delta_v) / dot(delta_v, delta_v)

    This minimises |delta_r + tau * delta_v|² with respect to tau.

    Args:
        state_A: (6,) array [x, y, z, vx, vy, vz] for object A  (km, km/s)
        state_B: (6,) array [x, y, z, vx, vy, vz] for object B  (km, km/s)

    Returns:
        tau         : float        — seconds until closest approach (negative = already passed)
        d_min       : float        — minimum separation distance at TCA  (km)
        delta_r_tca : (3,) ndarray — relative position vector at TCA     (km)
    """
    delta_r, delta_v, d = compute_relative_state(state_A, state_B)

    dv_sq = float(np.dot(delta_v, delta_v))

    # 1C — Safety guard: parallel / formation-flight trajectories
    if dv_sq < 1e-12:
        return 0.0, d, delta_r.copy()

    tau         = -float(np.dot(delta_r, delta_v)) / dv_sq
    delta_r_tca = delta_r + tau * delta_v
    d_min       = float(np.linalg.norm(delta_r_tca))

    return tau, d_min, delta_r_tca


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


def check_collision(sat_state: list[float], deb_state: list[float]) -> bool:
    """
    Check if satellite and debris are currently colliding.
    
    Hackathon Spec: Collision when |r_sat - r_deb| < 0.100 km (100 meters)
    
    Args:
        sat_state: [x, y, z, vx, vy, vz] in km and km/s
        deb_state: [x, y, z, vx, vy, vz] in km and km/s
    
    Returns:
        True if Euclidean distance < 0.100 km, False otherwise
    """
    sat_pos = np.array(sat_state[:3])
    deb_pos = np.array(deb_state[:3])
    
    euclidean_distance = np.linalg.norm(sat_pos - deb_pos)
    
    return euclidean_distance < COLLISION_THRESHOLD_KM


def check_conjunctions(bodies: list[dict[str, Any]]) -> list[dict]:
    """
    Lightweight per-tick check. KDTree at current positions, TCA over 1 orbit.
    bodies: [{"id", "position" (km), "velocity" (km/s)}, ...]
    """
    if len(bodies) < 2:
        return []

    positions = np.array([list(b["position"]) for b in bodies])
    ids       = [b["id"] for b in bodies]

    # Build k-d tree from all objects (O(N log N))
    tree  = KDTree(positions)
    
    # Find all pairs within coarse threshold (O(N) query)
    pairs = tree.query_pairs(r=COARSE_KM)

    results = []
    for i, j in pairs:
        sat_state = list(bodies[i]["position"]) + list(bodies[i]["velocity"])
        deb_state = list(bodies[j]["position"]) + list(bodies[j]["velocity"])

        # Check immediate collision first
        if check_collision(sat_state, deb_state):
            # Immediate collision! Distance < 100m
            current_distance = np.linalg.norm(
                np.array(bodies[i]["position"]) - np.array(bodies[j]["position"])
            )
            results.append({
                "sat1":             ids[i],
                "sat2":             ids[j],
                "tca_seconds":      0.0,  # Happening now
                "miss_distance_km": round(current_distance, 6),
                "miss_distance_m":  round(current_distance * 1000.0, 1),
                "severity":         "CRITICAL",
                "collision_imminent": True,
            })
            continue

        # Refine TCA for future conjunctions
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
            "collision_imminent": False,
        })

    results.sort(key=lambda x: x["miss_distance_km"])
    return results


# ── Step 2 additions ──────────────────────────────────────────────────────────

def is_tca_in_window(tau: float, t_window: float) -> bool:
    """
    2A — Time window validator.

    Returns True only if the closest approach is in the future and within
    the lookahead window.

    Args:
        tau:      seconds until closest approach (negative = already passed)
        t_window: lookahead window in seconds (e.g. 5400.0 for 90 minutes)

    Returns:
        False if tau < 0  (closest approach already happened)
        False if tau > t_window  (beyond prediction window)
        True  otherwise
    """
    if tau < 0:
        return False
    if tau > t_window:
        return False
    return True


def is_violation(d_min: float, safety_threshold_km: float) -> bool:
    """
    2B — Distance threshold checker.

    Args:
        d_min:                minimum separation distance in km (from compute_tca)
        safety_threshold_km:  hard safety distance in km (e.g. 0.100 for 100 m)

    Returns:
        True if the pair will violate the safety constraint (d_min < threshold)
    """
    return d_min < safety_threshold_km


def analyze_pair(
    obj_A,
    obj_B,
    t_window: float,
    safety_threshold_km: float,
) -> "ConjunctionEvent | None":
    """
    2D — Per-pair conjunction analysis.

    Computes TCA and relative state for a single pair of SimObjects.
    Returns None if the closest approach falls outside the time window.

    Args:
        obj_A:                SimObject — first object
        obj_B:                SimObject — second object
        t_window:             lookahead window in seconds
        safety_threshold_km:  hard safety distance in km

    Returns:
        ConjunctionEvent if TCA is within the window, else None.
    """
    tau, d_min, delta_r_tca = compute_tca(obj_A.state, obj_B.state)

    if not is_tca_in_window(tau, t_window):
        return None

    _, _, d_current = compute_relative_state(obj_A.state, obj_B.state)

    return ConjunctionEvent(
        object_a_id=        obj_A.id,
        object_b_id=        obj_B.id,
        tau=                tau,
        d_min=              d_min,
        delta_r_tca=        delta_r_tca,
        is_violation=       is_violation(d_min, safety_threshold_km),
        current_separation= d_current,
    )


# ── Step 3 — Full Conjunction Pipeline ───────────────────────────────────────

def screen_conjunctions(
    objects: list,
    candidate_pairs: list[tuple[str, str]],
    t_window: float = 5400.0,
    safety_threshold_km: float = 0.100,
) -> list[ConjunctionEvent]:
    """
    3A — Main conjunction screening function.

    Consumes KD-tree candidate pairs and runs analyze_pair on each.
    Does NOT re-implement the KD-tree — that is the caller's responsibility.

    Args:
        objects:              list of SimObject instances (all active objects)
        candidate_pairs:      list of (id_A, id_B) tuples from the KD-tree filter
        t_window:             lookahead window in seconds (default: 5400 = one orbit)
        safety_threshold_km:  hard safety distance in km  (default: 0.100 = 100 m)

    Returns:
        List of ConjunctionEvent — all pairs whose TCA falls within the window,
        both violations and non-violations. Caller filters as needed.
    """
    obj_map = {obj.id: obj for obj in objects}
    results: list[ConjunctionEvent] = []

    for id_A, id_B in candidate_pairs:
        obj_A = obj_map.get(id_A)
        obj_B = obj_map.get(id_B)

        # Skip missing or decayed objects
        if obj_A is None or obj_B is None:
            continue
        if getattr(obj_A, "decayed", False) or getattr(obj_B, "decayed", False):
            continue

        event = analyze_pair(obj_A, obj_B, t_window, safety_threshold_km)
        if event is not None:
            results.append(event)

    return results


def get_violations(conjunction_events: list[ConjunctionEvent]) -> list[ConjunctionEvent]:
    """
    3B — Violation filter helper.

    Args:
        conjunction_events: list of ConjunctionEvent instances

    Returns:
        Only events where is_violation == True, sorted by d_min ascending
        (most dangerous conjunction first).
    """
    violations = [e for e in conjunction_events if e.is_violation]
    violations.sort(key=lambda e: e.d_min)
    return violations


def serialize_conjunctions(conjunction_events: list[ConjunctionEvent]) -> list[dict]:
    """
    3C — Serialization for frontend.

    Converts ConjunctionEvent instances to JSON-serializable dicts in the
    exact structure the React/Vite frontend consumes.

    Args:
        conjunction_events: list of ConjunctionEvent instances

    Returns:
        List of dicts with keys:
            object_a_id, object_b_id, tau_seconds, tau_minutes,
            d_min_km, current_sep_km, is_violation, delta_r_tca
    """
    return [
        {
            "object_a_id":    event.object_a_id,
            "object_b_id":    event.object_b_id,
            "tau_seconds":    round(event.tau, 2),
            "tau_minutes":    round(event.tau / 60, 2),
            "d_min_km":       round(event.d_min, 4),
            "current_sep_km": round(event.current_separation, 4),
            "is_violation":   event.is_violation,
            "delta_r_tca":    event.delta_r_tca.tolist(),
        }
        for event in conjunction_events
    ]


def run_conjunction_analysis(
    objects: list,
    candidate_pairs: list[tuple[str, str]],
    t_window: float = 5400.0,
    safety_threshold_km: float = 0.100,
) -> dict:
    """
    3D — Single public entry point for the API layer.

    Call this after every simulation timestep, passing the KD-tree candidate
    pairs and the current list of SimObjects.

    Args:
        objects:              list of SimObject instances
        candidate_pairs:      list of (id_A, id_B) tuples from the KD-tree
        t_window:             lookahead window in seconds
        safety_threshold_km:  hard safety distance in km

    Returns:
        {
            "all_events":      list of serialized ConjunctionEvent dicts,
            "violations":      list of serialized violation dicts (d_min ascending),
            "violation_count": int,
            "event_count":     int,
        }
    """
    active = [o for o in objects if not getattr(o, "decayed", False)]

    all_events = screen_conjunctions(active, candidate_pairs, t_window, safety_threshold_km)
    violations = get_violations(all_events)

    return {
        "all_events":      serialize_conjunctions(all_events),
        "violations":      serialize_conjunctions(violations),
        "violation_count": len(violations),
        "event_count":     len(all_events),
    }


# ── 3F — Sanity test ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from state import SimObject  # type: ignore

    # Two objects on near-collision course — separation closing fast
    sat1 = SimObject(id="SAT-001", object_type="satellite",
                     state=np.array([6778.0, 0.0, 0.0, 0.0, 7.7102, 0.0]))
    sat2 = SimObject(id="SAT-002", object_type="satellite",
                     state=np.array([6778.0, 0.05, 0.0, 0.0, 7.7102, 0.01]))

    # Two objects safely separated
    sat3 = SimObject(id="SAT-003", object_type="satellite",
                     state=np.array([7200.0, 500.0, 0.0, 0.0, 7.2, 0.0]))

    candidate_pairs = [("SAT-001", "SAT-002"), ("SAT-001", "SAT-003")]

    result = run_conjunction_analysis(
        objects=[sat1, sat2, sat3],
        candidate_pairs=candidate_pairs,
        t_window=5400.0,
        safety_threshold_km=0.100,
    )

    print(f"Total events:    {result['event_count']}")
    print(f"Violations:      {result['violation_count']}")
    for v in result["violations"]:
        print(f"  {v['object_a_id']} x {v['object_b_id']} → "
              f"d_min={v['d_min_km']} km in {v['tau_minutes']} min")
