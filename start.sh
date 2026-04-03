#!/bin/bash
set -e

echo "Starting ACM - Autonomous Constellation Manager..."

# Start MongoDB in background
echo "Initializing MongoDB..."
mkdir -p /data/db
mongod --dbpath /data/db --bind_ip 0.0.0.0 --port 27017 &
MONGO_PID=$!
sleep 3

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to be ready..."
for i in {1..30}; do
    if mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
        echo "✓ MongoDB is ready"
        break
    fi
    echo "  Waiting for MongoDB... ($i/30)"
    sleep 1
done

# Start Go adapter in background
echo "Starting Go Telemetry Adapter..."
cd /app/go-adapter
./go-adapter &
GO_PID=$!
sleep 2

# Wait for Go adapter to be ready
echo "Waiting for Go adapter to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "✓ Go adapter is ready"
        break
    fi
    echo "  Waiting for Go adapter... ($i/30)"
    sleep 1
done

# Start backend API (foreground)
echo "Starting FastAPI Backend..."
cd /app/backend
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
