export type SatelliteStatus = 'nominal' | 'warning' | 'critical';
export type ManeuverType = 'avoidance' | 'station-keeping' | 'recovery';
export type BurnDirection = 'prograde' | 'retrograde' | 'radial';

export interface Satellite {
  id: string;
  name: string;
  status: SatelliteStatus;
  fuel: number; // 0-100
  pos: [number, number, number]; // ECI km
  vel: [number, number, number]; // km/s
  orbitRadius: number; // km from Earth center
  orbitInclination: number; // radians
  orbitPhase: number; // radians, current
  orbitSpeed: number; // rad/s
  collisionRisk: boolean;
  riskTarget?: string;
  lastManeuver?: string; // maneuver id applied
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
