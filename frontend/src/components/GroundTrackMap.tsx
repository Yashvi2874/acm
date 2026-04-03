/**
 * Ground Track Map - Mercator Projection 2D Visualization
 * 
 * FDO-grade situational awareness dashboard showing:
 * - Real-time sub-satellite points (ground track)
 * - 90-minute historical trailing path
 * - 90-minute predicted trajectory (dashed)
 * - Terminator line (day/night boundary)
 * - Ground stations with LOS cones
 * - Debris field overlay
 * 
 * Optimized for 50+ satellites + 10,000+ debris at 60 FPS using Canvas API
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Satellite, DebrisPoint, GroundStation } from '../types';

interface Props {
  satellites: Satellite[];
  debris: DebrisPoint[];
  groundStations: GroundStation[];
  simTime: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// ============================================================================
// MERCATOR PROJECTION UTILITIES
// ============================================================================

/**
 * Convert ECI coordinates to lat/lon using GMST
 * ECI frame: x points to vernal equinox, z points to north pole
 */
function eciToLatLon(x: number, y: number, z: number, gmst: number): [number, number] {
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.asin(z / r);
  
  // Longitude in ECI frame
  let lon = Math.atan2(y, x);
  
  // Rotate by GMST to get Earth-fixed longitude
  lon -= gmst;
  
  // Normalize to [-π, π]
  while (lon > Math.PI) lon -= 2 * Math.PI;
  while (lon < -Math.PI) lon += 2 * Math.PI;
  
  return [
    lat * (180 / Math.PI),  // latitude in degrees
    lon * (180 / Math.PI),  // longitude in degrees
  ];
}

/**
 * Mercator projection: convert lat/lon to canvas coordinates
 * Standard Web Mercator (EPSG:3857)
 */
function mercatorProject(lat: number, lon: number, width: number, height: number): [number, number] {
  // Normalize longitude to [-180, 180]
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  
  // Mercator projection
  const x = ((lon + 180) / 360) * width;
  const y = ((180 - (lat * 180) / Math.PI - 180 * Math.log(Math.tan((Math.PI * (90 + lat)) / 360)) / Math.PI) / 360) * height;
  
  return [x, y];
}

/**
 * Calculate GMST (Greenwich Mean Sidereal Time) in radians
 */
function gmstRadians(simTime: string): number {
  const ms = new Date(simTime).getTime();
  if (Number.isNaN(ms)) return 0;
  
  const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
  const EARTH_OMEGA = 7.2921150e-5;
  const theta = EARTH_OMEGA * ((ms - J2000_MS) / 1000);
  
  return ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

/**
 * Calculate terminator line (day/night boundary)
 * Returns array of lat/lon points forming the terminator
 */
function calculateTerminator(gmst: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  
  // Sun is at vernal equinox (lon=0) in ECI frame
  // Terminator is perpendicular to sun direction
  // In Earth-fixed frame, sun is at lon = gmst (in radians)
  const sunLonEarth = gmst * (180 / Math.PI);
  
  // Terminator runs north-south at lon = sunLonEarth ± 90°
  const terminatorLon = sunLonEarth + 90;
  
  for (let lat = -90; lat <= 90; lat += 2) {
    points.push([lat, terminatorLon]);
  }
  
  return points;
}

/**
 * Calculate LOS (Line of Sight) cone for ground station
 * Returns array of lat/lon points forming the LOS circle
 */
function calculateLOSCone(
  stationLat: number,
  stationLon: number,
  elevationMaskDeg: number = 10
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  
  // Angular radius of LOS cone (in degrees)
  // For 10° elevation mask: ~81° angular distance from station
  const angularRadius = 90 - elevationMaskDeg;
  
  // Generate circle around station
  for (let bearing = 0; bearing < 360; bearing += 5) {
    const bearingRad = (bearing * Math.PI) / 180;
    const angularRadiusRad = (angularRadius * Math.PI) / 180;
    
    // Great circle calculation
    const lat1 = (stationLat * Math.PI) / 180;
    const lon1 = (stationLon * Math.PI) / 180;
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularRadiusRad) +
      Math.cos(lat1) * Math.sin(angularRadiusRad) * Math.cos(bearingRad)
    );
    
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularRadiusRad) * Math.cos(lat1),
      Math.cos(angularRadiusRad) - Math.sin(lat1) * Math.sin(lat2)
    );
    
    points.push([
      (lat2 * 180) / Math.PI,
      ((lon2 * 180) / Math.PI),
    ]);
  }
  
  return points;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function GroundTrackMap({
  satellites = [],
  debris = [],
  groundStations = [],
  simTime,
  selectedId,
  onSelect,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  
  // Store historical positions for trailing paths
  const trailsRef = useRef<Map<string, Array<[number, number]>>>(new Map());
  const predictionsRef = useRef<Map<string, Array<[number, number]>>>(new Map());

  // ── Update trails and predictions ──
  useEffect(() => {
    const gmst = gmstRadians(simTime);
    const trails = trailsRef.current;
    const predictions = predictionsRef.current;
    
    satellites.forEach(sat => {
      // Get current ground track position
      const [lat, lon] = eciToLatLon(sat.pos[0], sat.pos[1], sat.pos[2], gmst);
      
      // Add to trail (keep last 90 minutes ≈ 540 points at 10s intervals)
      if (!trails.has(sat.id)) trails.set(sat.id, []);
      const trail = trails.get(sat.id)!;
      trail.push([lat, lon]);
      if (trail.length > 540) trail.shift();
      
      // Simple prediction: extrapolate velocity for next 90 minutes
      // In reality, would use full orbital propagation
      if (!predictions.has(sat.id)) predictions.set(sat.id, []);
      const pred = predictions.get(sat.id)!;
      
      // Orbital period ≈ 90 minutes for LEO
      // Predict next 90 minutes by advancing mean anomaly
      const orbitalPeriod = 5400; // seconds
      const timeStep = 10; // seconds
      const numSteps = 540; // 90 minutes
      
      pred.length = 0;
      for (let i = 0; i < numSteps; i++) {
        const futureTime = new Date(new Date(simTime).getTime() + i * timeStep * 1000);
        const futureGmst = gmstRadians(futureTime.toISOString());
        
        // Simple circular orbit assumption for prediction
        // In production, would use actual orbital elements
        const meanMotion = (2 * Math.PI) / orbitalPeriod;
        const phase = (i * timeStep * meanMotion) % (2 * Math.PI);
        
        // Rotate position by phase
        const r = Math.sqrt(sat.pos[0] ** 2 + sat.pos[1] ** 2 + sat.pos[2] ** 2);
        const inc = Math.acos(sat.pos[2] / r);
        const raan = Math.atan2(sat.pos[1], sat.pos[0]);
        
        const x = r * (Math.cos(raan) * Math.cos(phase) - Math.sin(raan) * Math.sin(phase) * Math.cos(inc));
        const y = r * (Math.sin(raan) * Math.cos(phase) + Math.cos(raan) * Math.sin(phase) * Math.cos(inc));
        const z = r * Math.sin(phase) * Math.sin(inc);
        
        const [predLat, predLon] = eciToLatLon(x, y, z, futureGmst);
        pred.push([predLat, predLon]);
      }
    });
  }, [satellites, simTime]);

  // ── Render canvas ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    const gmst = gmstRadians(simTime);
    
    // Clear canvas
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, width, height);
    
    // ── Draw base map ──
    ctx.strokeStyle = '#1a2a4a';
    ctx.lineWidth = 0.5;
    
    // Latitude lines
    for (let lat = -90; lat <= 90; lat += 15) {
      const points: Array<[number, number]> = [];
      for (let lon = -180; lon <= 180; lon += 5) {
        points.push(mercatorProject(lat, lon, width, height));
      }
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.stroke();
    }
    
    // Longitude lines
    for (let lon = -180; lon < 180; lon += 15) {
      const points: Array<[number, number]> = [];
      for (let lat = -85; lat <= 85; lat += 5) {
        points.push(mercatorProject(lat, lon, width, height));
      }
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.stroke();
    }
    
    // ── Draw terminator line (day/night boundary) ──
    const terminatorPoints = calculateTerminator(gmst);
    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    const term0 = mercatorProject(terminatorPoints[0][0], terminatorPoints[0][1], width, height);
    ctx.moveTo(term0[0], term0[1]);
    for (let i = 1; i < terminatorPoints.length; i++) {
      const pt = mercatorProject(terminatorPoints[i][0], terminatorPoints[i][1], width, height);
      ctx.lineTo(pt[0], pt[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    
    // ── Draw ground stations + LOS cones ──
    groundStations.forEach(station => {
      // LOS cone
      const losCone = calculateLOSCone(station.lat, station.lon);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      const los0 = mercatorProject(losCone[0][0], losCone[0][1], width, height);
      ctx.moveTo(los0[0], los0[1]);
      for (let i = 1; i < losCone.length; i++) {
        const pt = mercatorProject(losCone[i][0], losCone[i][1], width, height);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      
      // Station marker
      const [stX, stY] = mercatorProject(station.lat, station.lon, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(stX - 3, stY - 3, 6, 6);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1;
      ctx.strokeRect(stX - 5, stY - 5, 10, 10);
    });
    
    // ── Draw debris field (sparse sampling for performance) ──
    ctx.fillStyle = '#ffd700';
    ctx.globalAlpha = 0.3;
    const debrisStep = Math.max(1, Math.floor(debris.length / 500)); // Sample ~500 debris
    for (let i = 0; i < debris.length; i += debrisStep) {
      const d = debris[i];
      const [lat, lon] = eciToLatLon(d.x, d.y, d.z, gmst);
      const [px, py] = mercatorProject(lat, lon, width, height);
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
    ctx.globalAlpha = 1.0;
    
    // ── Draw satellites ──
    satellites.forEach(sat => {
      const [lat, lon] = eciToLatLon(sat.pos[0], sat.pos[1], sat.pos[2], gmst);
      const [px, py] = mercatorProject(lat, lon, width, height);
      
      // Historical trail (90 minutes)
      const trail = trailsRef.current.get(sat.id);
      if (trail && trail.length > 1) {
        ctx.strokeStyle = sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#00d4ff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        const t0 = mercatorProject(trail[0][0], trail[0][1], width, height);
        ctx.moveTo(t0[0], t0[1]);
        for (let i = 1; i < trail.length; i++) {
          const pt = mercatorProject(trail[i][0], trail[i][1], width, height);
          ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }
      
      // Predicted trajectory (dashed, next 90 minutes)
      const pred = predictionsRef.current.get(sat.id);
      if (pred && pred.length > 1) {
        ctx.strokeStyle = sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#00d4ff';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        const p0 = mercatorProject(pred[0][0], pred[0][1], width, height);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < pred.length; i++) {
          const pt = mercatorProject(pred[i][0], pred[i][1], width, height);
          ctx.lineTo(pt[0], pt[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;
      }
      
      // Current position marker
      const statusColor = sat.status === 'critical' ? '#ff3b3b' : sat.status === 'warning' ? '#ffb800' : '#00d4ff';
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, 2 * Math.PI);
      ctx.fill();
      
      // Selection highlight
      if (sat.id === selectedId) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, 2 * Math.PI);
        ctx.stroke();
      }
      
      // Hover highlight
      if (sat.id === hoveredId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
    
    // ── Draw legend ──
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.globalAlpha = 0.7;
    ctx.fillText('Ground Track Map (Mercator Projection)', 10, 20);
    ctx.fillText(`Satellites: ${satellites.length} | Debris: ${debris.length} | Time: ${new Date(simTime).toISOString()}`, 10, 35);
    ctx.globalAlpha = 1.0;
  }, [satellites, debris, groundStations, simTime, selectedId, hoveredId]);

  // ── Mouse interaction ──
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if click is near any satellite
    const gmst = gmstRadians(simTime);
    for (const sat of satellites) {
      const [lat, lon] = eciToLatLon(sat.pos[0], sat.pos[1], sat.pos[2], gmst);
      const [px, py] = mercatorProject(lat, lon, canvas.width, canvas.height);
      
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < 8) {
        onSelect(sat.id);
        return;
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check if mouse is near any satellite
    const gmst = gmstRadians(simTime);
    for (const sat of satellites) {
      const [lat, lon] = eciToLatLon(sat.pos[0], sat.pos[1], sat.pos[2], gmst);
      const [px, py] = mercatorProject(lat, lon, canvas.width, canvas.height);
      
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
      if (dist < 8) {
        setHoveredId(sat.id);
        canvas.style.cursor = 'pointer';
        return;
      }
    }
    
    setHoveredId(null);
    canvas.style.cursor = 'default';
  };

  return (
    <div className="ground-track-map" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <canvas
        ref={canvasRef}
        width={1200}
        height={600}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        style={{
          flex: 1,
          border: '1px solid #1a2a4a',
          backgroundColor: '#0a0e27',
          cursor: 'crosshair',
        }}
      />
      <div style={{ padding: '10px', backgroundColor: '#0a0e27', color: '#00d4ff', fontSize: '12px', fontFamily: 'monospace' }}>
        <div>● Cyan: Nominal | ● Amber: Warning | ● Red: Critical | ◆ Gold: Debris | ─ Orange: Terminator (Day/Night)</div>
        <div>Green circles: Ground station LOS cones | Solid line: Historical trail (90 min) | Dashed line: Predicted trajectory (90 min)</div>
      </div>
    </div>
  );
}
