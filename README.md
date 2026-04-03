# 🛰️ Autonomous Constellation Manager (ACM)

**Real-time Space Debris Tracking & Collision Avoidance System**

*Built for National Space Hackathon 2026*

---

## 🚀 Quick Start

### Windows Users
Double-click `start.bat` to launch all services. Access at http://localhost:3000

### Manual Start
```bash
docker compose up --build
```

---

## 🌟 Overview

ACM is an autonomous space debris tracking and collision avoidance system designed for the next generation of satellite constellations. It combines high-performance orbital physics simulation with real-time visualization to enable autonomous decision-making in congested Low Earth Orbit (LEO).

**Key Capabilities:**
- Real-time tracking of 50+ active satellites and 10,000+ debris objects
- Predictive conjunction analysis with Time-to-Closest-Approach (TCA) calculation
- Autonomous maneuver planning and execution
- High-frequency telemetry processing (10,000+ objects/second)
- Interactive 3D/2D visualization dashboard

---

## ✨ Features

### Backend Physics Engine
- **RK4 Integration**: 4th-order Runge-Kutta with J2 perturbations for accurate orbital propagation
- **Conjunction Detection**: k-d tree O(N log N) algorithm with 100m collision threshold
- **Maneuver Planning**: Autonomous ∆v optimization for avoidance and recovery burns
- **State Management**: Real-time satellite, debris, and maneuver tracking

### Frontend Visualization
- **3D Globe Scene**: Interactive Three.js visualization with realistic Earth, satellites, and debris
- **Ground Track Map**: Mercator projection with 90-minute trails, predictions, and terminator line
- **Conjunction Bullseye**: Polar chart showing relative proximity of approaching debris
- **Telemetry Heatmaps**: Fleet-wide health monitoring and fuel efficiency analysis
- **Maneuver Timeline**: Gantt scheduler for burn events and cooldown periods
- **Analytics Dashboard**: Tabbed interface for all visualization modules

### Telemetry System
- **Go-based Adapter**: High-throughput buffered ingestion (10k+ capacity, 32 workers)
- **Real-time Updates**: Sub-50ms latency for telemetry processing
- **Database Integration**: MongoDB Atlas for persistent state management

---

## 🛠️ Technology Stack

**Frontend**: React 19 + TypeScript + Three.js (WebGL)  
**Backend**: Python FastAPI (physics engine) + Golang (telemetry adapter)  
**Database**: MongoDB Atlas  
**Deployment**: Docker + Render (auto-deploy on git push)  
**Testing**: pytest (24 verification tests, all passing)

---

## 📦 Architecture

```
Frontend (Port 3000)
    ↓
Backend API (Port 8000) - Physics Engine
    ↓
Go Adapter (Port 8080) - Telemetry Ingestion
    ↓
MongoDB Atlas - Persistent State
```

---

## 🧪 Testing & Verification

### Backend Physics Tests
```bash
cd backend/app/physics/tests
python run_tests.py
```

All 24 verification tests passing:
- ✅ Orbital energy conservation < 0.01% error
- ✅ Orbital stability < 1 km per orbit
- ✅ J2 perturbation accuracy verified
- ✅ Conjunction detection with 100m threshold
- ✅ Maneuver planning and execution

### Seed Database
```bash
docker cp seed_realistic_orbits.py nsh_debris-acm-backend-1:/app/
docker compose exec acm-backend python3 seed_realistic_orbits.py
```

---

## 📊 Performance Metrics

- **Propagation**: RK4+J2 with sub-stepping ≤30s
- **Conjunction Detection**: k-d tree O(N log N) efficiency
- **Telemetry**: 10,000+ objects/second throughput
- **Latency**: <50ms average
- **Rendering**: 60 FPS with 50+ satellites + 10,000+ debris
- **Scalability**: Handles constellations with thousands of satellites

---

## 🎯 Hackathon Compliance

✅ **ECI J2000 Reference Frame**: All calculations in Earth-Centered Inertial coordinates  
✅ **J2 Perturbation**: Exact formula (μ=398600.4418, R_E=6378.137, J2=1.08263×10⁻³)  
✅ **RK4 Integration**: 4th-order Runge-Kutta numerical integration  
✅ **Collision Threshold**: Exactly 100 meters (0.100 km)  
✅ **Real-time Visualization**: Database-driven with live updates  
✅ **High-Frequency Telemetry**: Capable of processing 10,000+ objects/second  
✅ **Autonomous Decision-Making**: Maneuver planning without ground intervention  

---

## 📁 Project Structure

```
acm/
├── frontend/                    # React + Three.js visualization
│   ├── src/components/         # UI components
│   ├── src/assets/             # Textures and resources
│   └── package.json            # Frontend dependencies
├── backend/                     # FastAPI physics engine
│   ├── app/api/                # REST API endpoints
│   ├── app/physics/            # Orbital mechanics
│   ├── app/physics/tests/      # Verification tests
│   └── requirements.txt         # Python dependencies
├── go-adapter/                  # Go telemetry service
├── docker-compose.yml           # Docker orchestration
├── SYSTEM_ARCHITECTURE.md       # Detailed system design
└── README.md                    # This file
```

---

## 📚 Documentation

- **[SYSTEM_ARCHITECTURE.md](./SYSTEM_ARCHITECTURE.md)** - Detailed system design and physics algorithms
- **[SETUP.md](./SETUP.md)** - Installation and configuration guide
- **Frontend Guide** - See `frontend/README.md` for visualization details
- **Backend Guide** - See `backend/requirements.txt` for dependencies

---

## 🚀 Deployment

### Local Development
```bash
docker compose up --build
```

### Production
```bash
docker compose -f docker-compose.prod.yml up --build
```

---

## 📄 License

MIT License

---

**Built for National Space Hackathon 2026** 🚀

*Enabling autonomous constellation management for the future of spaceflight.*
