#!/bin/bash
# Quick fix: Reset to GitHub version, keep only essential changes

echo "Resetting to GitHub main branch..."
git fetch origin main
git reset --hard origin/main

echo ""
echo "Removing UI filtering from App.tsx..."
# The upstream already has no filtering, so this should be clean
sed -i 's/setSatellites(sats.slice(0, 50));/setSatellites(sats);/g' frontend/src/App.tsx
sed -i 's/setDebris(deb.slice(0, 200));/setDebris(deb);/g' frontend/src/App.tsx

echo ""
echo "Rebuilding Docker containers..."
docker-compose build
docker-compose up -d --force-recreate

echo ""
echo "✅ Done! UI will now display ALL objects from database."
echo "Open http://localhost:3000 to verify."
