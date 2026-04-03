# ACM Setup Guide

## Quick Start

### Docker (Recommended)
```bash
docker compose up --build
```
Access at http://localhost:3000

### Manual Setup

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

**Go Adapter:**
```bash
cd go-adapter
go run main.go
```

## API Endpoints

### Visualization
- `GET /api/visualization/snapshot` - Full constellation snapshot (optimized for frontend)
- `GET /api/visualization/ground-track/{satellite_id}` - Historical ground track
- `GET /api/visualization/cdm` - Conjunction data messages

### Telemetry
- `POST /api/telemetry` - Bulk object ingestion
- `GET /api/telemetry/objects` - All current objects
- `GET /api/telemetry/{object_id}` - Single object telemetry

### Maneuver
- `POST /api/maneuver/plan` - Plan collision avoidance maneuver
- `GET /api/maneuver/history` - Maneuver execution history

### Simulation
- `POST /api/simulate/step` - Advance simulation by N seconds
- `POST /api/simulate/reset` - Reset simulation state

## Snapshot Response Format

```json
{
  "sim_time": "2026-03-12T08:00:00.000Z",
  "satellites": {
    "SAT-Alpha-04": {
      "position": {"lat": 28.545, "lon": 77.192, "alt_km": 400.5},
      "status": "NOMINAL",
      "fuel_kg": 48.5,
      "orbital_elements": {...}
    }
  },
  "debris": [
    ["DEB-99421", 12.42, -45.21, 400.5],
    ["DEB-99422", 12.55, -45.10, 401.2]
  ],
  "cdm_warnings": [...],
  "ground_stations": [...]
}
```

## Performance Targets

- **Visualization**: 60 FPS with 50+ satellites, 10,000+ debris
- **Propagation**: RK4+J2 with <1m position error per 30s step
- **Conjunction Detection**: O(N log N) k-d tree efficiency
- **Telemetry**: 10,000+ objects/second throughput
