package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"telemetry_ingestion/internal/api"
	"telemetry_ingestion/internal/config"
	"telemetry_ingestion/internal/repository"
	"telemetry_ingestion/internal/service"
	"telemetry_ingestion/internal/simulator"

	"github.com/gin-gonic/gin"
)

func main() {
	cfg, err := config.LoadConfig("admin_config.yaml")
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	mongoURI := cfg.MongoURI
	dbName := cfg.Database
	collectionName := cfg.Collection
	port := cfg.Port
	bufferSize := cfg.BufferSize
	workerCount := cfg.WorkerCount

	if bufferSize <= 0 {
		bufferSize = 10000
	}
	if workerCount <= 0 {
		workerCount = 32
	}

	mode := strings.ToLower(strings.TrimSpace(cfg.Mode))
	if mode != "demo" && mode != "actual" {
		mode = "actual"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	repo, err := repository.NewMongoRepository(ctx, mongoURI, dbName, collectionName)
	if err != nil {
		log.Fatalf("failed to connect to mongo: %v", err)
	}
	defer func() {
		if err := repo.Disconnect(context.Background()); err != nil {
			log.Printf("failed to disconnect mongo: %v", err)
		}
	}()

	processor := service.NewTelemetryProcessor(repo, bufferSize, workerCount)
	processor.Start()
	defer processor.Stop()

	if mode == "demo" {
		log.Printf("Running in DEMO mode: generating simulated telemetry updates")
		simulator.StartDemo(ctx, processor, 1*time.Second)
	} else {
		log.Printf("Running in ACTUAL mode: exposing API on port %s", port)
	}

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	router.GET("/health/db", func(c *gin.Context) {
		prefix := mongoURI
		if len(prefix) > 40 {
			prefix = prefix[:40] + "..."
		}
		c.JSON(200, gin.H{"status": "ok", "mongo": "connected", "uri_prefix": prefix})
	})

	api.RegisterTelemetryRoutes(router, processor)

	srvErrChan := make(chan error, 1)
	go func() {
		srvErrChan <- router.Run(":" + port)
	}()

	log.Printf("Telemetry ingestion API is running on port %s", port)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-srvErrChan:
		log.Fatalf("server error: %v", err)
	case sig := <-stop:
		log.Printf("received signal %s, shutting down", sig)
	}
}
