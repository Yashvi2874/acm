# ACM Video Demo Script

Target duration: 4 to 5 minutes

## 1. Opening

“This is ACM, the Autonomous Constellation Manager. ACM is designed to ingest satellite and debris telemetry, propagate orbital motion with RK4 and J2 perturbation, assess conjunction risk, and visualize constellation state through a live dashboard.”

## 2. Repository and Build

Show:

- public GitHub repository
- root `Dockerfile`
- `ubuntu:22.04`
- API exposed on port `8000`

Say:

“The project is organized into a FastAPI backend, a Go persistence adapter, and a React frontend. The root Dockerfile is prepared for automated grading and starts the required API on port 8000.”

## 3. Telemetry and Persistence

Show:

- `/api/telemetry`
- MongoDB collections
- live object documents

Say:

“Telemetry is ingested in ECI coordinates and stored as the authoritative baseline. ACM then propagates those objects forward in time and keeps MongoDB synchronized with updated coordinates.”

## 4. Physics and Propagation

Show:

- backend propagation code
- RK4 and J2 logic
- simulation step endpoint

Say:

“Orbital motion is propagated with RK4 integration and a J2 perturbation model. Coordinates are updated continuously, while satellite velocity is only overwritten in storage when a maneuver changes it.”

## 5. Dashboard

Show:

- main globe view
- orbit tracks
- moving satellites and debris
- maneuver timeline

Say:

“The frontend polls the backend and database-backed state, then rebuilds the orbital scene so satellites move along updated orbit paths rather than remaining static.”

## 6. Maneuver and Risk Handling

Show:

- conjunction warning flow
- maneuver scheduling
- cooldown and fuel logic

Say:

“ACM screens conjunctions, schedules burns in the RTN frame, converts them to ECI, and enforces cooldown and fuel constraints.”

## 7. Close

“ACM demonstrates a complete telemetry-to-physics-to-visualization workflow with a grading-ready Docker setup, persistent object updates, and a mission-control style interface for constellation operations.”
