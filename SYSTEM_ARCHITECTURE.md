# ACM System Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React + Three.js)                  │
│  - 3D Globe Visualization                                       │
│  - Satellite Tracking                                           │
│  - Maneuver Scheduling UI                                       │
│  - Real-time Telemetry Display                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/REST
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API (FastAPI)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ /api/telemetry      - Ingest state vectors              │   │
│  │ /api/maneuver       - Schedule burns                    │   │
│  │ /api/simulate       - Advance simulation                │   │
│  │ /api/visualization  - Frontend snapshots                │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SIMULATION STATE MANAGER                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ SimulationState (Global Singleton)                      │   │
│  │  - satellites: Dict[str, SatelliteState]                │   │
│  │  - debris: Dict[str, DebrisState]                       │   │
│  │  - maneuver_queue: List[ScheduledBurn]                  │   │
│  │  - cdm_warnings: List[CDMWarning]                       │   │
│  │  - trajectory_log: Dict[str, List[State]]               │   │
│  │  - sim_time: datetime                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   PHYSICS    │  │ CONJUNCTION  │  │   MANEUVER   │
│   ENGINE     │  │  DETECTION   │  │  EXECUTION   │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## Component Details

### 1. Frontend (React + Three.js)

**Location:** `frontend/src/`

**Key Components:**
- `GlobeScene.tsx` - 3D visualization with Three.js
- `DetailPanel.tsx` - Satellite details and conjunction info
- `ManeuverModal.tsx` - Burn scheduling interface
- `OperationalDashboard.tsx` - Mission control dashboard
- `usePhysicsSimulation.ts` - API integration hook

**Responsibilities:**
- Real-time 3D visualization of constellation
- User interface for maneuver scheduling
- Display of telemetry and CDM warnings
- Interactive satellite selection and details

---

### 2. Backend API (FastAPI)

**Location:** `backend/app/`

**Routers:**
- `api/telemetry.py` - Telemetry ingestion endpoint
- `api/maneuver.py` - Maneuver scheduling endpoint
- `api/simulate.py` - Simulation control endpoint
- `api/visualization.py` - Frontend snapshot endpoint

**Key Features:**
- Async request handling
- CORS middleware for frontend integration
- Fire-and-forget logging to Go adapter
- Comprehensive error handling

**Endpoints:**
```
POST   /api/telemetry              - Ingest state vectors
POST   /api/maneuver/schedule      - Schedule maneuvers
GET    /api/maneuver/pending       - List pending burns
POST   /api/simulate/init          - Initialize simulation
POST   /api/simulate/step          - Advance simulation
GET    /api/simulate/state         - Get current state
GET    /api/visualization/snapshot - Get frontend snapshot
GET    /health                     - Health check
```

---

### 3. Simulation State Manager

**Location:** `backend/app/state_store.py`

**Data Structures:**

#### SatelliteState
```python
@dataclass
class SatelliteState:
    satellite_id: str
    position: list[float]           # ECI km [x, y, z]
    velocity: list[float]           # ECI km/s [vx, vy, vz]
    mass_kg: float
    fuel_kg: float
    initial_fuel_kg: float
    nominal_slot: dict              # Ghost orbit
    status: SatelliteStatus         # nominal/maneuver/safe-hold/comms-loss/decommissioned
    last_telemetry: dict
    last_updated: datetime
    last_burn_time: datetime | None
    uptime_seconds: float
    total_seconds: float
```

#### DebrisState
```python
@dataclass
class DebrisState:
    debris_id: str
    position: list[float]           # ECI km
    velocity: list[float]           # ECI km/s
    radar_cross_section_m2: float
    last_updated: datetime
```

#### ScheduledBurn
```python
@dataclass
class ScheduledBurn:
    burn_id: str
    satellite_id: str
    delta_v_rtn: list[float]        # RTN frame km/s
    burn_time: datetime
    executed: bool
```

#### CDMWarning
```python
@dataclass
class CDMWarning:
    warning_id: str
    object_1_id: str
    object_2_id: str
    tca: datetime                   # Time of Closest Approach
    miss_distance_km: float
    probability_of_collision: float
    issued_at: datetime
    resolved: bool
```

**Global Singleton:**
```python
simulation_state = SimulationState()
```

---

### 4. Physics Engine

**Location:** `backend/app/physics/`

#### acceleration.py
```python
def compute_gravity(state: np.ndarray) -> np.ndarray
    # Computes gravitational acceleration
    # a = -μ/r³ * r

def compute_j2(state: np.ndarray) -> np.ndarray
    # Computes J2 perturbation acceleration
    # Accounts for Earth's equatorial bulge

def compute_acceleration(state: np.ndarray) -> np.ndarray
    # Total acceleration = gravity + J2
```

#### integrator.py
```python
def rk4_step(state: np.ndarray, dt: float) -> np.ndarray
    # 4th-order Runge-Kutta integration
    # Propagates state by dt seconds
    # Handles orbital decay detection
```

#### propagator.py
```python
def propagate_rk4(
    state: np.ndarray,
    t_end: float,
    dt: float
) -> list[np.ndarray]
    # Multi-step propagation
    # Returns trajectory history
```

#### constants.py
```python
MU = 398600.4418        # Earth GM (km³/s²)
J2 = 1.08263e-3         # J2 coefficient
R_E = 6378.137          # Earth radius (km)
```

**Physics Model:**
- Coordinate Frame: ECI (J2000)
- Units: km, km/s, seconds
- Perturbations: J2 (Earth's equatorial bulge)
- Integration: RK4 (4th-order)
- Timestep: 10 seconds (configurable)

---

### 5. Conjunction Detection

**Location:** `backend/app/physics/conjunction.py`

**Key Functions:**

```python
def compute_relative_state(
    state_a: np.ndarray,
    state_b: np.ndarray
) -> tuple[np.ndarray, np.ndarray, float]
    # Returns: Δr, Δv, separation distance

def compute_tca(
    state_a: np.ndarray,
    state_b: np.ndarray
) -> tuple[float, float, np.ndarray]
    # Returns: tau (TCA time), d_min (min distance), Δr_tca

def is_tca_in_window(tau: float, t_window: float) -> bool
    # Checks if TCA is within lookahead window

def is_violation(d_min: float, safety_threshold_km: float) -> bool
    # Checks if minimum distance violates threshold

def analyze_pair(
    obj_a: SimObject,
    obj_b: SimObject,
    t_window: float,
    safety_threshold_km: float
) -> ConjunctionEvent | None
    # Analyzes pair for conjunction

def screen_conjunctions(
    objects: list[SimObject],
    candidate_pairs: list[tuple[str, str]],
    t_window: float,
    safety_threshold_km: float
) -> list[ConjunctionEvent]
    # Screens candidate pairs

def check_conjunctions(bodies: list[dict]) -> list[dict]
    # High-level API for conjunction checking
```

**Algorithm:**
1. Compute relative state (Δr, Δv)
2. Calculate TCA using linear approximation: τ = -Δr·Δv / |Δv|²
3. Compute minimum distance: d_min = |Δr + τ·Δv|
4. Check if TCA is within 90-minute window
5. Check if d_min violates 100m threshold
6. Flag as CRITICAL if d_min < 100m

**Complexity:**
- Per-pair: O(1)
- N satellites vs M debris: O(N×M)
- Typical: ~10 ms for 50 sats, 1000 debris

---

### 6. Maneuver Execution

**Location:** `backend/app/physics/maneuver.py`

**Key Functions:**

```python
def rtn_to_eci(
    delta_v_rtn: np.ndarray,
    position: np.ndarray,
    velocity: np.ndarray
) -> np.ndarray
    # Converts RTN frame delta-v to ECI frame

def fuel_consumed(mass_kg: float, delta_v_mag: float) -> float
    # Tsiolkovsky equation: Δm = m * (1 - exp(-Δv/v_e))

def check_eol(
    satellite_id: str,
    fuel_kg: float,
    position: list[float],
    velocity: list[float]
) -> dict | None
    # Checks for end-of-life conditions
```

**Burn Execution Process:**
1. Check burn time <= current sim_time
2. Check cooldown (600s since last burn)
3. Convert delta-v from RTN to ECI frame
4. Apply delta-v to velocity
5. Deduct fuel using Tsiolkovsky equation
6. Update satellite status to "maneuver"
7. Log burn execution

---

## Data Flow

### Telemetry Ingestion Flow

```
Frontend/Simulator
        │
        ▼
POST /api/telemetry
        │
        ▼
TelemetryBatch (Pydantic model)
        │
        ▼
SimulationState.get_or_create_satellite/debris()
        │
        ▼
Update position, velocity, timestamp
        │
        ▼
Log to trajectory_log
        │
        ▼
Response: {status: "ACK", processed_count, active_cdm_warnings}
```

### Simulation Step Flow

```
Frontend
        │
        ▼
POST /api/simulate/step {step_seconds: 3600}
        │
        ▼
Split into sub-steps (max 10s each)
        │
        ├─ Execute due burns
        │  ├─ Check cooldown
        │  ├─ Convert RTN to ECI
        │  ├─ Apply delta-v
        │  └─ Deduct fuel
        │
        ├─ Propagate satellites (RK4 + J2)
        │  └─ Update position, velocity
        │
        ├─ Propagate nominal ghost orbit
        │  └─ Track station-keeping drift
        │
        ├─ Propagate debris (RK4 + J2)
        │  └─ Update position, velocity
        │
        ├─ Check EOL conditions
        │  └─ Flag decommissioned satellites
        │
        ├─ Detect conjunctions
        │  ├─ Compute relative states
        │  ├─ Calculate TCA
        │  └─ Check violations
        │
        └─ Fire-and-forget logging to Go adapter
           ├─ Telemetry snapshot
           ├─ Maneuver logs
           ├─ CDM logs
           └─ Collision logs
        │
        ▼
Response: {status: "STEP_COMPLETE", new_timestamp, collisions_detected, maneuvers_executed}
```

### Conjunction Detection Flow

```
All bodies (satellites + debris)
        │
        ▼
For each satellite:
  For each debris:
    ├─ Compute relative state (Δr, Δv, d)
    ├─ Calculate TCA (τ, d_min, Δr_tca)
    ├─ Check if TCA in window (0 ≤ τ ≤ 5400s)
    ├─ Check if violation (d_min < 0.100 km)
    └─ Create ConjunctionEvent if relevant
        │
        ▼
Filter violations (d_min < 0.100 km)
        │
        ▼
Sort by d_min (most dangerous first)
        │
        ▼
Create/update CDMWarnings
        │
        ▼
Return to API
```

---

## State Transitions

### Satellite Status Transitions

```
┌─────────────┐
│   nominal   │ ◄─────────────────────────┐
└──────┬──────┘                           │
       │ (maneuver scheduled)             │
       ▼                                  │
┌─────────────┐                           │
│   maneuver  │ ──────────────────────────┘
└──────┬──────┘ (burn executed)
       │ (drift > 10 km)
       ▼
┌─────────────┐
│ safe-hold   │
└──────┬──────┘
       │ (fuel < threshold)
       ▼
┌──────────────────┐
│ decommissioned   │
└──────────────────┘
```

---

## Performance Characteristics

### Computational Complexity

| Operation | Complexity | Time |
|-----------|-----------|------|
| RK4 step | O(1) | ~0.1 ms |
| Conjunction check | O(N×M) | ~10 ms |
| Maneuver execution | O(1) | ~0.01 ms |
| State update | O(N+M) | ~1 ms |
| Full tick | O(N×M) | ~100 ms |

### Memory Usage

| Component | Size |
|-----------|------|
| Satellite state | ~500 bytes |
| Debris state | ~300 bytes |
| Trajectory entry | ~50 bytes |
| CDM warning | ~200 bytes |

**Example (50 sats, 1000 debris, 5400 history):**
- Satellites: 50 × 500 B = 25 KB
- Debris: 1000 × 300 B = 300 KB
- Trajectories: 1050 × 5400 × 50 B = 283 MB
- CDM warnings: ~100 × 200 B = 20 KB
- **Total: ~300 MB**

---

## Integration Points

### Frontend ↔ Backend
- REST API (HTTP/JSON)
- WebSocket (optional, for real-time updates)
- CORS enabled for cross-origin requests

### Backend ↔ Go Adapter
- Fire-and-forget HTTP POST
- Logging endpoints:
  - `/log/telemetry`
  - `/log/maneuver`
  - `/log/cdm`
  - `/log/collision`

### Backend ↔ Simulator
- REST API (HTTP/JSON)
- Endpoints:
  - `POST /api/telemetry` - Receive state vectors
  - `POST /api/simulate/step` - Advance simulation
  - `GET /api/simulate/state` - Query state

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │   Frontend   │  │   Backend    │  │    Go    │ │
│  │   (React)    │  │  (FastAPI)   │  │ Adapter  │ │
│  │   Port 3000  │  │   Port 8000  │  │ Port 8080│ │
│  └──────────────┘  └──────────────┘  └──────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Environment Variables:**
- `GO_ADAPTER_URL` - URL of Go adapter (default: http://go-adapter:8080)
- `BACKEND_PORT` - Backend port (default: 8000)
- `FRONTEND_PORT` - Frontend port (default: 3000)

---

## Scalability Considerations

### Horizontal Scaling
- Stateless API layer (can run multiple instances)
- Shared state via Redis (optional)
- Load balancer for API distribution

### Vertical Scaling
- Increase timestep (dt) for faster simulation
- Reduce conjunction check frequency
- Implement spatial indexing (octree) for debris

### Optimization Opportunities
1. **Spatial Indexing:** Use octree for O(log N) conjunction checks
2. **Parallel Processing:** Multi-threaded RK4 integration
3. **GPU Acceleration:** CUDA for large-scale propagation
4. **Caching:** Cache TCA calculations for stable pairs

---

## Testing Strategy

### Unit Tests
- Physics engine (acceleration, integration)
- Conjunction detection (TCA, violations)
- State management (satellites, debris, maneuvers)

### Integration Tests
- Full workflow (telemetry → detection → maneuver → step)
- API response format validation
- State propagation verification

### Performance Tests
- Scalability (50+ satellites, 1000+ debris)
- Timing (< 100 ms per tick)
- Energy conservation (< 0.01% error)

---

## Future Enhancements

1. **Atmospheric Drag:** Add exponential atmosphere model
2. **Solar Radiation Pressure:** Model SRP effects
3. **Finite Burn Duration:** Implement burn modeling
4. **Quadratic TCA:** More accurate for longer windows
5. **Machine Learning:** Predict optimal maneuvers
6. **Real-time Visualization:** WebSocket updates
7. **Multi-constellation Support:** Multiple operators
8. **Autonomous Decision-Making:** AI-based maneuver planning

---

*Architecture Document - April 3, 2026*  
*Autonomous Constellation Manager v1.0*
