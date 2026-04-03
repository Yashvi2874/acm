# ACM

**Autonomous Constellation Manager**

ACM is a multi-service orbital operations stack for tracking satellites and debris, forecasting conjunctions, planning collision-avoidance maneuvers, and visualizing fleet state through a live mission-control dashboard.

![ACM dashboard](docs/screenshots/dashboard.png)

## What ACM does

- Ingests ECI telemetry for satellites and debris through a FastAPI API and a Go persistence adapter.
- Propagates orbital states with numerical integration and J2 perturbation terms.
- Screens for close approaches with KD-tree-assisted conjunction detection.
- Schedules RTN-frame burns and converts them into executable ECI delta-v commands.
- Tracks station-keeping drift, fuel consumption, cooldown windows, and end-of-life status.
- Exposes compact visualization snapshots for the React dashboard.

## System Architecture

```text
React + TypeScript Dashboard
        |
        v
FastAPI Physics Engine  (:8000)
        |
        v
Go Adapter / Persistence Layer  (:8080)
        |
        v
MongoDB / external object store
```

## Repository Layout

```text
frontend/      React dashboard, globe view, telemetry panels, timeline UI
backend/       FastAPI APIs, orbital mechanics, simulation state, tests
go-adapter/    Go service for ingestion and persistence
docs/          Screenshots and supporting assets
```

## Physics Model

### State vector

All objects are modeled in the Earth-Centered Inertial frame using:

```math
S(t)=
\begin{bmatrix}
x & y & z & v_x & v_y & v_z
\end{bmatrix}^T
```

Position is in kilometers and velocity is in kilometers per second.

### Orbital propagation

The propagated acceleration is:

```math
\ddot{\vec r} = -\frac{\mu}{|\vec r|^3}\vec r + \vec a_{J2}
```

with:

- `mu = 398600.4418 km^3/s^2`
- `R_E = 6378.137 km`
- `J2 = 1.08263e-3`

The J2 perturbation term implemented in the backend is:

```math
\vec a_{J2} =
\frac{3}{2}J_2\mu R_E^2 |\vec r|^{-5}
\begin{bmatrix}
x(5z^2/|\vec r|^2 - 1) \\
y(5z^2/|\vec r|^2 - 1) \\
z(5z^2/|\vec r|^2 - 3)
\end{bmatrix}
```

The main propagator uses fixed-step RK4 with sub-stepping and also includes an adaptive `solve_ivp` path for longer horizons.

### Conjunction threshold

A critical conjunction is defined as:

```math
|\vec r_{sat}(t) - \vec r_{deb}(t)| < 0.100 \text{ km}
```

The backend uses KD-tree coarse screening plus TCA refinement.

### Maneuver frame conversion

Burns are planned in the local RTN frame and rotated back into ECI:

```math
\Delta \vec v_{ECI} = [\hat R \ \hat T \ \hat N]\Delta \vec v_{RTN}
```

### Fuel consumption

Fuel depletion is computed with the Tsiolkovsky rocket equation:

```math
\Delta m = m_{current}\left(1 - e^{-|\Delta \vec v|/(I_{sp} g_0)}\right)
```

with:

- `Isp = 300 s`
- `g0 = 9.80665e-3 km/s^2`

## APIs

### `POST /api/telemetry`

Bulk ingestion of live ECI state vectors for satellites and debris.

### `POST /api/maneuver/schedule`

Queues one or more burn commands for a satellite using RTN-frame delta-v vectors.

### `POST /api/simulate/step`

Advances the simulation clock, executes due burns, propagates all objects, updates drift, and regenerates conjunction warnings.

### `GET /api/visualization/snapshot`

Returns a compact dashboard payload containing:

- current timestamp
- satellites with lat/lon, fuel, status, and ECI state
- flattened debris cloud tuples
- active CDM warnings

## Frontend Modules

- `GlobeScene`: 3D Earth view with satellites, debris, and orbital context
- `SatelliteList`: left-side fleet browser and status list
- `DetailPanel`: selected-satellite state and maneuver controls
- `ManeuverTimeline`: Gantt-style burn and cooldown view
- `TelemetryHeatmap`, `ConjunctionBullseye`, `GroundTrackMap`: supporting visualization modules already present in the repo

## Operational Workflow

1. Telemetry arrives as ECI position and velocity updates.
2. ACM updates in-memory object state.
3. The simulator propagates satellites, debris, and nominal slots.
4. Conjunction logic identifies close-approach candidates and computes TCA / miss distance.
5. If a maneuver is required, ACM creates a burn sequence in RTN and stores it in the queue.
6. The step engine executes due burns, applies fuel loss and cooldown logic, and updates object status.
7. The visualization snapshot endpoint feeds the React dashboard.

## Objective Coverage Status

This repo covers many of the ACM requirements, but not all of them completely.

| Objective | Status | Notes |
|---|---|---|
| High-frequency telemetry ingestion | Implemented | FastAPI bulk ingestion exists; Go adapter and persistence layer are present. |
| Predictive conjunction assessment | Partially implemented | KD-tree screening and TCA logic exist, but the end-to-end 24-hour fleet-scale assessment is not fully hardened or benchmarked in this repo. |
| Autonomous collision avoidance | Partially implemented | RTN burn planning, scheduling, cooldown enforcement, and execution exist; optimization quality and mission-grade maneuver strategy are still simplified. |
| Station-keeping and recovery | Partially implemented | Drift tracking and automatic recovery planning exist, but recovery is still basic and not yet a full mission-slot optimizer. |
| Propellant budgeting and EOL management | Partially implemented | Fuel accounting and EOL checks exist; graveyard-orbit disposal logic is not fully complete end-to-end. |
| Global multi-objective optimization | Not fully implemented | There is no completed fleet-wide optimizer balancing uptime against fuel across the constellation. |
| Visualization modules | Partially implemented | The dashboard shell and several modules exist; not every required visual is fully finished or fully wired to live backend data. |

## What was fixed in this pass

- Restored the Maneuver Timeline view so it renders as a proper overlay instead of failing when opened.
- Wired the frontend scheduling payload to the backend API contract.
- Pulled pending burns into the UI timeline so scheduled actions can appear again.
- Corrected the LOS/ground-station bug path by distinguishing ECI-based visibility checks.
- Removed stray backup files from the Go adapter tree.
- Added a real dashboard screenshot for documentation.

## Running ACM

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Go adapter

```bash
cd go-adapter
go run main.go
```

### Docker

```bash
docker compose up --build
```

## Submission Files

- Root grading container: `Dockerfile`
- Technical report source: `TECHNICAL_REPORT.md`
- Demo outline: `VIDEO_DEMO_SCRIPT.md`
- Submission checklist: `SUBMISSION_GUIDE.md`

## Verification

Frontend production build:

```bash
cd frontend
npm run build
```

Backend visualization tests:

```bash
python -m pytest backend/tests/test_visualization.py -q
```

Physics test suite:

```bash
python backend/app/physics/tests/run_tests.py
```

## Implementation Notes

- The current frontend uses the `Orbital Insight` dashboard branding while the project name is ACM.
- Several additional markdown reports remain in the repo; this README is the primary high-level submission document.
- The codebase contains active work-in-progress changes outside this README and timeline fix, so further cleanup should be done carefully.
