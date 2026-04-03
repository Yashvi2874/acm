@echo off
REM ============================================================================
EMERGENCY STARTUP SCRIPT - National Space Hackathon 2026
This script starts all services and seeds the database automatically.
============================================================================

echo.
echo ========================================================================
echo   AUTONOMOUS CONSTELLATION MANAGER - EMERGENCY STARTUP
echo ========================================================================
echo.

REM Check if Python is available
where python >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if Go is available
where go >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Go is not installed or not in PATH
    pause
    exit /b 1
)

REM Check if Node.js is available
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH
    pause
    exit /b 1
)

echo [1/5] Checking prerequisites... OK
echo.

REM Start Go Adapter in background
echo [2/5] Starting Go Adapter (MongoDB Interface)...
start "Go Adapter" cmd /k "cd go-adapter && go run main.go"
timeout /t 3 /nobreak >nul
echo       Go adapter starting on port 8080...
echo.

REM Start Python Backend in background
echo [3/5] Starting Python Backend (Physics Engine)...
start "Python Backend" cmd /k "cd backend && python -m uvicorn app.main:app --reload --port 8000"
timeout /t 3 /nobreak >nul
echo       Backend starting on port 8000...
echo.

REM Wait for services to initialize
echo [4/5] Waiting for services to initialize...
timeout /t 8 /nobreak >nul
echo       Services should be ready now.
echo.

REM Seed the database
echo [5/5] Seeding database with satellites and debris...
python emergency_seed.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: Database seeding failed!
    echo Please check that all services are running.
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================================================
echo   ALL SERVICES STARTED SUCCESSFULLY!
echo ========================================================================
echo.
echo Services Running:
echo   • Go Adapter:      http://localhost:8080
echo   • Python Backend:  http://localhost:8000
echo   • API Docs:        http://localhost:8000/docs
echo.
echo Next Steps:
echo   1. Start the frontend:
echo      cd frontend
echo      npm run dev
echo.
echo   2. Open browser to the URL shown by Vite (usually http://localhost:5173)
echo.
echo   3. Verify system:
echo      python verify_system.py
echo.
echo You should see:
echo   ✓ 55 satellites moving on blue orbital paths
echo   ✓ 1200 debris points visible in space
echo   ✓ Smooth animation updating every 2 seconds
echo   ✓ Positions calculated using RK4+J2 physics
echo.
echo GOOD LUCK WITH YOUR SUBMISSION! 🚀
echo ========================================================================
echo.
pause
