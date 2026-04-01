"""
Physics engine test suite.

Covers:
  1. Constants & State Vector Model
  2. Reference Frames (ECI rules)
  3. Orbital Propagation Models (gravity, J2, acceleration)
  4. Numerical Integration (RK4 accuracy, energy conservation, decay detection)
  5. Multi-object orchestration & serialization

Run from repo root:
    pytest backend/app/physics/tests/test_physics.py -v
"""

import sys
import os
import math
import pytest
import numpy as np

# Allow running as package or standalone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from physics.constants import MU, R_E, J2
from physics.state import SimObject
from physics.acceleration import (
    compute_gravity,
    compute_j2,
    compute_acceleration,
    state_derivative,
)
from physics.integrator import rk4_step, propagate_single, OrbitalDecayError
from physics.simulator import SimConfig, propagate_all, serialize_results, run_simulation

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# ISS-like circular orbit at ~400 km altitude
ISS_R = R_E + 400.0                        # km
ISS_V = math.sqrt(MU / ISS_R)              # circular velocity, km/s
ISS_STATE = np.array([ISS_R, 0.0, 0.0, 0.0, ISS_V, 0.0])

# GEO-like circular orbit at ~35786 km altitude
GEO_R = R_E + 35786.0
GEO_V = math.sqrt(MU / GEO_R)
GEO_STATE = np.array([GEO_R, 0.0, 0.0, 0.0, GEO_V, 0.0])

# State on the equatorial plane (z=0) — J2 z-components should vanish
EQ_STATE = np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.0])

# Polar orbit state (position along z-axis)
POLAR_STATE = np.array([0.0, 0.0, 7000.0, 7.5, 0.0, 0.0])


# ===========================================================================
# 1. CONSTANTS
# ===========================================================================

class TestConstants:
    def test_mu_exact_value(self):
        assert MU == 398600.4418

    def test_r_e_exact_value(self):
        assert R_E == 6378.137

    def test_j2_exact_value(self):
        assert J2 == 1.08263e-3

    def test_mu_positive(self):
        assert MU > 0

    def test_r_e_reasonable_range(self):
        # Earth radius must be between 6350 and 6400 km
        assert 6350.0 < R_E < 6400.0

    def test_j2_dimensionless_order_of_magnitude(self):
        # J2 is ~1e-3, never negative
        assert 1e-4 < J2 < 1e-2


# ===========================================================================
# 2. STATE VECTOR MODEL
# ===========================================================================

class TestSimObject:
    def test_fields_stored_correctly(self):
        s = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        assert s.id == "SAT-001"
        assert s.object_type == "satellite"
        assert s.state.shape == (6,)

    def test_history_starts_empty(self):
        s = SimObject(id="DEB-001", object_type="debris", state=ISS_STATE.copy())
        assert s.history == []

    def test_history_is_independent_per_instance(self):
        # Two objects must not share the same history list
        a = SimObject(id="A", object_type="satellite", state=ISS_STATE.copy())
        b = SimObject(id="B", object_type="satellite", state=ISS_STATE.copy())
        a.history.append(ISS_STATE.copy())
        assert len(b.history) == 0

    def test_state_is_numpy_array(self):
        s = SimObject(id="X", object_type="debris", state=ISS_STATE.copy())
        assert isinstance(s.state, np.ndarray)

    def test_state_shape(self):
        s = SimObject(id="X", object_type="debris", state=ISS_STATE.copy())
        assert s.state.shape == (6,)

    def test_debris_type(self):
        d = SimObject(id="DEB-042", object_type="debris", state=ISS_STATE.copy())
        assert d.object_type == "debris"


# ===========================================================================
# 3. REFERENCE FRAME RULES (ECI)
# ===========================================================================

class TestECIFrame:
    """
    Validate that all physics functions operate in ECI (non-rotating, km/km/s/s).
    These tests enforce the frame contract — not just math correctness.
    """

    def test_gravity_output_shape_is_3(self):
        a = compute_gravity(ISS_STATE)
        assert a.shape == (3,)

    def test_j2_output_shape_is_3(self):
        a = compute_j2(ISS_STATE)
        assert a.shape == (3,)

    def test_acceleration_output_shape_is_3(self):
        a = compute_acceleration(ISS_STATE)
        assert a.shape == (3,)

    def test_state_derivative_output_shape_is_6(self):
        ds = state_derivative(ISS_STATE)
        assert ds.shape == (6,)

    def test_state_derivative_velocity_passthrough(self):
        # First 3 components of dS/dt must equal the velocity in the input state
        ds = state_derivative(ISS_STATE)
        np.testing.assert_array_equal(ds[:3], ISS_STATE[3:])

    def test_gravity_units_km_per_s2(self):
        # At ISS altitude, |a_gravity| ≈ μ/r² ≈ 8.69 km/s² — must be in that ballpark
        a = compute_gravity(ISS_STATE)
        a_mag = np.linalg.norm(a)
        expected = MU / ISS_R**2
        assert abs(a_mag - expected) < 1e-10

    def test_gravity_points_toward_origin(self):
        # Gravity must be antiparallel to position vector
        a = compute_gravity(ISS_STATE)
        r = ISS_STATE[:3]
        # Cross product of antiparallel vectors is zero
        cross = np.cross(a, r)
        np.testing.assert_allclose(cross, np.zeros(3), atol=1e-10)
        # Dot product must be negative (opposite directions)
        assert np.dot(a, r) < 0

    def test_rk4_step_output_shape(self):
        new_state = rk4_step(ISS_STATE.copy(), h=10.0)
        assert new_state.shape == (6,)


# ===========================================================================
# 4. ORBITAL PROPAGATION MODELS
# ===========================================================================

class TestGravity:
    def test_magnitude_at_iss_altitude(self):
        a = compute_gravity(ISS_STATE)
        expected_mag = MU / ISS_R**2
        np.testing.assert_allclose(np.linalg.norm(a), expected_mag, rtol=1e-10)

    def test_magnitude_at_geo_altitude(self):
        a = compute_gravity(GEO_STATE)
        expected_mag = MU / GEO_R**2
        np.testing.assert_allclose(np.linalg.norm(a), expected_mag, rtol=1e-10)

    def test_gravity_scales_with_inverse_square(self):
        # Doubling the radius should quarter the acceleration magnitude
        r1 = np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.0])
        r2 = np.array([14000.0, 0.0, 0.0, 0.0, 5.3, 0.0])
        a1 = np.linalg.norm(compute_gravity(r1))
        a2 = np.linalg.norm(compute_gravity(r2))
        np.testing.assert_allclose(a1 / a2, 4.0, rtol=1e-10)

    def test_gravity_direction_negative_x(self):
        # State on +x axis → gravity must point in -x direction
        state = np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.0])
        a = compute_gravity(state)
        assert a[0] < 0
        np.testing.assert_allclose(a[1], 0.0, atol=1e-15)
        np.testing.assert_allclose(a[2], 0.0, atol=1e-15)

    def test_gravity_symmetric_positions(self):
        # Gravity magnitude must be the same at symmetric positions
        s1 = np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.0])
        s2 = np.array([-7000.0, 0.0, 0.0, 0.0, 7.5, 0.0])
        np.testing.assert_allclose(
            np.linalg.norm(compute_gravity(s1)),
            np.linalg.norm(compute_gravity(s2)),
            rtol=1e-12,
        )


class TestJ2Perturbation:
    def test_j2_output_shape(self):
        assert compute_j2(ISS_STATE).shape == (3,)

    def test_j2_smaller_than_gravity(self):
        # J2 perturbation must be much smaller than two-body gravity
        a_grav = np.linalg.norm(compute_gravity(ISS_STATE))
        a_j2 = np.linalg.norm(compute_j2(ISS_STATE))
        assert a_j2 < a_grav * 0.01   # less than 1% of gravity

    def test_j2_equatorial_z_component_zero(self):
        # On equatorial plane (z=0), J2 z-acceleration must be zero
        a_j2 = compute_j2(EQ_STATE)
        np.testing.assert_allclose(a_j2[2], 0.0, atol=1e-15)

    def test_j2_equatorial_xy_nonzero(self):
        # On equatorial plane, x/y components are non-zero (inward perturbation)
        a_j2 = compute_j2(EQ_STATE)
        assert abs(a_j2[0]) > 0 or abs(a_j2[1]) > 0

    def test_j2_polar_xy_zero(self):
        # Position purely along z-axis → x and y J2 components must be zero
        a_j2 = compute_j2(POLAR_STATE)
        np.testing.assert_allclose(a_j2[0], 0.0, atol=1e-15)
        np.testing.assert_allclose(a_j2[1], 0.0, atol=1e-15)

    def test_j2_uses_correct_constants(self):
        # Manually compute factor and verify against function output
        x, y, z = EQ_STATE[:3]
        r = np.linalg.norm(EQ_STATE[:3])
        factor = (3.0 * J2 * MU * R_E**2) / (2.0 * r**5)
        z_ratio = (z / r)**2
        expected_x = factor * x * (5.0 * z_ratio - 1.0)
        a_j2 = compute_j2(EQ_STATE)
        np.testing.assert_allclose(a_j2[0], expected_x, rtol=1e-12)

    def test_total_acceleration_is_sum(self):
        ag = compute_gravity(ISS_STATE)
        aj = compute_j2(ISS_STATE)
        at = compute_acceleration(ISS_STATE)
        np.testing.assert_allclose(at, ag + aj, rtol=1e-14)


# ===========================================================================
# 5. NUMERICAL INTEGRATION — RK4
# ===========================================================================

def _specific_energy(state):
    """Orbital specific mechanical energy: ε = v²/2 - μ/r  (km²/s²)"""
    r = np.linalg.norm(state[:3])
    v = np.linalg.norm(state[3:])
    return 0.5 * v**2 - MU / r


def _angular_momentum(state):
    """Specific angular momentum vector h = r × v  (km²/s)"""
    return np.cross(state[:3], state[3:])


class TestRK4Step:
    def test_output_shape(self):
        new_state = rk4_step(ISS_STATE.copy(), h=10.0)
        assert new_state.shape == (6,)

    def test_position_changes_after_step(self):
        new_state = rk4_step(ISS_STATE.copy(), h=10.0)
        assert not np.allclose(new_state[:3], ISS_STATE[:3])

    def test_velocity_changes_after_step(self):
        new_state = rk4_step(ISS_STATE.copy(), h=10.0)
        assert not np.allclose(new_state[3:], ISS_STATE[3:])

    def test_energy_conserved_one_step(self):
        # Energy change over a single 10 s step must be tiny (< 1e-6 km²/s²)
        e0 = _specific_energy(ISS_STATE)
        e1 = _specific_energy(rk4_step(ISS_STATE.copy(), h=10.0))
        assert abs(e1 - e0) < 1e-6

    def test_energy_conserved_full_orbit(self):
        # Over one full ISS orbit (~5560 s), energy drift must stay < 1e-4 km²/s²
        state = ISS_STATE.copy()
        e0 = _specific_energy(state)
        T = int(2 * math.pi * math.sqrt(ISS_R**3 / MU))  # orbital period in s
        n_steps = T // 10
        for _ in range(n_steps):
            state = rk4_step(state, h=10.0)
        e1 = _specific_energy(state)
        assert abs(e1 - e0) < 1e-4

    def test_angular_momentum_conserved_full_orbit(self):
        # |h| must not drift more than 1e-4 km²/s over one orbit
        state = ISS_STATE.copy()
        h0 = np.linalg.norm(_angular_momentum(state))
        T = int(2 * math.pi * math.sqrt(ISS_R**3 / MU))
        n_steps = T // 10
        for _ in range(n_steps):
            state = rk4_step(state, h=10.0)
        h1 = np.linalg.norm(_angular_momentum(state))
        assert abs(h1 - h0) < 1e-4

    def test_circular_orbit_radius_stable(self):
        # Radius of a circular orbit must not drift more than 1 km over one orbit
        state = ISS_STATE.copy()
        r0 = np.linalg.norm(state[:3])
        T = int(2 * math.pi * math.sqrt(ISS_R**3 / MU))
        n_steps = T // 10
        for _ in range(n_steps):
            state = rk4_step(state, h=10.0)
        r1 = np.linalg.norm(state[:3])
        assert abs(r1 - r0) < 1.0

    def test_decay_error_raised_below_surface(self):
        # State with |r| < R_E must raise OrbitalDecayError
        subterranean = np.array([R_E - 100.0, 0.0, 0.0, 0.0, 7.9, 0.0])
        with pytest.raises(OrbitalDecayError):
            rk4_step(subterranean, h=10.0)

    def test_decay_error_message_contains_r_value(self):
        subterranean = np.array([R_E - 100.0, 0.0, 0.0, 0.0, 7.9, 0.0])
        with pytest.raises(OrbitalDecayError, match=r"\|r\|"):
            rk4_step(subterranean, h=10.0)

    def test_no_decay_error_at_valid_altitude(self):
        # Should not raise for a healthy orbit
        rk4_step(ISS_STATE.copy(), h=10.0)  # no exception expected

    def test_rk4_more_accurate_than_euler(self):
        # After 100 steps, RK4 position error vs analytical must beat Euler
        h = 10.0
        n = 100

        # Analytical circular orbit position after n*h seconds
        t_final = n * h
        omega = ISS_V / ISS_R
        x_exact = ISS_R * math.cos(omega * t_final)
        y_exact = ISS_R * math.sin(omega * t_final)

        # RK4
        state_rk4 = ISS_STATE.copy()
        for _ in range(n):
            state_rk4 = rk4_step(state_rk4, h)
        err_rk4 = math.sqrt((state_rk4[0] - x_exact)**2 + (state_rk4[1] - y_exact)**2)

        # Euler (manual)
        state_euler = ISS_STATE.copy()
        for _ in range(n):
            ds = state_derivative(state_euler)
            state_euler = state_euler + h * ds
        err_euler = math.sqrt((state_euler[0] - x_exact)**2 + (state_euler[1] - y_exact)**2)

        assert err_rk4 < err_euler


# ===========================================================================
# 6. PROPAGATE_SINGLE
# ===========================================================================

class TestPropagateSingle:
    def test_trajectory_length_equals_n_steps_plus_one(self):
        traj = propagate_single(ISS_STATE.copy(), h=10.0, n_steps=50)
        assert len(traj) == 51  # initial + 50 steps

    def test_first_entry_is_initial_state(self):
        traj = propagate_single(ISS_STATE.copy(), h=10.0, n_steps=10)
        np.testing.assert_array_equal(traj[0], ISS_STATE)

    def test_each_entry_is_shape_6(self):
        traj = propagate_single(ISS_STATE.copy(), h=10.0, n_steps=10)
        for s in traj:
            assert s.shape == (6,)

    def test_stops_early_on_decay(self):
        # Start just above surface with downward velocity — should decay quickly
        # Use a very small radius so it decays within a few steps
        decaying = np.array([R_E - 50.0, 0.0, 0.0, 0.0, 0.0, -8.0])
        traj = propagate_single(decaying, h=10.0, n_steps=1000)
        assert len(traj) < 1001  # stopped before completing all steps

    def test_no_reference_aliasing_in_history(self):
        # Each stored state must be an independent copy
        traj = propagate_single(ISS_STATE.copy(), h=10.0, n_steps=5)
        original = traj[1].copy()
        traj[1][0] = 99999.0
        assert traj[2][0] != 99999.0
        assert traj[1][0] != original[0]  # we mutated it, just confirm independence


# ===========================================================================
# 7. MULTI-OBJECT ORCHESTRATION
# ===========================================================================

class TestPropagateAll:
    def _make_sat(self, sat_id="SAT-001"):
        return SimObject(id=sat_id, object_type="satellite", state=ISS_STATE.copy())

    def _make_deb(self, deb_id="DEB-001"):
        return SimObject(id=deb_id, object_type="debris",
                         state=np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.2]))

    def test_history_populated_after_propagation(self):
        obj = self._make_sat()
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([obj], cfg)
        assert len(obj.history) > 0

    def test_history_first_entry_is_initial_state(self):
        initial = ISS_STATE.copy()
        obj = SimObject(id="S", object_type="satellite", state=initial.copy())
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([obj], cfg)
        np.testing.assert_array_equal(obj.history[0], initial)

    def test_decayed_false_for_stable_orbit(self):
        obj = self._make_sat()
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([obj], cfg)
        assert obj.decayed is False

    def test_decayed_true_for_suborbital(self):
        obj = SimObject(id="D", object_type="debris",
                        state=np.array([R_E - 50.0, 0.0, 0.0, 0.0, 0.0, -8.0]))
        cfg = SimConfig(t_start=0.0, t_end=10000.0, h=10.0)
        propagate_all([obj], cfg)
        assert obj.decayed is True

    def test_multiple_objects_independent(self):
        sat = self._make_sat()
        deb = self._make_deb()
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([sat, deb], cfg)
        # Histories must differ — different initial states
        assert not np.allclose(sat.history[-1], deb.history[-1])

    def test_store_every_reduces_history_length(self):
        obj1 = self._make_sat("S1")
        obj2 = self._make_sat("S2")
        cfg1 = SimConfig(t_start=0.0, t_end=100.0, h=10.0, store_every=1)
        cfg2 = SimConfig(t_start=0.0, t_end=100.0, h=10.0, store_every=5)
        propagate_all([obj1], cfg1)
        propagate_all([obj2], cfg2)
        assert len(obj1.history) > len(obj2.history)

    def test_history_cleared_on_re_run(self):
        obj = self._make_sat()
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([obj], cfg)
        first_len = len(obj.history)
        obj.state = ISS_STATE.copy()
        propagate_all([obj], cfg)
        assert len(obj.history) == first_len  # not doubled


# ===========================================================================
# 8. SERIALIZATION
# ===========================================================================

class TestSerializeResults:
    def _run(self):
        sat = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        deb = SimObject(id="DEB-001", object_type="debris",
                        state=np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.2]))
        cfg = SimConfig(t_start=0.0, t_end=100.0, h=10.0)
        propagate_all([sat, deb], cfg)
        return serialize_results([sat, deb])

    def test_returns_list(self):
        assert isinstance(self._run(), list)

    def test_each_entry_has_required_keys(self):
        for entry in self._run():
            assert {"id", "object_type", "decayed", "trajectory"} <= entry.keys()

    def test_trajectory_is_list_of_lists(self):
        for entry in self._run():
            assert isinstance(entry["trajectory"], list)
            assert isinstance(entry["trajectory"][0], list)

    def test_trajectory_inner_length_is_6(self):
        for entry in self._run():
            for point in entry["trajectory"]:
                assert len(point) == 6

    def test_all_values_are_python_floats(self):
        # Must be JSON-serializable — no numpy scalars
        import json
        result = self._run()
        json.dumps(result)  # raises TypeError if numpy types leak through

    def test_ids_preserved(self):
        result = self._run()
        ids = {r["id"] for r in result}
        assert ids == {"SAT-001", "DEB-001"}


# ===========================================================================
# 9. END-TO-END: run_simulation
# ===========================================================================

class TestRunSimulation:
    def test_returns_list(self):
        sat = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        result = run_simulation([sat], t_start=0.0, t_end=100.0, h=10.0)
        assert isinstance(result, list)

    def test_correct_step_count(self):
        sat = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        result = run_simulation([sat], t_start=0.0, t_end=100.0, h=10.0, store_every=1)
        # 100/10 = 10 steps + 1 initial = 11 entries
        assert len(result[0]["trajectory"]) == 11

    def test_one_full_orbit_no_decay(self):
        sat = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        T = 2 * math.pi * math.sqrt(ISS_R**3 / MU)
        result = run_simulation([sat], t_start=0.0, t_end=T, h=10.0)
        assert result[0]["decayed"] is False

    def test_final_position_close_to_initial_after_one_orbit(self):
        # After one full orbit, position should return close to start.
        # J2 perturbation causes nodal precession (~100 km drift per orbit is expected).
        sat = SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy())
        T = 2 * math.pi * math.sqrt(ISS_R**3 / MU)
        result = run_simulation([sat], t_start=0.0, t_end=T, h=10.0)
        final = np.array(result[0]["trajectory"][-1][:3])
        initial = ISS_STATE[:3]
        error = np.linalg.norm(final - initial)
        assert error < 200.0  # km — accounts for J2 nodal precession

    def test_multi_object_results_count(self):
        objects = [
            SimObject(id="SAT-001", object_type="satellite", state=ISS_STATE.copy()),
            SimObject(id="DEB-001", object_type="debris",
                      state=np.array([7000.0, 0.0, 0.0, 0.0, 7.5, 0.2])),
        ]
        result = run_simulation(objects, t_start=0.0, t_end=100.0, h=10.0)
        assert len(result) == 2
