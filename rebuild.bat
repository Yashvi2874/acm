@echo off
REM Rebuild and reseed database with orbit diversity fix

setlocal enabledelayedexpansion

echo ================================================
echo REBUILDING SYSTEM WITH ORBIT DIVERSITY FIX
echo ================================================

REM 1. Clean up old containers and volumes
echo [1/5] Cleaning Docker environment...
docker-compose down -v 2>nul || true

REM 2. Rebuild images
echo [2/5] Building Docker images...
docker-compose -f docker-compose.yml build --no-cache
if errorlevel 1 (
    echo Error building Docker images
    exit /b 1
)

REM 3. Start services
echo [3/5] Starting services...
docker-compose up -d
if errorlevel 1 (
    echo Error starting services
    exit /b 1
)

REM 4. Wait for backend to be ready
echo [4/5] Waiting for backend to be healthy...
set max_attempts=30
set attempt=0
:wait_loop
if !attempt! GEQ !max_attempts! (
    echo Timeout waiting for backend
    docker-compose logs backend
    exit /b 1
)

REM Check if backend is healthy
curl -s http://localhost:8000/api/health >nul 2>&1
if errorlevel 1 (
    set /a attempt=!attempt!+1
    echo   Attempt !attempt!/!max_attempts! - waiting for backend...
    timeout /t 2 /nobreak
    goto wait_loop
)
echo ✓ Backend is healthy

REM 5. Seed database with diverse orbits
echo [5/5] Seeding database with orbit diversity...
docker-compose exec -T backend python seed_satellites.py --satellites 50 --debris 10000
if errorlevel 1 (
    echo Error seeding database
    exit /b 1
)

echo.
echo ================================================
echo ✓ DEPLOYMENT COMPLETE
echo ================================================
echo.
echo Frontend:  http://localhost:5173
echo Backend:   http://localhost:8000
echo.
echo Next steps:
echo 1. Open http://localhost:5173 in browser
echo 2. Verify 50 satellites spread across diverse orbits
echo 3. Check that Earth rotates at full GMST rate
echo 4. Test conjunction detection and maneuver planning
echo.
pause
