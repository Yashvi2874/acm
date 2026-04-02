package simulator

import (
	"context"
	"log"
	"math"
	"math/rand"
	"time"

	"telemetry_ingestion/internal/repository"
	"telemetry_ingestion/internal/service"
)

const earthMu = 398600.4418 // km^3/s^2

type demoBody struct {
	ID          string
	Type        string
	RadiusKm    float64
	Inclination float64
	Phase       float64
	PhaseRate   float64
	FuelKg      float64
	MassKg      float64
}

var demoBodies = []demoBody{
	{ID: "SAT-001", Type: "SATELLITE", RadiusKm: 6810, Inclination: 0.30, Phase: 0.10, PhaseRate: 0.00114, FuelKg: 0.42, MassKg: 4.8},
	{ID: "SAT-002", Type: "SATELLITE", RadiusKm: 6960, Inclination: 0.82, Phase: 1.80, PhaseRate: 0.00106, FuelKg: 0.37, MassKg: 4.6},
	{ID: "SAT-003", Type: "SATELLITE", RadiusKm: 7140, Inclination: 1.18, Phase: 3.00, PhaseRate: 0.00098, FuelKg: 0.29, MassKg: 4.9},
	{ID: "DEB-001", Type: "DEBRIS", RadiusKm: 6875, Inclination: 0.55, Phase: 2.20, PhaseRate: 0.00131},
	{ID: "DEB-002", Type: "DEBRIS", RadiusKm: 7050, Inclination: 1.05, Phase: 4.00, PhaseRate: 0.00111},
	{ID: "DEB-003", Type: "DEBRIS", RadiusKm: 7330, Inclination: 0.22, Phase: 5.40, PhaseRate: 0.00092},
}

func bodyState(body demoBody, t time.Time) (repository.Vec3, repository.Vec3) {
	phase := body.Phase + body.PhaseRate*float64(t.Unix())
	cosPhase := math.Cos(phase)
	sinPhase := math.Sin(phase)
	cosInc := math.Cos(body.Inclination)
	sinInc := math.Sin(body.Inclination)
	orbitalSpeed := math.Sqrt(earthMu / body.RadiusKm)

	position := repository.Vec3{
		X: body.RadiusKm * cosPhase * cosInc,
		Y: body.RadiusKm * sinPhase,
		Z: body.RadiusKm * cosPhase * sinInc,
	}
	velocity := repository.Vec3{
		X: orbitalSpeed * (-sinPhase * cosInc),
		Y: orbitalSpeed * cosPhase,
		Z: orbitalSpeed * (-sinPhase * sinInc),
	}
	return position, velocity
}

func statusForBody(body demoBody) string {
	if body.Type != "SATELLITE" {
		return ""
	}
	switch {
	case body.FuelKg < 0.2:
		return "critical"
	case rand.Float64() < 0.15:
		return "warning"
	default:
		return "nominal"
	}
}

func StartDemo(ctx context.Context, p *service.TelemetryProcessor, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				now := time.Now().UTC()
				for _, body := range demoBodies {
					pos, vel := bodyState(body, now)
					status := statusForBody(body)

					p.EnqueueObject(repository.SpaceObject{
						ID:        body.ID,
						Type:      body.Type,
						R:         pos,
						V:         vel,
						Status:    status,
						FuelKg:    body.FuelKg + rand.Float64()*0.03,
						MassKg:    body.MassKg,
						UpdatedAt: now,
					})

					p.Enqueue(repository.TelemetryRecord{
						SatelliteID: body.ID,
						Timestamp:   now,
						Data: map[string]interface{}{
							"type":          body.Type,
							"altitude_km":   body.RadiusKm - 6378.137 + rand.Float64()*6,
							"velocity_ms":   math.Sqrt(earthMu/body.RadiusKm)*1000 + rand.Float64()*25,
							"battery_pct":   60.0 + rand.Float64()*40,
							"temperature_c": -20.0 + rand.Float64()*60,
							"r":             pos,
							"v":             vel,
						},
					})
				}
				log.Printf("demo: upserted %d objects and logged telemetry", len(demoBodies))
			case <-ctx.Done():
				return
			}
		}
	}()
}
