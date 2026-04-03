#!/bin/bash
# Rebuild and reseed database with orbit diversity fix

set -e

echo "================================================"
echo "REBUILDING SYSTEM WITH ORBIT DIVERSITY FIX"
echo "================================================"

# 1. Clean up old containers and volumes
echo "[1/5] Cleaning Docker environment..."
docker-compose down -v 2>/dev/null || true

# 2. Rebuild images
echo "[2/5] Building Docker images..."
docker-compose -f docker-compose.yml build --no-cache

# 3. Start services
echo "[3/5] Starting services..."
docker-compose up -d

# 4. Wait for backend to be ready
echo "[4/5] Waiting for backend to be healthy..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if curl -s http://localhost:8000/api/health >/dev/null 2>&1; then
        echo "✓ Backend is healthy"
        break
    fi
    attempt=$((attempt + 1))
    echo "  Attempt $attempt/$max_attempts - waiting for backend..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "✗ Backend failed to start"
    docker-compose logs backend
    exit 1
fi

# 5. Seed database with diverse orbits
echo "[5/5] Seeding database with orbit diversity..."
docker-compose exec -T backend python seed_satellites.py --satellites 50 --debris 10000

echo ""
echo "================================================"
echo "✓ DEPLOYMENT COMPLETE"
echo "================================================"
echo ""
echo "Frontend:  http://localhost:5173"
echo "Backend:   http://localhost:8000"
echo ""
echo "Next steps:"
echo "1. Open http://localhost:5173 in browser"
echo "2. Verify 50 satellites spread across diverse orbits"
echo "3. Check that Earth rotates at full GMST rate"
echo "4. Test conjunction detection and maneuver planning"
echo ""
