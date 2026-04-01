package service

import (
	"context"
	"log"
	"sync"
	"time"

	"telemetry_ingestion/internal/repository"
)

type TelemetryProcessor struct {
	repo        *repository.MongoRepository
	buffer      chan repository.TelemetryRecord
	workerCount int
	wg          sync.WaitGroup
	stopCh      chan struct{}
}

func NewTelemetryProcessor(repo *repository.MongoRepository, bufferSize, workerCount int) *TelemetryProcessor {
	return &TelemetryProcessor{
		repo:        repo,
		buffer:      make(chan repository.TelemetryRecord, bufferSize),
		workerCount: workerCount,
		stopCh:      make(chan struct{}),
	}
}

func (p *TelemetryProcessor) Start() {
	for i := 0; i < p.workerCount; i++ {
		p.wg.Add(1)
		go p.worker()
	}
}

func (p *TelemetryProcessor) Stop() {
	close(p.stopCh)
	p.wg.Wait()
}

func (p *TelemetryProcessor) Enqueue(rec repository.TelemetryRecord) {
	select {
	case p.buffer <- rec:
	default:
		log.Printf("telemetry buffer full, dropping record for %s", rec.SatelliteID)
	}
}

func (p *TelemetryProcessor) GetLatest(satelliteID string) (*repository.TelemetryRecord, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return p.repo.FindLatest(ctx, satelliteID)
}

func (p *TelemetryProcessor) GetHistory(satelliteID string, limit int64) ([]repository.TelemetryRecord, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return p.repo.FindAll(ctx, satelliteID, limit)
}

func (p *TelemetryProcessor) worker() {
	defer p.wg.Done()
	for {
		select {
		case rec := <-p.buffer:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := p.repo.Insert(ctx, rec); err != nil {
				log.Printf("failed to insert telemetry: %v", err)
			}
			cancel()
		case <-p.stopCh:
			return
		}
	}
}
