# Frontend Visualization System

**Interactive 3D/2D Dashboard for Autonomous Constellation Management**

---

## Overview

The ACM frontend provides real-time visualization of satellite constellations, debris fields, and collision avoidance maneuvers. Built with React 19, TypeScript, and Three.js, it renders 50+ satellites and 10,000+ debris objects at 60 FPS.

---

## Core Components

### 1. GlobeScene (3D Visualization)
**File**: `src/components/GlobeScene.tsx`

Interactive 3D globe with:
- **Realistic Earth**: NASA Blue Marble textures with clouds and atmosphere
- **Satellites**: Detailed 3D models with solar panels, antenna, and thruster nozzles
- **Debris**: Low-poly irregular shapes with realistic tumbling
- **Ground Stations**: Marker positions on Earth surface
- **Orbital Trails**: Semi-transparent orbit lines for each satellite
- **Exhaust Effects**: Particle system for thruster burns
- **Terminator Line**: Day/night boundary visualization

**Features**:
- Mouse drag to rotate, scroll to zoom
- Click satellites to select
- Hover for proximity detection
- 40x orbital motion multiplier for realistic visual speed
- Real-time position updates from backend

### 2. GroundTrackMap (2D Mercator Projection)
**File**: `src/components/GroundTrackMap.tsx`

2D world map with:
- **Mercator Projection**: Standard geographic projection
- **Real-time Markers**: Current satellite positions
- **90-Minute Trails**: Historical ground track (solid lines)
- **90-Minute Predictions**: Future trajectory (dashed lines)
- **Terminator Line**: Day/night boundary with GMST calculation
- **Ground Station LOS Cones**: Green circles showing line-of-sight coverage
- **Debris Overlay**: Sparse sampling of debris field

**Features**:
- Canvas-based rendering for performance
- Smooth animation at 60 FPS
- Hover tooltips with satellite details
- Color-coded status (cyan/amber/red)

### 3. ConjunctionBullseye (Polar Chart)
**File**: `src/components/ConjunctionBullseye.tsx`

Relative proximity visualization:
- **Center**: Selected satellite at origin
- **Radial Distance**: Time to Closest Approach (TCA) in minutes
- **Angle**: Relative approach vector (bearing)
- **Color Coding**: Risk levels
  - Green: Safe (>5 km miss distance)
  - Yellow: Warning (1-5 km)
  - Red: Critical (<1 km)

**Features**:
- Top 5 closest approaches info panel
- Real-time conjunction data from backend
- Smooth polar coordinate transformation

### 4. TelemetryHeatmap (Fleet Health)
**File**: `src/components/TelemetryHeatmap.tsx`

Fleet-wide monitoring dashboard:
- **Status Distribution**: Nominal/Warning/Critical/At-Risk counts
- **Fuel Distribution**: Histogram of fuel levels (5 buckets)
- **Individual Fuel Gauges**: Grid view sorted by fuel percentage
- **Efficiency Metrics**: Collisions avoided per fuel unit
- **Conjunction Summary**: Active threats and TCA statistics

**Features**:
- Real-time fleet health metrics
- Fuel efficiency analysis
- Risk assessment visualization

### 5. ManeuverTimeline (Gantt Scheduler)
**File**: `src/components/ManeuverTimeline.tsx`

Chronological burn schedule:
- **Burn Events**: Cyan blocks (~60s duration)
- **Cooldown Periods**: Gray blocks (600s mandatory)
- **Blackout Zones**: Red blocks (no ground station LOS)
- **Conflict Detection**: Overlapping burns highlighted in red with glow
- **Configurable Window**: Default 120 minutes

**Features**:
- Hover tooltips with event details
- Real-time conflict detection
- Automatic scheduling validation

### 6. AnalyticsDashboard (Tabbed Interface)
**File**: `src/components/AnalyticsDashboard.tsx`

Unified dashboard with tabs for:
- Ground Track Map
- Conjunction Bullseye
- Telemetry Heatmap
- Maneuver Timeline
- 3D Globe Scene

**Features**:
- Easy switching between visualizations
- Context preservation (selected satellite maintained)
- Responsive layout

---

## Data Flow

```
Backend API (Port 8000)
    ↓
usePhysicsSimulation Hook
    ↓
State Management (React Context)
    ↓
Component Props
    ↓
Visualization Rendering
```

### usePhysicsSimulation Hook
**File**: `src/usePhysicsSimulation.ts`

Manages:
- Periodic API polling (every 1-2 seconds)
- Satellite position updates
- Debris field updates
- Conjunction data
- Maneuver plan state

---

## Performance Optimization

### Rendering
- **WebGL via Three.js**: GPU-accelerated rendering
- **Canvas for 2D**: Optimized 2D map rendering
- **Instancing**: Efficient debris rendering
- **LOD (Level of Detail)**: Simplified geometry for distant objects

### Data Management
- **Sparse Debris Sampling**: Only render ~1000 of 10,000+ debris
- **Efficient Updates**: Only update changed properties
- **Memoization**: React.memo for expensive components
- **Debouncing**: Throttle hover events

### Results
- **60 FPS** with 50+ satellites + 10,000+ debris
- **<50ms** latency for updates
- **Smooth Animation**: No frame drops during interaction

---

## Visualization Features

### Satellite Status Colors
- **Cyan (0x00d4ff)**: Nominal
- **Amber (0xffb800)**: Warning
- **Red (0xff3b3b)**: Critical

### Interactive Elements
- **Click**: Select satellite for detail panel
- **Hover**: Show proximity information
- **Drag**: Rotate 3D view
- **Scroll**: Zoom in/out
- **Tab**: Switch visualization modules

### Real-time Updates
- Satellite positions update every tick
- Conjunction data refreshes periodically
- Maneuver plans execute in real-time
- Exhaust effects during burns

---

## Configuration

### Constants
**File**: `src/components/GlobeScene.tsx`

```typescript
const SCALE = 1 / 500;                    // Scene scale factor
const EARTH_RADIUS_KM = 6371;             // Earth radius
const EARTH_OMEGA = 7.2921150e-5;         // Earth rotation rate
```

### Orbital Motion
- **40x Multiplier**: Makes orbital motion visible at realistic speed
- **RK4 Integration**: Accurate propagation from backend

### Debris Rendering
- **Sparse Sampling**: ~1000 of 10,000+ debris rendered
- **Random Seed**: Deterministic but varied appearance
- **Tumbling Animation**: Realistic rotation

---

## Browser Compatibility

- **Chrome/Edge**: Full support (WebGL 2.0)
- **Firefox**: Full support
- **Safari**: Full support (WebGL 2.0)
- **Mobile**: Limited support (touch controls not implemented)

---

## Development

### Build
```bash
npm run build
```

### Development Server
```bash
npm run dev
```

### Linting
```bash
npm run lint
```

### Type Checking
```bash
tsc --noEmit
```

---

## Dependencies

- **React 19**: UI framework
- **TypeScript**: Type safety
- **Three.js**: 3D rendering
- **Vite**: Build tool

---

## Future Enhancements

- [ ] Touch controls for mobile
- [ ] VR/AR visualization
- [ ] Custom debris filtering
- [ ] Maneuver simulation preview
- [ ] Historical playback
- [ ] Export visualization as video

---

**Built for National Space Hackathon 2026** 🚀
