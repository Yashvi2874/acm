"""
Global in-memory simulation state.

Unit conventions (CRITICAL — enforced everywhere):
  positions  : ECI, kilometres
  velocities : ECI, km/s
  timestamps : UTC datetime objects
  mass/fuel  : kg
"""
import asyncio
import bisect
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4


# ── Satellite ────────────────────────────────────────────────────────────────

SatelliteStatus = Literal["nominal", "maneuver", "safe-hold", "comms-loss", "decommissioned"]


@dataclass
class SatelliteState:
    satellite_id: str
    # ECI state — km, km/s
    position: list[float] = field(default_factory=lambda: [6778.137, 0.0, 0.0])
    velocity: list[float] = field(default_factory=lambda: [0.0, 7.668, 0.0])
    db_velocity: list[float] = field(default_factory=lambda: [0.0, 7.668, 0.0])
    velocity_dirty: bool = False
    mass_kg: float = 4.0
    fuel_kg: float = 0.5
    initial_fuel_kg: float = 0.5   # for EOL % calculation

    # Nominal slot: the "ghost" orbit — propagated with RK4 but no maneuvers applied.
    # Initialised to the satellite's first known state and advanced every tick.
    nominal_slot: dict = field(default_factory=lambda: {
        "position": [6778.137, 0.0, 0.0],
        "velocity": [0.0, 7.668, 0.0],
    })

    status: SatelliteStatus = "nominal"
    last_telemetry: dict = field(default_factory=dict)
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Burn cooldown tracking
    last_burn_time: datetime | None = None

    # Uptime: seconds spent within 10 km of nominal slot
    uptime_seconds: float = 0.0
    total_seconds: float = 0.0

    # Convenience: full 6-element ECI vector (km, km/s)
    @property
    def eci(self) -> list[float]:
        return self.position + self.velocity

    @eci.setter
    def eci(self, vec: list[float]) -> None:
        self.position = vec[:3]
        self.velocity = vec[3:]

    @property
    def nominal_eci(self) -> list[float]:
        return self.nominal_slot["position"] + self.nominal_slot["velocity"]

    @property
    def drift_km(self) -> float:
        import math
        dp = self.position
        np_ = self.nominal_slot["position"]
        return math.sqrt(sum((a - b) ** 2 for a, b in zip(dp, np_)))


# ── Debris ───────────────────────────────────────────────────────────────────

@dataclass
class DebrisState:
    debris_id: str
    position: list[float]   # ECI km
    velocity: list[float]   # ECI km/s
    db_velocity: list[float] = field(default_factory=list)
    # Optional metadata
    radar_cross_section_m2: float = 0.01
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def eci(self) -> list[float]:
        return self.position + self.velocity

    @eci.setter
    def eci(self, vec: list[float]) -> None:
        self.position = vec[:3]
        self.velocity = vec[3:]


# ── Maneuver queue ───────────────────────────────────────────────────────────

@dataclass
class ScheduledBurn:
    burn_id: str = field(default_factory=lambda: str(uuid4())[:8])
    satellite_id: str = ""
    delta_v_rtn: list[float] = field(default_factory=lambda: [0.0, 0.0, 0.0])  # km/s RTN
    burn_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    executed: bool = False

    # For bisect sorting by burn_time
    def __lt__(self, other: "ScheduledBurn") -> bool:
        return self.burn_time < other.burn_time


# ── CDM Warning ──────────────────────────────────────────────────────────────

@dataclass
class CDMWarning:
    warning_id: str = field(default_factory=lambda: str(uuid4())[:8])
    object_1_id: str = ""           # satellite or debris id
    object_2_id: str = ""
    tca: datetime = field(default_factory=lambda: datetime.now(timezone.utc))  # Time of Closest Approach
    miss_distance_km: float = 0.0
    probability_of_collision: float = 0.0
    issued_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False


# ── SimulationState ──────────────────────────────────────────────────────────

class SimulationState:
    def __init__(self):
        self._lock = asyncio.Lock()

        self.satellites: dict[str, SatelliteState] = {}
        self.debris: dict[str, DebrisState] = {}

        # Sorted by burn_time via bisect.insort
        self.maneuver_queue: list[ScheduledBurn] = []
        self.maneuver_history: list[dict] = []

        # UTC datetime clock — starts at epoch of first telemetry or now
        self.sim_time: datetime = datetime.now(timezone.utc)

        # Default propagation step
        self.dt_seconds: float = 10.0

        # Trajectory logs: id → list of (datetime, [x,y,z,vx,vy,vz])
        self.trajectory_log: dict[str, list[tuple[datetime, list[float]]]] = {}

        # Active conjunction warnings
        self.cdm_warnings: list[CDMWarning] = []

    # ── Lock ─────────────────────────────────────────────────────────────────

    @property
    def lock(self) -> asyncio.Lock:
        return self._lock

    # ── Satellite helpers ─────────────────────────────────────────────────────

    def get_or_create_satellite(self, satellite_id: str) -> SatelliteState:
        if satellite_id not in self.satellites:
            sat = SatelliteState(satellite_id=satellite_id)
            # Nominal slot starts identical to initial state — ghost orbit
            sat.nominal_slot = {
                "position": list(sat.position),
                "velocity": list(sat.velocity),
            }
            sat.initial_fuel_kg = sat.fuel_kg
            self.satellites[satellite_id] = sat
            self.trajectory_log[satellite_id] = []
        return self.satellites[satellite_id]

    # ── Debris helpers ────────────────────────────────────────────────────────

    def get_or_create_debris(self, debris_id: str, position: list[float], velocity: list[float]) -> DebrisState:
        if debris_id not in self.debris:
            self.debris[debris_id] = DebrisState(
                debris_id=debris_id,
                position=list(position),
                velocity=list(velocity),
                db_velocity=list(velocity),
            )
            self.trajectory_log[debris_id] = []
        return self.debris[debris_id]

    # ── Maneuver queue helpers ────────────────────────────────────────────────

    def enqueue_burn(self, burn: ScheduledBurn) -> None:
        """Insert burn in burn_time order."""
        bisect.insort(self.maneuver_queue, burn)

    def pop_due_burns(self) -> list[ScheduledBurn]:
        """Remove and return all burns with burn_time <= sim_time."""
        due, remaining = [], []
        for b in self.maneuver_queue:
            (due if b.burn_time <= self.sim_time else remaining).append(b)
        self.maneuver_queue = remaining
        return due

    # ── CDM helpers ───────────────────────────────────────────────────────────

    def add_cdm(self, warning: CDMWarning) -> None:
        """Add a new CDM, replacing any existing unresolved warning for the same pair."""
        pair = frozenset([warning.object_1_id, warning.object_2_id])
        self.cdm_warnings = [
            w for w in self.cdm_warnings
            if frozenset([w.object_1_id, w.object_2_id]) != pair or w.resolved
        ]
        self.cdm_warnings.append(warning)

    def resolve_cdm(self, warning_id: str) -> bool:
        for w in self.cdm_warnings:
            if w.warning_id == warning_id:
                w.resolved = True
                return True
        return False

    @property
    def active_cdm_warnings(self) -> list[CDMWarning]:
        return [w for w in self.cdm_warnings if not w.resolved]

    # ── Trajectory log ────────────────────────────────────────────────────────

    def log_state(self, obj_id: str, t: datetime, eci: list[float]) -> None:
        if obj_id not in self.trajectory_log:
            self.trajectory_log[obj_id] = []
        self.trajectory_log[obj_id].append((t, list(eci)))
        # Cap log at 5400 entries (~15 hours at 10s steps)
        if len(self.trajectory_log[obj_id]) > 5400:
            self.trajectory_log[obj_id] = self.trajectory_log[obj_id][-5400:]


# ── Process-wide singleton ────────────────────────────────────────────────────

simulation_state = SimulationState()
