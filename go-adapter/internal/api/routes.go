package api

import (
	"net/http"
	"strconv"
	"time"

	"telemetry_ingestion/internal/repository"
	"telemetry_ingestion/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterTelemetryRoutes(r *gin.Engine, p *service.TelemetryProcessor) {
	// ── Existing telemetry endpoints ──────────────────────────────────────
	r.POST("/telemetry/:satellite_id", func(c *gin.Context) {
		satID := c.Param("satellite_id")
		var data map[string]interface{}
		if err := c.ShouldBindJSON(&data); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rec := repository.TelemetryRecord{
			SatelliteID: satID,
			Timestamp:   time.Now().UTC(),
			Data:        data,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"status": "queued", "satellite_id": satID})
	})

	r.GET("/telemetry/:satellite_id", func(c *gin.Context) {
		satID := c.Param("satellite_id")
		rec, err := p.GetLatest(satID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "no telemetry found"})
			return
		}
		c.JSON(http.StatusOK, rec)
	})

	r.GET("/telemetry/:satellite_id/history", func(c *gin.Context) {
		satID := c.Param("satellite_id")
		limit := int64(100)
		if l := c.Query("limit"); l != "" {
			if parsed, err := strconv.ParseInt(l, 10, 64); err == nil {
				limit = parsed
			}
		}
		records, err := p.GetHistory(satID, limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"satellite_id": satID, "records": records})
	})

	// ── Snapshot (bulk telemetry from simulate/step) ──────────────────────
	r.POST("/telemetry/snapshot", func(c *gin.Context) {
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rec := repository.TelemetryRecord{
			SatelliteID: "_snapshot",
			Timestamp:   time.Now().UTC(),
			Data:        body,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"status": "queued"})
	})

	// ── Log endpoints (fire-and-forget from Python) ───────────────────────
	// POST /log/telemetry  body: {timestamp, objects:[]}
	r.POST("/log/telemetry", func(c *gin.Context) {
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rec := repository.TelemetryRecord{
			SatelliteID: "_bulk",
			Timestamp:   time.Now().UTC(),
			Data:        body,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"logged": "telemetry"})
	})

	// POST /log/maneuver  body: {satellite_id, burn_id, deltaV, fuel_remaining, timestamp}
	r.POST("/log/maneuver", func(c *gin.Context) {
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		satID, _ := body["satellite_id"].(string)
		if satID == "" {
			satID = "_maneuver"
		}
		rec := repository.TelemetryRecord{
			SatelliteID: satID,
			Timestamp:   time.Now().UTC(),
			Data:        body,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"logged": "maneuver"})
	})

	// POST /log/cdm  body: {sat_id, deb_id, tca, miss_distance}
	r.POST("/log/cdm", func(c *gin.Context) {
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rec := repository.TelemetryRecord{
			SatelliteID: "_cdm",
			Timestamp:   time.Now().UTC(),
			Data:        body,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"logged": "cdm"})
	})

	// POST /log/collision  body: {sat_id, deb_id, timestamp}
	r.POST("/log/collision", func(c *gin.Context) {
		var body map[string]interface{}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		rec := repository.TelemetryRecord{
			SatelliteID: "_collision",
			Timestamp:   time.Now().UTC(),
			Data:        body,
		}
		p.Enqueue(rec)
		c.JSON(http.StatusAccepted, gin.H{"logged": "collision"})
	})
}
