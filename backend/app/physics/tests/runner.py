"""
Step-by-step test runner. Execute from repo root:
  C:\Users\VISHAL\AppData\Local\Programs\Python\Python312\python.exe backend/app/physics/tests/runner.py
"""
import sys, os, subprocess

PY = sys.executable
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
TEST = "backend/app/physics/tests/test_physics.py"

STEPS = [
    ("Step 1  — Constants",                  "TestConstants"),
    ("Step 2  — State Vector Model",         "TestSimObject"),
    ("Step 3  — ECI Reference Frame",        "TestECIFrame"),
    ("Step 4  — Gravity Model",              "TestGravity"),
    ("Step 5  — J2 Perturbation",            "TestJ2Perturbation"),
    ("Step 6  — RK4 Integration",            "TestRK4Step"),
    ("Step 7  — propagate_single",           "TestPropagateSingle"),
    ("Step 8  — Multi-Object Orchestration", "TestPropagateAll"),
    ("Step 9  — Serialization",              "TestSerializeResults"),
    ("Step 10 — End-to-End run_simulation",  "TestRunSimulation"),
]

overall_pass = 0
overall_fail = 0

for label, cls in STEPS:
    sep = "=" * 62
    print(f"\n{sep}\n  {label}  [{cls}]\n{sep}")
    r = subprocess.run(
        [PY, "-m", "pytest", f"{TEST}::{cls}", "-v", "--tb=short", "--no-header", "-p", "no:cacheprovider"],
        cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    print(r.stdout)
    for line in r.stdout.splitlines():
        l = line.strip()
        if l.startswith("PASSED") or " passed" in l:
            if " passed" in l:
                try: overall_pass += int(l.split(" passed")[0].split()[-1])
                except: pass
        if " failed" in l:
            try: overall_fail += int(l.split(" failed")[0].split()[-1])
            except: pass

print(f"\n{'='*62}")
print(f"  DONE — {overall_pass} passed  |  {overall_fail} failed")
print(f"{'='*62}\n")
