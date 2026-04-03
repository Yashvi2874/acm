"""
decision.py — Autonomous Maneuver Decision Layer

Decision layer:
- does NOT compute physics
- only selects and schedules maneuvers
- uses ΔV-based comparison for optimality
- enforces constraints via scheduling

Imports from:
  maneuver.py   — all physics / fuel math
  conjunction.py — threat detection
  state_store.py — SimulationState, ScheduledBurn

Never duplicates logic from those modules.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import numpy as np

from physics.maneuver import (
    MU,
    BurnLimitExceeded,
    get_orbital_params,
    hohmann_transfer,
    one_tangent_burn,
    plane_change_angle,
    compute_delta_v_vector,
    split_delta_v,
    compute_target_velocity_circular,
    compute_fuel_used,
    apply_sequence_with_fuel,
    recovery_controller,
    initialize_mass,
    create_satellite_fleet,
)
from state_store import SimulationState, ScheduledBurn

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
COLLISION_RADIUS   = 0.2     # km — safety margin for evasion trigger
STATION_KEEP_KM    = 10.0    # km — station-keeping box radius
BURN_LIMIT         = 0.015   # km/s — per-burn ΔV cap
COOLDOWN           = 600     # seconds — minimum gap between burns on same satellite
FUEL_EOL_THRESHOLD = 10.0    # kg — fuel level that triggers EOL handling
GRAVEYARD_RAISE_KM = 200.0   # km — altitude raise for graveyard orbit


# ── Step 1 — Collision risk assessment ───────────────────────────────────────

def assess_collision_risk(d_min: float, t_tca: float) -> str:
    """
    Classify conjunction severity from miss distance and time to closest approach.

    Args:
        d_min : minimum separation distance, km
        t_tca : time to closest approach, seconds

    Returns:
        "LOW" | "MEDIUM" | "HIGH"
    """
    if d_min > 5.0:
        return "LOW"
    elif 0.1 < d_min <= 5.0:
        if t_tca > 12 * 3600:
            return "MEDIUM"
        else:
            return "HIGH"
    else:
        return "HIGH"


# ── Step 2 — Evasion maneuver planner ────────────────────────────────────────

def plan_evasion_burn(state: np.ndarray, threat: dict) -> dict:
    """
    Plan an evasion burn for a conjunction threat.

    Strategy selection:
        t_tca > orbital period  → phasing (T direction)
        d_min < COLLISION_RADIUS → radial  (R direction)
        otherwise               → combined (T + R)

    Args:
        state  : (6,) ECI state of satellite, km / km/s
        threat : conjunction dict with keys "d_min", "t_tca", "object_b_id"

    Returns:
        {
            "dV_eci":  np.array (3,),  # ΔV vector in ECI, km/s
            "method":  str,            # "phasing" | "radial" | "combined"
            "total_dV": float,         # magnitude, km/s
        }
    """
    params = get_orbital_params(state)
    T_orbit = params["T"]
    r       = params["r"]

    # Step 2-1: determine strategy from threat geometry
    if threat["t_tca"] > T_orbit:
        method = "phasing"
    elif threat["d_min"] < COLLISION_RADIUS:
        method = "radial"
    else:
        method = "combined"

    # Step 2-2: build RTN frame and construct evasion ΔV
    from physics.maneuver import build_rtn_frame
    R_hat, T_hat, N_hat = build_rtn_frame(state)

    # Evasion magnitude: enough to open separation by 2× COLLISION_RADIUS
    # Use a conservative fixed ΔV within the burn cap
    dv_mag = min(BURN_LIMIT, 0.010)   # 10 m/s — safe, within cap

    if method == "phasing":
        dV_eci = T_hat * dv_mag        # prograde — change phase
    elif method == "radial":
        dV_eci = R_hat * dv_mag        # radial — change altitude immediately
    else:
        # combined: split equally between T and R
        dV_eci = (T_hat + R_hat) * (dv_mag / math.sqrt(2.0))

    return {
        "dV_eci":   dV_eci,
        "method":   method,
        "total_dV": float(np.linalg.norm(dV_eci)),
    }


# ── Step 3 — Recovery trigger ─────────────────────────────────────────────────

def check_recovery_needed(drift_km: float) -> bool:
    """
    Return True if the satellite has drifted outside the station-keeping box.

    Args:
        drift_km : current distance from nominal slot, km
    """
    return drift_km > STATION_KEEP_KM


# ── Step 4 — Maneuver strategy selection (ΔV-optimal) ────────────────────────

def select_best_maneuver(
    state: np.ndarray,
    target_state: np.ndarray,
    current_mass_kg: float,
) -> dict:
    """
    Select the lowest-fuel maneuver strategy by comparing ΔV costs.

    Candidates evaluated:
        1. Hohmann transfer (if radii differ)
        2. One-tangent burn  (if radii differ, a_tx = 1.05 × Hohmann a_tx)
        3. Plane change      (if inclination differs)

    Falls back to velocity-vector method if all transfer methods exceed the
    burn cap or raise BurnLimitExceeded.

    Args:
        state          : (6,) current ECI state
        target_state   : (6,) target ECI state
        current_mass_kg: current total wet mass, kg

    Returns:
        {
            "method":   str,
            "total_dV": float,   # km/s
            "fuel_kg":  float,   # estimated propellant, kg
            "plan":     dict,    # raw output from the chosen function
        }
    """
    p_cur = get_orbital_params(state)
    p_tgt = get_orbital_params(target_state)
    r_cur = p_cur["r"]
    r_tgt = p_tgt["r"]

    options: list[dict] = []

    # ── Option 1: Hohmann ────────────────────────────────────────────────────
    if abs(r_cur - r_tgt) > 0.1:   # only if radii differ meaningfully
        try:
            h = hohmann_transfer(state, r_tgt)
            fuel = compute_fuel_used(h["dV_total"], current_mass_kg)
            options.append({
                "method":   "hohmann",
                "total_dV": h["dV_total"],
                "fuel_kg":  fuel,
                "plan":     h,
            })
        except BurnLimitExceeded:
            pass   # too large for single burn — still record for splitting

    # ── Option 2: One-tangent burn ───────────────────────────────────────────
    if abs(r_cur - r_tgt) > 0.1:
        try:
            a_tx_hohmann = (r_cur + r_tgt) / 2.0
            a_tx_ot      = a_tx_hohmann * 1.05   # 5% larger → faster transfer
            ot = one_tangent_burn(state, r_tgt, a_tx_ot)
            fuel = compute_fuel_used(ot["dV_total"], current_mass_kg)
            options.append({
                "method":   "one_tangent",
                "total_dV": ot["dV_total"],
                "fuel_kg":  fuel,
                "plan":     ot,
            })
        except (BurnLimitExceeded, ValueError):
            pass

    # ── Option 3: Plane change ───────────────────────────────────────────────
    h_cur = np.cross(np.array(state[:3]), np.array(state[3:]))
    h_tgt = np.cross(np.array(target_state[:3]), np.array(target_state[3:]))
    h_cur_hat = h_cur / np.linalg.norm(h_cur)
    h_tgt_hat = h_tgt / np.linalg.norm(h_tgt)

    i_cur  = math.acos(max(-1.0, min(1.0, float(h_cur_hat[2]))))
    i_tgt  = math.acos(max(-1.0, min(1.0, float(h_tgt_hat[2]))))
    raan_cur = math.atan2(h_cur_hat[0], -h_cur_hat[1])
    raan_tgt = math.atan2(h_tgt_hat[0], -h_tgt_hat[1])

    if abs(i_cur - i_tgt) > math.radians(0.1):
        theta = plane_change_angle(i_cur, raan_cur, i_tgt, raan_tgt)["theta"]
        V_i   = float(np.linalg.norm(state[3:]))
        dV_pc = 2.0 * V_i * math.sin(theta / 2.0)
        fuel  = compute_fuel_used(dV_pc, current_mass_kg)
        options.append({
            "method":   "plane_change",
            "total_dV": dV_pc,
            "fuel_kg":  fuel,
            "plan":     {"theta": theta, "dV_total": dV_pc},
        })

    # ── Fallback: velocity vector method ─────────────────────────────────────
    if not options:
        from physics.maneuver import generate_recovery_target
        v_tgt = generate_recovery_target(state, target_state)
        dv    = compute_delta_v_vector(state, v_tgt)
        fuel  = compute_fuel_used(dv["dV"], current_mass_kg)
        options.append({
            "method":   "velocity_vector",
            "total_dV": dv["dV"],
            "fuel_kg":  fuel,
            "plan":     dv,
        })

    # ── Select minimum fuel cost ──────────────────────────────────────────────
    best = min(options, key=lambda x: x["fuel_kg"])
    return best


# ── Step 5 — Burn scheduling with cooldown ────────────────────────────────────

def schedule_burns(
    sat_id: str,
    burns: list,
    current_time: datetime,
    sim_state: SimulationState,
) -> list[str]:
    """
    Enqueue a list of ΔV burns into the simulation maneuver queue,
    spacing each burn by COOLDOWN seconds.

    Args:
        sat_id       : satellite identifier
        burns        : list of (3,) ECI ΔV arrays from split_delta_v
        current_time : UTC datetime of the first burn
        sim_state    : SimulationState singleton

    Returns:
        list of burn_ids that were enqueued
    """
    burn_ids = []
    for i, dv in enumerate(burns):
        burn_time = current_time + timedelta(seconds=i * COOLDOWN)
        burn = ScheduledBurn(
            satellite_id=sat_id,
            delta_v_rtn=dv.tolist(),   # stored as RTN; sim tick converts via rtn_to_eci
            burn_time=burn_time,
        )
        sim_state.enqueue_burn(burn)
        burn_ids.append(burn.burn_id)
        logger.debug("Scheduled burn %s for %s at %s  |ΔV|=%.4f km/s",
                     burn.burn_id, sat_id, burn_time.isoformat(),
                     float(np.linalg.norm(dv)))
    return burn_ids


# ── Step 6 — Fuel sync back to SatelliteState ────────────────────────────────

def sync_fuel(sat_id: str, burns: list, sim_state: SimulationState,
              fleet: dict) -> None:
    """
    Apply fuel consumption for a burn sequence and write the result back
    to the SatelliteState in simulation_state.

    Args:
        sat_id    : satellite identifier
        burns     : list of (3,) ECI ΔV arrays
        sim_state : SimulationState singleton
        fleet     : dict from create_satellite_fleet — per-satellite mass states
    """
    if sat_id not in fleet:
        logger.warning("sync_fuel: %s not in fleet — skipping", sat_id)
        return

    mass_state = fleet[sat_id]["mass"]
    try:
        apply_sequence_with_fuel(mass_state, burns)
    except ValueError as e:
        logger.warning("sync_fuel: %s insufficient fuel — %s", sat_id, e)
        return

    # Write back to SatelliteState
    sat = sim_state.satellites.get(sat_id)
    if sat:
        sat.fuel_kg = mass_state["m_fuel"]
        sat.mass_kg = mass_state["m_total"]


# ── Step 7 — EOL check and graveyard scheduling ───────────────────────────────

def check_eol(sat) -> bool:
    """
    Return True if the satellite has reached end-of-life fuel threshold.

    Args:
        sat : SatelliteState instance
    """
    return sat.fuel_kg < FUEL_EOL_THRESHOLD


def schedule_graveyard(
    sat_id: str,
    sat,
    current_time: datetime,
    sim_state: SimulationState,
    fleet: dict,
) -> list[str]:
    """
    Plan and schedule a graveyard orbit raise for an EOL satellite.

    Raises the orbit by GRAVEYARD_RAISE_KM above current altitude using
    Hohmann transfer. Burns are split and scheduled with cooldown spacing.

    Args:
        sat_id       : satellite identifier
        sat          : SatelliteState instance
        current_time : current simulation UTC time
        sim_state    : SimulationState singleton
        fleet        : per-satellite mass fleet dict

    Returns:
        list of scheduled burn_ids (empty if insufficient fuel)
    """
    state   = np.array(sat.position + sat.velocity)
    r_cur   = float(np.linalg.norm(state[:3]))
    r_grave = r_cur + GRAVEYARD_RAISE_KM

    try:
        plan  = hohmann_transfer(state, r_grave)
        burns = split_delta_v(plan["dV_A_eci"]) + split_delta_v(plan["dV_B_eci"])
    except BurnLimitExceeded:
        # Burns exceed cap — split the total ΔV directly
        from physics.maneuver import generate_recovery_target
        v_tgt = np.array(sat.nominal_slot["velocity"]) * (
            math.sqrt(MU / r_grave) / max(float(np.linalg.norm(sat.velocity)), 1e-9)
        )
        dv_result = compute_delta_v_vector(state, v_tgt)
        burns = split_delta_v(dv_result["dV_eci"])
    except Exception as e:
        logger.error("schedule_graveyard: %s failed — %s", sat_id, e)
        return []

    burn_ids = schedule_burns(sat_id, burns, current_time, sim_state)
    sync_fuel(sat_id, burns, sim_state, fleet)
    sat.status = "decommissioned"
    logger.info("EOL: %s scheduled graveyard raise to %.1f km", sat_id, r_grave - 6378.137)
    return burn_ids


# ── Step 8 — Main decision loop ───────────────────────────────────────────────

def decision_step(
    sim_state: SimulationState,
    current_time: datetime,
    fleet: dict,
) -> dict:
    """
    Run one decision cycle across all satellites.

    For each satellite, in priority order:
        1. HIGH collision risk  → evasion burn
        2. Station-keeping drift → recovery maneuver
        3. EOL fuel threshold   → graveyard orbit

    Args:
        sim_state    : SimulationState singleton
        current_time : current simulation UTC time
        fleet        : per-satellite mass fleet from create_satellite_fleet

    Returns:
        {
            "evasions":    list of {sat_id, threat_id, burn_ids, method}
            "recoveries":  list of {sat_id, case, burn_ids}
            "eol":         list of {sat_id, burn_ids}
            "no_action":   list of sat_ids
        }
    """
    evasions:   list[dict] = []
    recoveries: list[dict] = []
    eol_list:   list[dict] = []
    no_action:  list[str]  = []

    # Build conjunction lookup: sat_id → worst threat this tick
    # Uses the CDM warnings already computed by simulate.py step 7
    threat_map: dict[str, dict] = {}
    for w in sim_state.active_cdm_warnings:
        sid = w.object_1_id
        entry = {
            "object_b_id":  w.object_2_id,
            "d_min":        w.miss_distance_km,
            "t_tca":        0.0,   # CDMWarning doesn't store TCA seconds — use 0 (worst case)
        }
        # Keep only the closest threat per satellite
        if sid not in threat_map or entry["d_min"] < threat_map[sid]["d_min"]:
            threat_map[sid] = entry

    for sat_id, sat in sim_state.satellites.items():
        state = np.array(sat.position + sat.velocity)

        # ── Priority 1: collision risk ────────────────────────────────────────
        threat = threat_map.get(sat_id)
        if threat:
            risk = assess_collision_risk(threat["d_min"], threat["t_tca"])
            if risk == "HIGH":
                plan  = plan_evasion_burn(state, threat)
                burns = split_delta_v(plan["dV_eci"])
                ids   = schedule_burns(sat_id, burns, current_time, sim_state)
                sync_fuel(sat_id, burns, sim_state, fleet)
                evasions.append({
                    "sat_id":    sat_id,
                    "threat_id": threat["object_b_id"],
                    "burn_ids":  ids,
                    "method":    plan["method"],
                    "total_dV":  plan["total_dV"],
                })
                logger.info("EVASION: %s → %s  method=%s  ΔV=%.4f km/s",
                            sat_id, threat["object_b_id"],
                            plan["method"], plan["total_dV"])
                continue   # evasion takes priority — skip recovery/EOL this tick

        # ── Priority 2: station-keeping recovery ──────────────────────────────
        if check_recovery_needed(sat.drift_km):
            slot_state = np.array(
                sat.nominal_slot["position"] + sat.nominal_slot["velocity"]
            )
            mass_state = fleet.get(sat_id, {}).get("mass") or initialize_mass()

            result = recovery_controller(
                state=state,
                slot_state=slot_state,
                mass_state=mass_state,
                dt=0.0,   # slot already propagated by simulate.py each tick
            )

            if result["action"] == "recover":
                burns = result["result"]["burns"]
                ids   = schedule_burns(sat_id, burns, current_time, sim_state)
                # Fuel already deducted inside recovery_controller → sync back
                sat.fuel_kg = mass_state["m_fuel"]
                sat.mass_kg = mass_state["m_total"]
                recoveries.append({
                    "sat_id":   sat_id,
                    "case":     result["case"]["case"],
                    "burn_ids": ids,
                    "total_dV": result["result"]["total_dV"],
                    "error_km": result["error_km"],
                })
                logger.info("RECOVERY: %s  case=%s  drift=%.2f km  ΔV=%.4f km/s",
                            sat_id, result["case"]["case"],
                            sat.drift_km, result["result"]["total_dV"])
                continue

        # ── Priority 3: EOL ───────────────────────────────────────────────────
        if check_eol(sat):
            ids = schedule_graveyard(sat_id, sat, current_time, sim_state, fleet)
            eol_list.append({"sat_id": sat_id, "burn_ids": ids})
            logger.info("EOL: %s  fuel=%.3f kg", sat_id, sat.fuel_kg)
            continue

        no_action.append(sat_id)

    return {
        "evasions":   evasions,
        "recoveries": recoveries,
        "eol":        eol_list,
        "no_action":  no_action,
    }


# ── Fleet initialisation helper ───────────────────────────────────────────────

def init_fleet_from_sim(sim_state: SimulationState) -> dict:
    """
    Build a fleet mass-state dict from the current SimulationState.

    Call this once after /api/simulate/init, then pass the fleet dict
    to decision_step on every tick.

    Args:
        sim_state : SimulationState singleton

    Returns:
        fleet dict compatible with create_satellite_fleet output
    """
    satellites = [
        {
            "id":    sid,
            "state": sat.position + sat.velocity,
        }
        for sid, sat in sim_state.satellites.items()
    ]
    fleet = create_satellite_fleet(satellites)

    # Seed fuel from actual SatelliteState values (not defaults)
    for sid, sat in sim_state.satellites.items():
        if sid in fleet:
            fleet[sid]["mass"]["m_fuel"]  = sat.fuel_kg
            fleet[sid]["mass"]["m_total"] = sat.mass_kg
            # m_dry inferred
            fleet[sid]["mass"]["m_dry"]   = sat.mass_kg - sat.fuel_kg

    return fleet
