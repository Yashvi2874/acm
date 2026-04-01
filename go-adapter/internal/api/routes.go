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
}
