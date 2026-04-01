"""
Step-by-step test runner — prints results for each test class individually.
Run with: python backend/app/physics/tests/run_tests.py
"""

import sys
import os
import subprocess

PYTHON = sys.executable
TEST_FILE = os.path.join(os.path.dirname(__file__), "test_physics.py")

STEPS = [
    ("Step 1 — Constants",                    "TestConstants"),
    ("Step 2 — State Vector Model",           "TestSimObject"),
    ("Step 3 — ECI Reference Frame Rules",    "TestECIFrame"),
    ("Step 4 — Gravity Model",                "TestGravity"),
    ("Step 5 — J2 Perturbation Model",        "TestJ2Perturbation"),
    ("Step 6 — RK4 Numerical Integration",    "TestRK4Step"),
    ("Step 7 — propagate_single",             "TestPropagateSingle"),
    ("Step 8 — Multi-Object Orchestration",   "TestPropagateAll"),
    ("Step 9 — Serialization",                "TestSerializeResults"),
    ("Step 10 — End-to-End run_simulation",   "TestRunSimulation"),
]

passed_total = 0
failed_total = 0

for label, cls in STEPS:
    print(f"\n{'='*60}")
    print(f"  {label}  [{cls}]")
    print(f"{'='*60}")

    result = subprocess.run(
        [PYTHON, "-m", "pytest", f"{TEST_FILE}::{cls}", "-v", "--tb=short", "--no-header"],
        capture_output=True,
        text=True,
        cwd=os.path.join(os.path.dirname(__file__), "..", "..", ".."),  # repo root
    )

    print(result.stdout)
    if result.stderr.strip():
        print(result.stderr)

    # Tally
    for line in result.stdout.splitlines():
        if "passed" in line or "failed" in line or "error" in line:
            print(f"  >>> {line.strip()}")

print(f"\n{'='*60}")
print("  ALL STEPS COMPLETE")
print(f"{'='*60}\n")
