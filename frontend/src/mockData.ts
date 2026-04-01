import type { Satellite, DebrisPoint, Maneuver } from './types';

const rng = (seed: number) => {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
};

export function generateSatellites(): Satellite[] {
  const rand = rng(42);
  const MU = 398600.4418; // km³/s²
  const statuses: Satellite['status'][] = ['nominal', 'nominal', 'nominal', 'warning', 'critical'];
  return Array.from({ length: 10 }, (_, i) => {
    const r = rand;
    const orbitRadius = 6771 + r() * 1200;
    const inclination = r() * Math.PI;
    const phase = r() * Math.PI * 2;
    const speed = 0.001 + r() * 0.0005;
    const status = statuses[Math.floor(r() * statuses.length)];
    const x = orbitRadius * Math.cos(phase) * Math.cos(inclination);
    const y = orbitRadius * Math.sin(phase);
    const z = orbitRadius * Math.cos(phase) * Math.sin(inclination);

    // Circular orbit velocity perpendicular to position in orbit plane
    const v_circ = Math.sqrt(MU / orbitRadius);
    const vx = v_circ * (-Math.sin(phase) * Math.cos(inclination));
    const vy = v_circ * Math.cos(phase);
    const vz = v_circ * (-Math.sin(phase) * Math.sin(inclination));

    return {
      id: `SAT-${String(i + 1).padStart(3, '0')}`,
      name: `Orbital-${i + 1}`,
      status,
      fuel: 10 + Math.floor(r() * 90),
      pos: [x, y, z],
      vel: [vx, vy, vz],
      orbitRadius,
      orbitInclination: inclination,
      orbitPhase: phase,
      orbitSpeed: speed,
      collisionRisk: status === 'critical' && r() > 0.4,
      riskTarget: `DEB-${Math.floor(r() * 9999)}`,
    };
  });
}

export function generateDebris(): DebrisPoint[] {
  const rand = rng(99);
  const MU = 398600.4418; // km³/s²
  return Array.from({ length: 50 }, () => {
    const r = rand;
    // Keep debris in same orbital band as satellites (LEO: 6771–7971 km)
    const radius = 6771 + r() * 1200;
    const inc = r() * Math.PI;
    const phase = r() * Math.PI * 2;
    const speed = 0.0003 + r() * 0.0008;

    // ECI position
    const x = radius * Math.cos(phase) * Math.cos(inc);
    const y = radius * Math.sin(phase);
    const z = radius * Math.cos(phase) * Math.sin(inc);

    // Circular orbit velocity (perpendicular to position in orbit plane)
    const v_circ = Math.sqrt(MU / radius); // km/s
    // Velocity direction: d(pos)/d(phase) normalized × v_circ
    const vx = v_circ * (-Math.sin(phase) * Math.cos(inc));
    const vy = v_circ * Math.cos(phase);
    const vz = v_circ * (-Math.sin(phase) * Math.sin(inc));

    return {
      x, y, z,
      vx, vy, vz,
      r: radius, phase, speed, inclination: inc,
    };
  });
}

export function generateManeuvers(satellites: Satellite[]): Maneuver[] {
  const rand = rng(77);
  const types: Maneuver['type'][] = ['avoidance', 'station-keeping', 'recovery'];
  return Array.from({ length: 6 }, (_, i) => ({
    id: `MNV-${i + 1}`,
    satelliteId: satellites[Math.floor(rand() * satellites.length)].id,
    type: types[Math.floor(rand() * 3)],
    startHour: rand() * 22,
    durationHours: 0.5 + rand() * 2,
    deltaV: 0.1 + rand() * 2.5,
  }));
}
