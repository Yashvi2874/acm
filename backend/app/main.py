from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import telemetry, maneuver, simulate, visualization

app = FastAPI(title="CubeSat Mission Control API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(maneuver.router, prefix="/api/maneuver", tags=["maneuver"])
app.include_router(simulate.router, prefix="/api/simulate", tags=["simulate"])
app.include_router(visualization.router, prefix="/api/visualization", tags=["visualization"])


@app.get("/health")
def health():
    return {"status": "ok"}
