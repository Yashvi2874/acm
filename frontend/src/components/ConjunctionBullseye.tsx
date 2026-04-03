/**
 * Conjunction "Bullseye" Plot - Polar Chart Visualization
 * 
 * Relative proximity view of debris approaching a selected satellite.
 * 
 * Layout:
 * - Center: Selected satellite (origin)
 * - Radial Distance: Time to Closest Approach (TCA) in minutes
 * - Angle: Relative approach vector (bearing)
 * - Color: Risk level (Green/Yellow/Red based on miss distance & collision probability)
 * 
 * Optimized for real-time updates at 60 FPS
 */

import React, { useEffect, useRef, useMemo } from 'react';
import type { Satellite, CdmWarning } from '../types';

interface Props {
  selectedSatellite: Satellite | null;
  allSatellites: Satellite[];
  cdmWarnings: CdmWarning[];
  simTime: string;
}

// ============================================================================
// POLAR COORDINATE UTILITIES
// ============================================================================

/**
 * Convert Cartesian to polar coordinates
 */
function cartesianToPolar(x: number, y: number, z: number): { r: number; theta: number; phi: number } {
  const r = Math.sqrt(x * x + y * y + z * z);
  const theta = Math.atan2(y, x); // azimuth
  const phi = Math.acos(z / r); // elevation
  return { r, theta, phi };
}

/**
 * Calculate relative position of debris with respect to satellite
 */
function getRelativePosition(
  satPos: [number, number, number],
  debPos: [number, number, number]
): [number, number, number] {
  return [
    debPos[0] - satPos[0],
    debPos[1] - satPos[1],
    debPos[2] - satPos[2],
  ];
}

/**
 * Get risk color based on miss distance and collision probability
 */
function getRiskColor(missDistanceKm: number, collisionProb: number): string {
  if (missDistanceKm < 0.001) return '#ff0000'; // Red: < 1 meter (collision)
  if (missDistanceKm < 0.001 || collisionProb > 0.01) return '#ff3b3b'; // Red: < 1 km or > 1% prob
  if (missDistanceKm < 0.005 || collisionProb > 0.001) return '#ffb800'; // Yellow: < 5 km or > 0.1% prob
  return '#00d4ff'; // Cyan: Safe
}

/**
 * Get risk level text
 */
function getRiskLevel(missDistanceKm: number): string {
  if (missDistanceKm < 0.001) return 'CRITICAL';
  if (missDistanceKm < 0.005) return 'WARNING';
  return 'SAFE';
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ConjunctionBullseye({
  selectedSatellite,
  allSatellites,
  cdmWarnings,
  simTime,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Calculate debris positions relative to selected satellite
  const debrisData = useMemo(() => {
    if (!selectedSatellite) return [];

    return cdmWarnings
      .filter(w => w.object_1_id === selectedSatellite.id || w.object_2_id === selectedSatellite.id)
      .map(cdm => {
        const otherId = cdm.object_1_id === selectedSatellite.id ? cdm.object_2_id : cdm.object_1_id;
        const otherSat = allSatellites.find(s => s.id === otherId);

        if (!otherSat) return null;

        // Relative position
        const relPos = getRelativePosition(selectedSatellite.pos, otherSat.pos);
        const polar = cartesianToPolar(relPos[0], relPos[1], relPos[2]);

        // Time to closest approach (in minutes)
        const tcaTime = new Date(cdm.tca).getTime();
        const nowTime = new Date(simTime).getTime();
        const tcaMinutes = Math.max(0, (tcaTime - nowTime) / 60000);

        return {
          id: otherId,
          missDistanceKm: cdm.miss_distance_km,
          collisionProb: cdm.probability_of_collision,
          tcaMinutes,
          r: polar.r,
          theta: polar.theta,
          phi: polar.phi,
          riskColor: getRiskColor(cdm.miss_distance_km, cdm.probability_of_collision),
          riskLevel: getRiskLevel(cdm.miss_distance_km),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.missDistanceKm - b.missDistanceKm);
  }, [selectedSatellite, allSatellites, cdmWarnings, simTime]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedSatellite) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(width, height) / 2 - 40;

    // Clear canvas
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, width, height);

    // ── Draw polar grid ──
    ctx.strokeStyle = '#1a2a4a';
    ctx.lineWidth = 1;

    // Radial circles (TCA in minutes: 0, 10, 20, 30, 40, 50 minutes)
    const maxTCA = 50; // minutes
    for (let tca = 10; tca <= maxTCA; tca += 10) {
      const r = (tca / maxTCA) * maxRadius;
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
      ctx.stroke();

      // Label
      ctx.fillStyle = '#666666';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${tca}m`, centerX, centerY - r - 5);
    }

    // Angular lines (every 30 degrees)
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const x1 = centerX + maxRadius * Math.cos(rad);
      const y1 = centerY + maxRadius * Math.sin(rad);
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Cardinal direction labels
      const labels = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
      const labelIndex = Math.round(angle / 45) % 8;
      const labelX = centerX + (maxRadius + 20) * Math.cos(rad);
      const labelY = centerY + (maxRadius + 20) * Math.sin(rad);
      ctx.fillStyle = '#888888';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[labelIndex], labelX, labelY);
    }

    // ── Draw center point (selected satellite) ──
    ctx.fillStyle = '#00d4ff';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Draw debris markers ──
    debrisData.forEach((debris, index) => {
      // Map TCA to radial distance
      const r = (debris.tcaMinutes / maxTCA) * maxRadius;

      // Convert angle to canvas coordinates (0° = East, 90° = North)
      const angle = debris.theta;
      const x = centerX + r * Math.cos(angle);
      const y = centerY - r * Math.sin(angle); // Flip Y for canvas coordinates

      // Draw debris marker
      ctx.fillStyle = debris.riskColor;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();

      // Draw risk ring
      ctx.strokeStyle = debris.riskColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Draw approach vector (line from center to debris)
      ctx.strokeStyle = debris.riskColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1.0;

      // Label with debris ID and miss distance
      ctx.fillStyle = debris.riskColor;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(debris.id, x, y - 12);
      ctx.fillStyle = '#888888';
      ctx.font = '9px monospace';
      ctx.fillText(`${(debris.missDistanceKm * 1000).toFixed(0)}m`, x, y + 12);
    });

    // ── Draw legend ──
    const legendX = 10;
    const legendY = 10;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Bullseye: ${selectedSatellite.id}`, legendX, legendY);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#888888';
    ctx.fillText(`Debris: ${debrisData.length} | TCA Window: 50 minutes`, legendX, legendY + 18);

    // Risk legend
    const riskLegendY = height - 60;
    ctx.fillStyle = '#ff3b3b';
    ctx.fillText('● Critical (< 1 km)', legendX, riskLegendY);
    ctx.fillStyle = '#ffb800';
    ctx.fillText('● Warning (< 5 km)', legendX, riskLegendY + 16);
    ctx.fillStyle = '#00d4ff';
    ctx.fillText('● Safe (> 5 km)', legendX, riskLegendY + 32);

    // ── Draw info panel ──
    if (debrisData.length > 0) {
      const infoX = width - 200;
      const infoY = 10;
      ctx.fillStyle = '#0f1428';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(infoX - 5, infoY - 5, 195, Math.min(debrisData.length * 18 + 20, 150));
      ctx.globalAlpha = 1.0;

      ctx.fillStyle = '#00d4ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Closest Approaches:', infoX, infoY + 12);

      // Show top 5 closest
      debrisData.slice(0, 5).forEach((debris, i) => {
        ctx.fillStyle = debris.riskColor;
        ctx.font = '10px monospace';
        ctx.fillText(
          `${debris.id}: ${debris.missDistanceKm.toFixed(3)}km @ ${debris.tcaMinutes.toFixed(1)}m`,
          infoX,
          infoY + 28 + i * 16
        );
      });
    }
  }, [selectedSatellite, debrisData]);

  if (!selectedSatellite) {
    return (
      <div style={{ padding: '20px', color: '#888888', textAlign: 'center' }}>
        Select a satellite to view conjunction bullseye plot
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        width={500}
        height={500}
        style={{
          flex: 1,
          border: '1px solid #1a2a4a',
          backgroundColor: '#0a0e27',
          borderRadius: '4px',
        }}
      />
      <div style={{ padding: '10px', fontSize: '11px', color: '#888888', fontFamily: 'monospace' }}>
        <div>Center: Selected satellite | Radial: TCA (minutes) | Angle: Approach vector</div>
        <div>Color: Risk level (Red=Critical, Yellow=Warning, Cyan=Safe)</div>
      </div>
    </div>
  );
}
