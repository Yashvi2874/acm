# 🛰️ ACM - Autonomous Constellation Manager

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

ACM tracks space debris, predicts collisions, and plans avoidance maneuvers using high-performance telemetry processing and RK4+J2 orbital propagation.

---

## ✨ Features

- **Real-Time 3D Visualization**: Interactive Three.js globe with live satellite tracking
- **Physics Simulation**: RK4 integration with J2 perturbations for accurate orbit prediction
- **Collision Detection**: k-d tree O(N log N) conjunction analysis with 100m threshold
- **High-Frequency Telemetry**: Go-based ingestion (10k+ buffered capacity, 32 workers)
- **Autonomous Alerts**: Automated close approach detection and maneuver planning

---

## 🛠️ Technology Stack

**Frontend**: React 19 + TypeScript + Three.js  
**Backend**: Python FastAPI (physics engine) + Golang (telemetry)  
**Database**: MongoDB Atlas  
**Deployment**: Docker + Render (auto-deploy on git push)

---

## 📦 Architecture

```
Frontend (Port 3000) → Backend API (Port 8000) → Go Adapter (Port 8080) → MongoDB Atlas
```

---

## 🧪 Testing

```bash
# Seed database with realistic orbits
docker cp seed_realistic_orbits.py nsh_debris-acm-backend-1:/app/
docker compose exec acm-backend python3 seed_realistic_orbits.py

# Run backend physics tests
cd backend/app/physics/tests
python run_tests.py
```

---

## 📊 Performance

- **Propagation**: RK4+J2 with sub-stepping ≤30s
- **Conjunction Detection**: k-d tree O(N log N) efficiency
- **Telemetry**: 10,000+ objects/second throughput
- **Latency**: <50ms average
- **Scalability**: Handles 50+ satellites, 10,000+ debris

---

## 🎯 Hackathon Compliance

✅ ECI J2000 reference frame  
✅ J2 perturbation: Exact formula (μ=398600.4418, R_E=6378.137, J2=1.08263×10⁻³)  
✅ RK4 numerical integration  
✅ Collision threshold: Exactly 100 meters (0.100 km)  
✅ Real-time database-driven visualization  
✅ High-frequency telemetry capable  

---

## 📁 Project Structure

```
acm/
├── frontend/           # React + Three.js
├── backend/            # FastAPI physics engine
├── go-adapter/         # Go telemetry service
├── docker-compose.yml  # Docker orchestration
└── seed_realistic_orbits.py  # Orbit generator
```

---

## 📄 License

MIT License

---

**Built for National Space Hackathon 2026** 🚀
