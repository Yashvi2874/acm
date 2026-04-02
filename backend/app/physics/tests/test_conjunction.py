"""
Conjunction detection test suite.

Covers:
  1. compute_relative_state
  2. compute_tca  (including parallel-trajectory guard)
  3. is_tca_in_window
  4. is_violation
  5. ConjunctionEvent dataclass
  6. analyze_pair
  7. screen_conjunctions
  8. get_violations
  9. serialize_conjunctions
  10. run_conjunction_analysis  (end-to-end)

Run from repo root:
    pytest backend/app/physics/tests/test_conjunction.py -v
"""

import sys
import os
import math
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from physics.state import SimObject
from physics.conjunction import (
    compute_relative_state,
    compute_tca,
    is_tca_in_window,
    is_violation,
    ConjunctionEvent,
    analyze_pair,
    screen_conjunctions,
    get_violations,
    serialize_conjunctions,
    run_conjunction_analysis,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

# Two objects 5 km apart on the x-axis, converging at 0.1 km/s
CLOSE_A = np.array([7000.0,  0.0, 0.0,  0.0, 7.5,  0.0])
CLOSE_B = np.array([7005.0,  0.0, 0.0,  0.0, 7.5, -0.1])   # closing in z... wait, same vx/vy
# Actually make them converge: B moves toward A in x
CONV_A  = np.array([7000.0,  0.0, 0.0,  0.0, 7.5,  0.0])
CONV_B  = np.array([7005.0,  0.0, 0.0, -0.1, 7.5,  0.0])   # B moves toward A in x

# Two objects with identical velocities (parallel trajectories)
PARA_A  = np.array([7000.0,  0.0, 0.0,  0.0, 7.5,  0.0])
PARA_B  = np.array([7005.0,  0.0, 0.0,  0.0, 7.5,  0.0])

# Two objects very close — within 100 m
COLL_A  = np.array([7000.000, 0.0, 0.0,  0.0, 7.5,  0.0])
COLL_B  = np.array([7000.050, 0.0, 0.0,  0.0, 7.5,  0.01])  # 50 m apart

# Two objects far apart — safely separated
FAR_A   = np.array([7000.0,    0.0,   0.0,  0.0, 7.5, 0.0])
FAR_B   = np.array([7500.0, 1000.0, 500.0,  0.0, 7.2, 0.0])


def make_obj(obj_id, state, decayed=False):
    obj = SimObject(id=obj_id, object_type="satellite", state=state.copy())
    obj.decayed = decayed
    return obj


# ===========================================================================
# 1. compute_relative_state
# ===========================================================================

class TestComputeRelativeState:
    def test_output_types(self):
        dr, dv, d = compute_relative_state(CONV_A, CONV_B)
        assert isinstance(dr, np.ndarray)
        assert isinstance(dv, np.ndarray)
        assert isinstance(d, float)

    def test_output_shapes(self):
        dr, dv, d = compute_relative_state(CONV_A, CONV_B)
        assert dr.shape == (3,)
        assert dv.shape == (3,)

    def test_delta_r_is_A_minus_B(self):
        dr, _, _ = compute_relative_state(CONV_A, CONV_B)
        expected = CONV_A[:3] - CONV_B[:3]
        np.testing.assert_array_equal(dr, expected)

    def test_delta_v_is_A_minus_B(self):
        _, dv, _ = compute_relative_state(CONV_A, CONV_B)
        expected = CONV_A[3:] - CONV_B[3:]
        np.testing.assert_array_equal(dv, expected)

    def test_scalar_separation_is_norm_of_delta_r(self):
        dr, _, d = compute_relative_state(CONV_A, CONV_B)
        assert abs(d - np.linalg.norm(dr)) < 1e-12

    def test_separation_is_positive(self):
        _, _, d = compute_relative_state(CONV_A, CONV_B)
        assert d > 0

    def test_identical_states_give_zero_separation(self):
        _, _, d = compute_relative_state(CONV_A, CONV_A)
        assert d == 0.0

    def test_antisymmetry_of_delta_r(self):
        dr_AB, _, _ = compute_relative_state(CONV_A, CONV_B)
        dr_BA, _, _ = compute_relative_state(CONV_B, CONV_A)
        np.testing.assert_array_equal(dr_AB, -dr_BA)

    def test_known_separation(self):
        # A at x=7000, B at x=7005 → separation = 5 km
        _, _, d = compute_relative_state(CONV_A, CONV_B)
        assert abs(d - 5.0) < 1e-10


# ===========================================================================
# 2. compute_tca
# ===========================================================================

class TestComputeTCA:
    def test_output_types(self):
        tau, d_min, dr_tca = compute_tca(CONV_A, CONV_B)
        assert isinstance(tau, float)
        assert isinstance(d_min, float)
        assert isinstance(dr_tca, np.ndarray)

    def test_delta_r_tca_shape(self):
        _, _, dr_tca = compute_tca(CONV_A, CONV_B)
        assert dr_tca.shape == (3,)

    def test_d_min_is_norm_of_delta_r_tca(self):
        _, d_min, dr_tca = compute_tca(CONV_A, CONV_B)
        assert abs(d_min - np.linalg.norm(dr_tca)) < 1e-10

    def test_d_min_nonnegative(self):
        _, d_min, _ = compute_tca(CONV_A, CONV_B)
        assert d_min >= 0.0

    def test_converging_objects_have_positive_tau(self):
        # B is moving toward A → TCA is in the future
        tau, _, _ = compute_tca(CONV_A, CONV_B)
        assert tau > 0.0

    def test_tau_formula_exact(self):
        # Manually compute tau and compare
        dr = CONV_A[:3] - CONV_B[:3]
        dv = CONV_A[3:] - CONV_B[3:]
        expected_tau = -np.dot(dr, dv) / np.dot(dv, dv)
        tau, _, _ = compute_tca(CONV_A, CONV_B)
        assert abs(tau - expected_tau) < 1e-10

    def test_d_min_less_than_current_separation_for_converging(self):
        _, _, d_current = compute_relative_state(CONV_A, CONV_B)
        _, d_min, _ = compute_tca(CONV_A, CONV_B)
        assert d_min <= d_current

    def test_parallel_guard_tau_zero(self):
        # Identical velocities → guard fires, tau = 0
        tau, _, _ = compute_tca(PARA_A, PARA_B)
        assert tau == 0.0

    def test_parallel_guard_d_min_equals_current(self):
        _, _, d_current = compute_relative_state(PARA_A, PARA_B)
        _, d_min, _ = compute_tca(PARA_A, PARA_B)
        assert abs(d_min - d_current) < 1e-10

    def test_parallel_guard_delta_r_tca_equals_delta_r(self):
        dr, _, _ = compute_relative_state(PARA_A, PARA_B)
        _, _, dr_tca = compute_tca(PARA_A, PARA_B)
        np.testing.assert_array_almost_equal(dr_tca, dr)

    def test_identical_states_d_min_zero(self):
        tau, d_min, _ = compute_tca(CONV_A, CONV_A)
        assert d_min == 0.0


# ===========================================================================
# 3. is_tca_in_window
# ===========================================================================

class TestIsTcaInWindow:
    def test_negative_tau_returns_false(self):
        assert is_tca_in_window(-1.0, 5400.0) is False

    def test_tau_beyond_window_returns_false(self):
        assert is_tca_in_window(6000.0, 5400.0) is False

    def test_tau_within_window_returns_true(self):
        assert is_tca_in_window(3600.0, 5400.0) is True

    def test_tau_zero_returns_true(self):
        assert is_tca_in_window(0.0, 5400.0) is True

    def test_tau_exactly_at_window_edge_returns_true(self):
        # tau == t_window: not strictly greater, so True (just inside the window)
        assert is_tca_in_window(5400.0, 5400.0) is True

    def test_tau_just_inside_window(self):
        assert is_tca_in_window(5399.9, 5400.0) is True

    def test_zero_window(self):
        # Only tau=0 would pass, but 0 is not > 0 so True; any positive tau fails
        assert is_tca_in_window(0.0, 0.0) is True
        assert is_tca_in_window(1.0, 0.0) is False


# ===========================================================================
# 4. is_violation
# ===========================================================================

class TestIsViolation:
    def test_below_threshold_is_violation(self):
        assert is_violation(0.05, 0.100) is True

    def test_above_threshold_not_violation(self):
        assert is_violation(5.0, 0.100) is False

    def test_exactly_at_threshold_not_violation(self):
        # strict < so exactly equal is NOT a violation
        assert is_violation(0.100, 0.100) is False

    def test_zero_distance_is_violation(self):
        assert is_violation(0.0, 0.100) is True

    def test_large_threshold(self):
        assert is_violation(50.0, 100.0) is True

    def test_tiny_threshold(self):
        assert is_violation(0.001, 0.0001) is False


# ===========================================================================
# 5. ConjunctionEvent dataclass
# ===========================================================================

class TestConjunctionEvent:
    def _make(self):
        return ConjunctionEvent(
            object_a_id="SAT-001",
            object_b_id="DEB-001",
            tau=300.0,
            d_min=0.05,
            delta_r_tca=np.array([0.03, 0.04, 0.0]),
            is_violation=True,
            current_separation=0.08,
        )

    def test_fields_stored(self):
        e = self._make()
        assert e.object_a_id == "SAT-001"
        assert e.object_b_id == "DEB-001"
        assert e.tau == 300.0
        assert e.d_min == 0.05
        assert e.is_violation is True
        assert e.current_separation == 0.08

    def test_delta_r_tca_is_ndarray(self):
        e = self._make()
        assert isinstance(e.delta_r_tca, np.ndarray)
        assert e.delta_r_tca.shape == (3,)


# ===========================================================================
# 6. analyze_pair
# ===========================================================================

class TestAnalyzePair:
    def test_returns_event_for_converging_pair(self):
        a = make_obj("A", CONV_A)
        b = make_obj("B", CONV_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event is not None

    def test_event_ids_match_objects(self):
        a = make_obj("SAT-001", CONV_A)
        b = make_obj("DEB-001", CONV_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event.object_a_id == "SAT-001"
        assert event.object_b_id == "DEB-001"

    def test_returns_none_when_tca_outside_window(self):
        # Parallel trajectories → tau=0, which IS in window; use diverging pair instead
        # Make objects diverging: B moves away from A
        div_a = np.array([7000.0, 0.0, 0.0,  0.0, 7.5, 0.0])
        div_b = np.array([7005.0, 0.0, 0.0,  0.1, 7.5, 0.0])  # B moving away
        a = make_obj("A", div_a)
        b = make_obj("B", div_b)
        # tau will be negative (already passed) → outside window
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event is None

    def test_violation_flag_set_correctly(self):
        a = make_obj("A", COLL_A)
        b = make_obj("B", COLL_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event is not None
        assert event.is_violation is True

    def test_no_violation_for_safe_pair(self):
        a = make_obj("A", FAR_A)
        b = make_obj("B", FAR_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        # Either None (outside window) or not a violation
        if event is not None:
            assert event.is_violation is False

    def test_current_separation_matches_compute_relative_state(self):
        a = make_obj("A", CONV_A)
        b = make_obj("B", CONV_B)
        _, _, d = compute_relative_state(CONV_A, CONV_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event is not None
        assert abs(event.current_separation - d) < 1e-10

    def test_delta_r_tca_shape(self):
        a = make_obj("A", CONV_A)
        b = make_obj("B", CONV_B)
        event = analyze_pair(a, b, t_window=5400.0, safety_threshold_km=0.100)
        assert event is not None
        assert event.delta_r_tca.shape == (3,)


# ===========================================================================
# 7. screen_conjunctions
# ===========================================================================

class TestScreenConjunctions:
    def _objects(self):
        return [
            make_obj("SAT-001", COLL_A),   # close pair
            make_obj("DEB-001", COLL_B),
            make_obj("SAT-002", FAR_A),    # safe pair
            make_obj("SAT-003", FAR_B),
        ]

    def test_returns_list(self):
        objs = self._objects()
        result = screen_conjunctions(objs, [("SAT-001", "DEB-001")], 5400.0, 0.100)
        assert isinstance(result, list)

    def test_close_pair_included(self):
        objs = self._objects()
        result = screen_conjunctions(objs, [("SAT-001", "DEB-001")], 5400.0, 0.100)
        ids = {(e.object_a_id, e.object_b_id) for e in result}
        assert ("SAT-001", "DEB-001") in ids

    def test_empty_candidate_pairs_returns_empty(self):
        objs = self._objects()
        result = screen_conjunctions(objs, [], 5400.0, 0.100)
        assert result == []

    def test_decayed_object_skipped(self):
        objs = [
            make_obj("SAT-001", COLL_A, decayed=True),
            make_obj("DEB-001", COLL_B),
        ]
        result = screen_conjunctions(objs, [("SAT-001", "DEB-001")], 5400.0, 0.100)
        assert result == []

    def test_unknown_id_skipped(self):
        objs = self._objects()
        result = screen_conjunctions(objs, [("GHOST-999", "DEB-001")], 5400.0, 0.100)
        assert result == []

    def test_all_events_are_conjunction_events(self):
        objs = self._objects()
        result = screen_conjunctions(objs, [("SAT-001", "DEB-001")], 5400.0, 0.100)
        for e in result:
            assert isinstance(e, ConjunctionEvent)


# ===========================================================================
# 8. get_violations
# ===========================================================================

class TestGetViolations:
    def _events(self):
        return [
            ConjunctionEvent("A", "B", 100.0, 0.05,  np.zeros(3), True,  0.08),
            ConjunctionEvent("C", "D", 200.0, 5.0,   np.zeros(3), False, 5.0),
            ConjunctionEvent("E", "F", 50.0,  0.02,  np.zeros(3), True,  0.03),
        ]

    def test_returns_only_violations(self):
        violations = get_violations(self._events())
        assert all(e.is_violation for e in violations)

    def test_correct_count(self):
        violations = get_violations(self._events())
        assert len(violations) == 2

    def test_sorted_by_d_min_ascending(self):
        violations = get_violations(self._events())
        d_mins = [e.d_min for e in violations]
        assert d_mins == sorted(d_mins)

    def test_most_dangerous_first(self):
        violations = get_violations(self._events())
        assert violations[0].d_min < violations[1].d_min

    def test_empty_input_returns_empty(self):
        assert get_violations([]) == []

    def test_no_violations_returns_empty(self):
        events = [ConjunctionEvent("A", "B", 100.0, 5.0, np.zeros(3), False, 5.0)]
        assert get_violations(events) == []


# ===========================================================================
# 9. serialize_conjunctions
# ===========================================================================

class TestSerializeConjunctions:
    def _event(self):
        return ConjunctionEvent(
            object_a_id="SAT-001",
            object_b_id="DEB-001",
            tau=300.0,
            d_min=0.05,
            delta_r_tca=np.array([0.03, 0.04, 0.0]),
            is_violation=True,
            current_separation=0.08,
        )

    def test_returns_list(self):
        assert isinstance(serialize_conjunctions([self._event()]), list)

    def test_required_keys_present(self):
        result = serialize_conjunctions([self._event()])[0]
        required = {"object_a_id", "object_b_id", "tau_seconds", "tau_minutes",
                    "d_min_km", "current_sep_km", "is_violation", "delta_r_tca"}
        assert required <= result.keys()

    def test_tau_minutes_is_tau_seconds_over_60(self):
        result = serialize_conjunctions([self._event()])[0]
        assert abs(result["tau_minutes"] - result["tau_seconds"] / 60) < 1e-6

    def test_delta_r_tca_is_list(self):
        result = serialize_conjunctions([self._event()])[0]
        assert isinstance(result["delta_r_tca"], list)
        assert len(result["delta_r_tca"]) == 3

    def test_json_serializable(self):
        import json
        result = serialize_conjunctions([self._event()])
        json.dumps(result)   # raises TypeError if numpy types leak

    def test_empty_input_returns_empty(self):
        assert serialize_conjunctions([]) == []

    def test_ids_preserved(self):
        result = serialize_conjunctions([self._event()])[0]
        assert result["object_a_id"] == "SAT-001"
        assert result["object_b_id"] == "DEB-001"


# ===========================================================================
# 10. run_conjunction_analysis — end-to-end
# ===========================================================================

class TestRunConjunctionAnalysis:
    def _setup(self):
        sat1 = make_obj("SAT-001", np.array([6778.0, 0.0,  0.0,  0.0, 7.7102, 0.0]))
        sat2 = make_obj("SAT-002", np.array([6778.0, 0.05, 0.0,  0.0, 7.7102, 0.01]))
        sat3 = make_obj("SAT-003", np.array([7200.0, 500.0, 0.0, 0.0, 7.2,    0.0]))
        return [sat1, sat2, sat3]

    def test_returns_dict_with_required_keys(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002")], 5400.0, 0.100)
        assert {"all_events", "violations", "violation_count", "event_count"} <= result.keys()

    def test_violation_count_is_int(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002")], 5400.0, 0.100)
        assert isinstance(result["violation_count"], int)

    def test_event_count_is_int(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002")], 5400.0, 0.100)
        assert isinstance(result["event_count"], int)

    def test_close_pair_flagged_as_violation(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002")], 5400.0, 0.100)
        assert result["violation_count"] >= 1

    def test_violations_subset_of_all_events(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002"),
                                                  ("SAT-001", "SAT-003")], 5400.0, 0.100)
        assert result["violation_count"] <= result["event_count"]

    def test_decayed_object_excluded(self):
        sat1 = make_obj("SAT-001", np.array([6778.0, 0.0, 0.0, 0.0, 7.7102, 0.0]), decayed=True)
        sat2 = make_obj("SAT-002", np.array([6778.0, 0.05, 0.0, 0.0, 7.7102, 0.01]))
        result = run_conjunction_analysis([sat1, sat2], [("SAT-001", "SAT-002")], 5400.0, 0.100)
        assert result["event_count"] == 0

    def test_empty_candidate_pairs(self):
        objs = self._setup()
        result = run_conjunction_analysis(objs, [], 5400.0, 0.100)
        assert result["event_count"] == 0
        assert result["violation_count"] == 0

    def test_all_events_json_serializable(self):
        import json
        objs = self._setup()
        result = run_conjunction_analysis(objs, [("SAT-001", "SAT-002")], 5400.0, 0.100)
        json.dumps(result)

    def test_sanity_sat1_sat2_violation(self):
        # Exact scenario from the 3F sanity test in conjunction.py
        objs = self._setup()
        result = run_conjunction_analysis(
            objs,
            [("SAT-001", "SAT-002"), ("SAT-001", "SAT-003")],
            t_window=5400.0,
            safety_threshold_km=0.100,
        )
        violation_ids = {(v["object_a_id"], v["object_b_id"]) for v in result["violations"]}
        assert ("SAT-001", "SAT-002") in violation_ids
