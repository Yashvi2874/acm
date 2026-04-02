package service

import (
	"context"
	"log"
	"sync"
	"time"

	"telemetry_ingestion/internal/repository"
)

// ObjectMessage is used to upsert a SpaceObject into the correct collection.
type ObjectMessage struct {
	Object repository.SpaceObject
}

type TelemetryProcessor struct {
	repo        *repository.MongoRepository
	buffer      chan repository.TelemetryRecord
	objBuffer   chan ObjectMessage
	workerCount int
	wg          sync.WaitGroup
	stopCh      chan struct{}
}

func NewTelemetryProcessor(repo *repository.MongoRepository, bufferSize, workerCount int) *TelemetryProcessor {
	return &TelemetryProcessor{
		repo:        repo,
		buffer:      make(chan repository.TelemetryRecord, bufferSize),
		objBuffer:   make(chan ObjectMessage, bufferSize),
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

// EnqueueObject upserts a SpaceObject into satellites or debris collection.
func (p *TelemetryProcessor) EnqueueObject(obj repository.SpaceObject) {
	select {
	case p.objBuffer <- ObjectMessage{Object: obj}:
	default:
		log.Printf("object buffer full, dropping upsert for %s", obj.ID)
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

func (p *TelemetryProcessor) GetAllObjects() ([]repository.SpaceObject, []repository.SpaceObject, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return p.repo.GetAllObjects(ctx)
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

		case msg := <-p.objBuffer:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := p.repo.UpsertObject(ctx, msg.Object); err != nil {
				log.Printf("failed to upsert object %s: %v", msg.Object.ID, err)
			}
			cancel()

		case <-p.stopCh:
			return
		}
	}
}
