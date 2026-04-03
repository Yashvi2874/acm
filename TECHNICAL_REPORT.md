# ACM Technical Report

## 1. System Overview

ACM, the Autonomous Constellation Manager, is a backend-driven orbital operations platform for three core tasks:

1. ingesting real-time telemetry for satellites and debris
2. propagating orbital states forward with RK4 and J2 perturbation terms
3. exposing conjunction, maneuver, and visualization data through a REST API and dashboard

The repository is split into three main layers:

- `backend/`: FastAPI physics engine and simulation state
- `go-adapter/`: persistence and object upsert layer for MongoDB
- `frontend/`: React dashboard for orbit visualization and mission-state monitoring

## 2. Numerical Methods

### 2.1 State Representation

Each object is represented by a six-dimensional ECI state vector:

```math
S(t) = [x, y, z, v_x, v_y, v_z]^T
```

with position in kilometers and velocity in kilometers per second.

### 2.2 Dynamics Model

The propagated acceleration is:

```math
\ddot{\vec r} = -\frac{\mu}{|\vec r|^3}\vec r + \vec a_{J2}
```

where:

- `mu = 398600.4418 km^3/s^2`
- `R_E = 6378.137 km`
- `J2 = 1.08263e-3`

The J2 perturbation term models the effect of Earth’s oblateness and is implemented directly inside the propagation layer.

### 2.3 Integration

The simulation uses fourth-order Runge-Kutta integration for time stepping. The backend also caps internal substeps so longer windows are broken into smaller physically stable steps.

This is used for:

- simulation stepping
- continuous background propagation
- future orbit path generation for visualization

## 3. Conjunction Assessment

The conjunction pipeline uses a KD-tree coarse screen to reduce pairwise comparisons and then refines candidate risk pairs with closest-approach calculations.

The critical threshold is:

```math
|\vec r_{sat}(t) - \vec r_{deb}(t)| < 0.100 \text{ km}
```

The implementation currently supports:

- current-state coarse screening
- TCA estimation
- miss-distance ranking
- active warning generation for the API and UI

## 4. Maneuver Logic

Burn planning is performed in the RTN frame and then rotated into ECI for execution:

```math
\Delta \vec v_{ECI} = [\hat R \ \hat T \ \hat N]\Delta \vec v_{RTN}
```

The backend enforces:

- per-burn delta-v limits
- 600 second cooldown windows
- fuel depletion using the rocket equation

Fuel consumption is computed as:

```math
\Delta m = m_{current}\left(1 - e^{-|\Delta \vec v|/(I_{sp} g_0)}\right)
```

with `Isp = 300 s`.

## 5. Database and Synchronization Design

Telemetry ingested through `/api/telemetry` is treated as the freshest authoritative baseline. Those objects are upserted into MongoDB through the Go adapter.

After ingest:

1. the backend stores the latest in-memory state
2. the background propagator advances coordinates every 60 seconds using RK4 + J2
3. the database is overwritten with the updated coordinates
4. satellite velocity in the database is only overwritten when a maneuver actually changes it

This separation keeps MongoDB aligned with propagated position updates while still preserving maneuver-triggered velocity changes.

## 6. Frontend Visualization

The frontend polls the live object store and visualization snapshot APIs, then rebuilds orbital geometry from updated ECI coordinates. This allows the globe to render satellites and debris moving along physically derived orbital paths instead of static markers.

The main visualization outputs are:

- live 3D orbit display
- fleet status panel
- maneuver timeline
- compact API-backed orbital snapshots

## 7. Current Status

The project fully satisfies the Docker base-image requirement at the repository root and exposes the required API on port 8000.

Current implementation strength:

- telemetry ingestion
- RK4 + J2 propagation
- background coordinate persistence
- dashboard rendering

Still simplified or incomplete:

- full 24-hour fleet-scale optimization
- advanced multi-objective global scheduling
- fully mature autonomous recovery and graveyard-orbit strategy

## 8. Submission Notes

For automated grading, the root `Dockerfile` uses `ubuntu:22.04`, binds the API to `0.0.0.0`, and exposes port `8000`.
