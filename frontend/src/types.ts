export interface ConjunctionInfo {
  object_b_id: string;          // the threat object id
  d_min_km: number;             // minimum separation at TCA (km)
  current_sep_km: number;       // current separation right now (km)
  tau_seconds: number;          // seconds until closest approach
  tau_minutes: number;          // minutes until closest approach
  is_violation: boolean;        // true if d_min < safety threshold
  delta_r_tca: [number, number, number]; // relative position vector at TCA
}

export type SatelliteStatus = 'nominal' | 'warning' | 'critical';
export type ManeuverType = 'avoidance' | 'station-keeping' | 'recovery';
export type BurnDirection = 'prograde' | 'retrograde' | 'radial';

export interface Satellite {
  id: string;
  name: string;
  status: SatelliteStatus;
  fuel: number;
  pos: [number, number, number]; // ECI km
  vel: [number, number, number]; // km/s
  orbitRadius: number; // km from Earth center
  orbitInclination: number; // radians
  orbitPhase: number; // radians, current
  orbitSpeed: number; // rad/s
  collisionRisk: boolean;
  riskTarget?: string;
  lastManeuver?: string;
  autoManeuvering?: boolean;   // currently executing auto-avoidance
  threatDebrisIdx?: number;    // index of threatening debris piece
}

export interface DebrisPoint {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  r: number; // orbit radius
  phase: number;
  speed: number;
  inclination: number;
}

export interface GroundStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface Maneuver {
  id: string;
  satelliteId: string;
  type: ManeuverType;
  startHour: number; // 0-24
  durationHours: number;
  deltaV: number;
  executed?: boolean;
}

export interface ManeuverPlan {
  satelliteId: string;
  type: ManeuverType;
  direction: BurnDirection;
  deltaV: number; // km/s
  scheduledHour: number; // 0-24, 0 = now
}

export interface CdmWarning {
  warning_id: string;
  object_1_id: string;
  object_2_id: string;
  tca: string;
  miss_distance_km: number;
  severity: 'WARNING' | 'CRITICAL';
}
