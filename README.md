# 🛰️ NSH Debris - CubeSat Mission Control System

[![Deploy to Railway](https://railway.app/button.svg)](https://railway.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**🏆 Hackathon Submission Project**

A real-time 3D visualization and physics simulation platform for tracking space debris and managing CubeSat missions.

---

## 🌟 Features

### ✨ Real-Time 3D Visualization
- Interactive globe showing Earth with orbiting satellites
- Live telemetry data display
- Orbital mechanics visualization using Three.js

### 🚀 Physics Simulation Engine
- Accurate orbital propagators (SGP4/SDP4)
- Conjunction analysis for collision avoidance
- Ground station visibility calculations
- Maneuver planning and execution

### 📊 Telemetry Ingestion
- High-performance Go-based telemetry processor
- MongoDB Atlas integration
- Real-time data streaming
- Buffer system for handling high-throughput data

### 🎯 Mission Control
- Satellite constellation management
- Orbit prediction
- Ground track visualization
- Pass predictions for ground stations

---

## 🛠️ Tech Stack

### Frontend
- **React 19** + TypeScript
- **Three.js** for 3D rendering
- **Vite** for fast builds

### Backend Services
- **Python FastAPI** - Physics engine & API
- **Golang** - High-performance telemetry ingestion
- **MongoDB Atlas** - Cloud database

### DevOps
- **Docker** - Containerization
- **Railway** - Cloud deployment
- **GitHub** - CI/CD (auto-deploy on push)

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Python 3.10+
- Go 1.22+
- Docker Desktop

### Local Development

```bash
# Clone the repository
git clone https://github.com/Yashvi2874/NSH_debris.git
cd NSH_debris

# Start all services with Docker
docker compose up --build

# Access at:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# Go Adapter: http://localhost:8080
```

---

## 📦 Deployment

### Deploy to Railway

1. Sign up at [Railway.app](https://railway.app) using GitHub
2. Create new project from this repository
3. Configure three services (see DEPLOY.md)
4. Deploy! Auto-updates on every git push

See [DEPLOY.md](./DEPLOY.md) for detailed deployment instructions.

### Environment Variables

#### Go Adapter
```env
MONGO_URI=your_mongodb_connection_string
PORT=8080
MODE=demo
```

#### ACM Backend
```env
GO_ADAPTER_URL=http://localhost:8080
```

#### Frontend
```env
VITE_API_URL=http://localhost:8000
```

---

## 📐 Architecture

```
┌─────────────┐
│   Frontend  │ ← React + Three.js (Port 80/3000)
│   (React)   │
└──────┬──────┘
       │ API Calls
       ▼
┌─────────────┐
│   Backend   │ ← FastAPI Physics Engine (Port 8000)
│  (FastAPI)  │
└──────┬──────┘
       │ Telemetry Data
       ▼
┌─────────────┐
│Go Adapter   │ ← Golang Ingestion (Port 8080)
│   (Golang)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  MongoDB    │ ← Atlas Cloud Database
│   (Atlas)   │
└─────────────┘
```

---

## 🔬 Physics Engine

### Implemented Models
- **SGP4/SDP4** - Simplified General Perturbations
- **Orbital Elements** - Keplerian to Cartesian conversion
- **Ground Station Visibility** - Elevation/Azimuth calculations
- **Conjunction Assessment** - Close approach detection
- **Atmospheric Drag** - Jacchia-Roberts model

### Coordinate Systems
- ECI (Earth-Centered Inertial)
- ECEF (Earth-Centered, Earth-Fixed)
- Topocentric (Observer-based)

---

## 📁 Project Structure

```
NSH_debris/
├── frontend/              # React + Three.js UI
│   ├── src/
│   │   ├── components/   # React components
│   │   └── types.ts      # TypeScript types
│   └── package.json
├── backend/              # Python FastAPI service
│   ├── app/
│   │   ├── api/         # API routes
│   │   └── physics/     # Physics engine
│   └── requirements.txt
├── go-adapter/          # Go telemetry service
│   └── internal/        # Business logic
└── docker-compose.yml   # Local development
```

---

## 🧪 Testing

### Run Tests
```bash
# Backend tests
cd backend/app/physics/tests
python run_tests.py
```

### API Documentation
Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

MIT License - See LICENSE file for details.

---

## 👥 Built For

NSH Space Hackathon

### Technologies Used
- [React](https://react.dev/)
- [Three.js](https://threejs.org/)
- [FastAPI](https://fastapi.tiangolo.com/)
- [Go](https://golang.org/)
- [MongoDB](https://mongodb.com/)
- [Railway](https://railway.app/)

---

## 🙏 Acknowledgments

- NASA for orbital mechanics resources
- European Space Agency for debris data
- The open-source community

---

## 📞 Support

- **Documentation**: See README.md
- **Issues**: Open a GitHub issue
- **Deployment Guide**: See DEPLOY.md

---

**🚀 Ready for deployment!** Check out [DEPLOY.md](./DEPLOY.md) for deployment instructions.

**Live Demo**: [Deploy on Railway](https://railway.app)
