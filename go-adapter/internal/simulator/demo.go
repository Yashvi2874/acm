package simulator

import (
	"context"
	"log"
	"math/rand"
	"time"

	"telemetry_ingestion/internal/repository"
	"telemetry_ingestion/internal/service"
)

var demoSatellites = []string{"SAT-001", "SAT-002", "SAT-003"}

func StartDemo(ctx context.Context, p *service.TelemetryProcessor, interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				for _, id := range demoSatellites {
					rec := repository.TelemetryRecord{
						SatelliteID: id,
						Timestamp:   time.Now().UTC(),
						Data: map[string]interface{}{
							"altitude_km":   400.0 + rand.Float64()*10,
							"velocity_ms":   7700.0 + rand.Float64()*50,
							"battery_pct":   60.0 + rand.Float64()*40,
							"temperature_c": -20.0 + rand.Float64()*60,
						},
					}
					p.Enqueue(rec)
				}
				log.Printf("demo: enqueued telemetry for %d satellites", len(demoSatellites))
			case <-ctx.Done():
				return
			}
		}
	}()
}
