# 🚀 ACM - Autonomous Constellation Manager
## Deployment Guide for National Space Hackathon 2026

**Complete guide to deploy your debris detection & collision avoidance system**

---

## 📋 What You're Submitting

1. **GitHub Repo**: https://github.com/Yashvi2874/acm (make PUBLIC)
2. **Docker Environment**: `docker-compose.yml` at root ✅
3. **Live Application**: One URL from Render
4. **Technical Report**: PDF with algorithms & architecture
5. **Video Demo**: < 5 minutes showcasing functionality

---

## ⚡ Quick Deploy to Render (17 minutes)

### Prerequisites
- GitHub account
- Render.com account (sign up with GitHub)
- Your repo renamed to `acm` ✅

---

### Step 1: Deploy Go Telemetry Service (5 minutes)

1. **Go to https://render.com**
2. **Sign up with GitHub** (authorize access to repos)
3. **Dashboard → New + → Web Service**
4. **Connect repository**: Select `Yashvi2874/acm`

**Configuration:**
```
Name: acm-go-adapter
Region: Oregon (us-west-2)
Root Directory: go-adapter
Build Command: docker build -f Dockerfile .
Start Command: ./go-adapter
```

**Environment Variables:**
```
MONGO_URI = mongodb+srv://rajasekharp_db_user:vM4MT9yMtda7dCKj@nsh-test.klojnbb.mongodb.net/?appName=NSH-Test
PORT = 8080
MODE = demo
```

**Instance Size:** Free tier

**Click "Create Web Service"** → Wait ~3-5 minutes

✅ **Copy URL when ready**: `https://acm-go-adapter.onrender.com`

---

### Step 2: Deploy Python Physics Backend (5 minutes)

1. **Dashboard → New + → Web Service**
2. **Same repository**: `Yashvi2874/acm`

**Configuration:**
```
Name: acm-backend
Region: Oregon (us-west-2) ← Same as above
Root Directory: backend
Build Command: docker build -f Dockerfile .
Start Command: uvicorn main:app --host 0.0.0.0 --port 8000
```

**Environment Variables:**
```
GO_ADAPTER_URL = https://acm-go-adapter.onrender.com
← Paste YOUR actual URL from Step 1
```

**Instance Size:** Free tier

**Click "Create Web Service"** → Wait ~3-5 minutes

✅ **Copy URL when ready**: `https://acm-backend.onrender.com`

---

### Step 3: Deploy Frontend - YOUR SUBMISSION LINK (5 minutes)

1. **Dashboard → New + → Web Service**
2. **Same repository**: `Yashvi2874/acm`

**Configuration:**
```
Name: acm-frontend
Region: Oregon (us-west-2) ← Same as above
Root Directory: frontend
Build Command: docker build -f Dockerfile .
Start Command: nginx -g "daemon off;"
```

**Environment Variables:**
```
VITE_API_URL = https://acm-backend.onrender.com
← Paste YOUR actual URL from Step 2
```

**Instance Size:** Free tier

**Click "Create Web Service"** → Wait ~3-5 minutes

🎯 **THIS IS YOUR HACKATHON SUBMISSION URL!**

✅ **Final URL**: `https://acm-frontend.onrender.com`

---

## 🎯 Submit These Links

```
🏠 Live Application:
https://acm-frontend.onrender.com

💾 GitHub Repository:
https://github.com/Yashvi2874/acm

🔧 Backend API (for judges):
https://acm-backend.onrender.com/docs

⚙️ Telemetry Service:
https://acm-go-adapter.onrender.com/health
```

---

## 🔄 Auto-Deploy on Git Push

Render automatically rebuilds when you push to GitHub:

```powershell
git add .
git commit -m "Improved collision detection"
git push origin main
```

↓ Render detects the push ↓

```
Building... (2-3 minutes)
Deploying...
✅ Live at https://acm-frontend.onrender.com
```

**No manual intervention needed!**

---

## 🧪 Test Locally Before Deploying

```powershell
docker compose up --build
```

Access at: **http://localhost:3000**

If it works locally → It will work on Render!

---

## 📊 System Architecture

```
┌─────────────────┐
│   User Browser  │
│   Port 80/443   │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│  React Frontend │ ← Three.js 3D Globe
│  (acm-frontend) │    Satellite Visualization
└────────┬────────┘
         │ REST API
         ▼
┌─────────────────┐
│ FastAPI Backend │ ← SGP4/SDP4 Propagators
│  (acm-backend)  │    Conjunction Analysis
└────────┬────────┘
         │ Telemetry Stream
         ▼
┌─────────────────┐
│ Go Adapter      │ ← High-performance Ingestion
│ (acm-go-adapter)│   Buffered Worker Pool
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ MongoDB Atlas   │ ← Cloud Database
│  (Shared Tier) │   Telemetry Storage
└─────────────────┘
```

---

## 🎬 Video Demo Script (Under 5 Minutes)

### Recommended Structure:

**0:00 - Introduction (30 seconds)**
> "Hi, I'm [Your Name]. Welcome to ACM - Autonomous Constellation Manager, a real-time space debris tracking and collision avoidance system built for the National Space Hackathon 2026."

**0:30 - Problem Statement (30 seconds)**
> "With thousands of trackable objects in orbit, satellite operators need efficient tools to monitor and prevent catastrophic collisions. ACM provides automated constellation management with physics-accurate predictions."

**1:00 - Live Demo - Globe View (1 minute)**
> [Show deployed app at acm-frontend.onrender.com]
> "Our platform features an interactive 3D globe built with Three.js, showing real-time positions of satellites and debris. Users can rotate, zoom, and explore orbital patterns."

**2:00 - Satellite Tracking (1 minute)**
> [Click on individual satellites]
> "Each satellite displays detailed telemetry: position, velocity, orbital elements, and ground track predictions. All calculations use industry-standard SGP4/SDP4 propagators."

**3:00 - Collision Avoidance (1 minute)**
> [Show maneuver simulation]
> "ACM automatically detects potential conjunctions and suggests avoidance maneuvers. Our physics engine calculates optimal delta-V requirements and new orbital parameters."

**4:00 - Technical Stack (30 seconds)**
> "Built with React and TypeScript for the frontend, FastAPI for the physics backend, and Golang for high-performance telemetry ingestion. Deployed on Render with automatic CI/CD."

**4:30 - Impact & Conclusion (30 seconds)**
> "ACM makes space operations safer through autonomous monitoring and predictive analytics. Thank you!"

### Recording Tools:
- **OBS Studio** (free, professional quality)
- **Loom** (browser-based, easy sharing)
- **Zoom** (record screen, export video)

---

## 📄 Technical Report Outline

Create a PDF (LaTeX preferred) with these sections:

### 1. Introduction
- Space debris challenge
- Need for autonomous constellation management
- Project objectives

### 2. System Architecture
- Three-tier microservices design
- Data flow diagram
- Technology stack justification

### 3. Numerical Methods & Algorithms

#### 3.1 Orbital Propagation
- **SGP4/SDP4 Models**: Simplified General Perturbations
- Implementation details
- Accuracy considerations

#### 3.2 Coordinate Transformations
- ECI (Earth-Centered Inertial) ↔ ECEF (Earth-Centered, Earth-Fixed)
- Topocentric coordinates for ground stations
- Transformation matrices

#### 3.3 Conjunction Assessment
- Close approach detection algorithms
- Probability of collision calculations
- Time-step optimization

#### 3.4 Maneuver Planning
- Lambert's problem solver
- Delta-V optimization
- Hohmann transfer calculations

### 4. Spatial Optimization Algorithms

#### 4.1 Real-Time Rendering
- Three.js instancing for multiple satellites
- Level-of-detail (LOD) management
- 60 FPS optimization techniques

#### 4.2 Telemetry Processing
- Buffered channel architecture (10,000 capacity)
- Worker pool pattern (32 concurrent workers)
- Memory-efficient data structures

#### 4.3 Database Queries
- MongoDB indexing strategies
- Geospatial queries for ground tracks
- Time-series optimization

### 5. Implementation Details

#### 5.1 Frontend
- React 19 with TypeScript
- Three.js for 3D visualization
- State management
- Component architecture

#### 5.2 Backend Services
- Python FastAPI with async endpoints
- NumPy/SciPy for numerical computations
- Astropy for astronomical calculations

#### 5.3 Telemetry Ingestion
- Golang concurrency model
- HTTP streaming
- Error handling & recovery

#### 5.4 Database Layer
- MongoDB Atlas schema design
- Data retention policies
- Backup strategies

### 6. Deployment & DevOps

#### 6.1 Containerization
- Docker multi-stage builds
- Image optimization
- Environment separation

#### 6.2 Cloud Platform
- Render.com infrastructure
- Auto-scaling configuration
- Health checks & monitoring

#### 6.3 CI/CD Pipeline
- GitHub-triggered deployments
- Automated testing
- Rollback mechanisms

### 7. Results & Performance

#### 7.1 Metrics
- Propagation accuracy vs TLE data
- Rendering performance (FPS)
- API response times
- Database query performance

#### 7.2 Scalability
- Concurrent users supported
- Telemetry throughput
- Memory usage patterns

#### 7.3 Live Demo
- Link: https://acm-frontend.onrender.com
- Screenshots of key features

### 8. Future Enhancements
- Machine learning for trajectory prediction
- Multi-satellite coordination
- Integration with real-world APIs
- Enhanced visualization modes

### 9. Conclusion
- Summary of achievements
- Impact on space sustainability
- Lessons learned

### 10. References
- NASA orbital mechanics resources
- ESA debris catalogs
- Academic papers on SGP4
- Library documentation

---

## ✅ Pre-Submission Checklist

### GitHub Repository
- [ ] Repo name changed to `acm` ✅
- [ ] Repository set to **PUBLIC**
- [ ] README.md updated with new name
- [ ] `docker-compose.yml` at root
- [ ] Clean commit history
- [ ] No sensitive data exposed

### Deployment
- [ ] All 3 services deployed on Render
- [ ] Frontend accessible: https://acm-frontend.onrender.com
- [ ] Backend API docs working: https://acm-backend.onrender.com/docs
- [ ] No console errors in browser
- [ ] Auto-deploy tested (push small change)

### Documentation
- [ ] Technical Report PDF created
- [ ] Follows outline above
- [ ] Includes architecture diagram
- [ ] Explains numerical methods
- [ ] Shows performance results

### Video Demo
- [ ] Recorded (< 5 minutes)
- [ ] Shows live application
- [ ] Explains key features
- [ ] Mentions tech stack
- [ ] Clear audio & video

### Submission Form
- [ ] GitHub URL: https://github.com/Yashvi2874/acm
- [ ] Live Demo URL: https://acm-frontend.onrender.com
- [ ] Technical Report uploaded
- [ ] Video Demo uploaded (or YouTube link)
- [ ] Team information complete
- [ ] Category selected

---

## 🆘 Troubleshooting

### Build Fails on Render
**Check:**
- Build logs in Render dashboard
- Dockerfile paths are correct
- All dependencies listed in requirements.txt/package.json

### Services Won't Connect
**Solutions:**
- Wait 5 minutes after deployment (cold start)
- Verify environment variables use HTTPS URLs
- Check that URLs are copied exactly (no typos)

### Slow Initial Load
**Cause:** Free tier services sleep after 15 min inactivity  
**Fix:** Use UptimeRobot (free) to ping every 5 minutes:
```
https://acm-frontend.onrender.com
```

### App Shows But No Data
**Check:**
- Browser DevTools (F12) → Console for errors
- Network tab for failed API calls
- Backend service is running
- Go adapter health endpoint: `/health`

### Can't Access Render Dashboard
**Try:**
- Different browser
- Incognito/private mode
- Clear cache & cookies

---

## 💰 Cost Breakdown

**Render Free Tier:**
- 3 web services × 512MB RAM = FREE
- 750 instance hours/month included
- Bandwidth up to limit = FREE
- SSL certificates = FREE

**Total Monthly Cost: $0** ✅

---

## 🎯 Post-Deployment Enhancements

### Optional Improvements:

1. **Custom Domain** (looks professional)
   - Buy domain from Namecheap (~$10/year)
   - Connect to Render in Settings → Custom Domains
   - Update submission with new URL

2. **Add Authentication**
   - Simple login page
   - Protects from random users
   - Shows security awareness

3. **Performance Monitoring**
   - Add Sentry.io (free tier)
   - Track errors & performance
   - Include metrics in report

4. **Enhanced Features**
   - More satellite catalogs
   - Additional visualization modes
   - Advanced maneuver options

**But first: GET THAT SUBMISSION IN!** ⚡

---

## 📞 Support Resources

- **Render Documentation**: https://render.com/docs
- **Render Community**: https://discord.gg/render
- **Three.js Docs**: https://threejs.org/docs
- **FastAPI Docs**: https://fastapi.tiangolo.com
- **MongoDB University**: Free courses

---

## 🏆 What Makes ACM Special

Highlight these in your submission:

✅ **Real-Time Processing**: Live telemetry ingestion & visualization  
✅ **Physics-Accurate**: Industry-standard SGP4/SDP4 models  
✅ **Autonomous Detection**: Automated conjunction analysis  
✅ **Scalable Architecture**: Microservices with independent scaling  
✅ **Modern Stack**: React, FastAPI, Golang, MongoDB  
✅ **Production-Ready**: Docker, auto-deploy, monitoring  
✅ **Educational Value**: Clear documentation & open source  

---

## 🎊 Final Steps

### Right Now:
1. ✅ Read this guide completely
2. ⏱️ Set aside 17 minutes for deployment
3. 🚀 Go to https://render.com
4. 📝 Follow Step 1, 2, 3 sequentially
5. 🎯 Get your submission URL
6. 📹 Record video demo
7. 📄 Write technical report
8. ✍️ Submit to hackathon!

### Timeline:
```
Deploy to Render:     17 minutes
Make repo public:      1 minute
Record video:         10 minutes
Write report:         30 minutes
Submit form:           5 minutes
───────────────────────────────
TOTAL:               ~63 minutes
```

---

## 🌟 You're Ready!

Your ACM system is powerful and well-designed. Now it's time to share it with the world!

**Key URLs to remember:**
```
🏠 Frontend:  https://acm-frontend.onrender.com
🔧 Backend:   https://acm-backend.onrender.com
⚙️ Telemetry: https://acm-go-adapter.onrender.com
💾 GitHub:    https://github.com/Yashvi2874/acm
```

**Auto-deploy means:**
```
git push origin main → Automatic rebuild → Live in 3 minutes
```

---

## 🚀 START DEPLOYMENT NOW!

**Open https://render.com and follow Steps 1-3 above.**

You'll have your live submission link in 17 minutes!

**Good luck with National Space Hackathon 2026!** 🍀🌟🛰️

---

*ACM - Autonomous Constellation Manager*  
*Making space operations safer through intelligent automation*
