package repository

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

// ── Shared types ──────────────────────────────────────────────────────────────

type Vec3 struct {
	X float64 `bson:"x" json:"x"`
	Y float64 `bson:"y" json:"y"`
	Z float64 `bson:"z" json:"z"`
}

// SpaceObject is the canonical document stored in satellites / debris collections.
type SpaceObject struct {
	ID        string    `bson:"_id"       json:"id"`
	Type      string    `bson:"type"      json:"type"`
	R         Vec3      `bson:"r"         json:"r"`
	V         Vec3      `bson:"v"         json:"v"`
	Status    string    `bson:"status"    json:"status,omitempty"`
	FuelKg    float64   `bson:"fuel_kg"   json:"fuel_kg,omitempty"`
	MassKg    float64   `bson:"mass_kg"   json:"mass_kg,omitempty"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}

// TelemetryRecord is the raw ingestion log (append-only).
type TelemetryRecord struct {
	SatelliteID string                 `bson:"satellite_id" json:"satellite_id"`
	Timestamp   time.Time              `bson:"timestamp"    json:"timestamp"`
	Data        map[string]interface{} `bson:"data"         json:"data"`
}

// ── Repository ────────────────────────────────────────────────────────────────

type MongoRepository struct {
	client     *mongo.Client
	telemetry  *mongo.Collection
	satellites *mongo.Collection
	debris     *mongo.Collection
}

func NewMongoRepository(ctx context.Context, uri, dbName, collName string) (*MongoRepository, error) {
	opts := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(ctx, opts)
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	db := client.Database(dbName)
	return &MongoRepository{
		client:     client,
		telemetry:  db.Collection(collName),
		satellites: db.Collection("satellites"),
		debris:     db.Collection("debris"),
	}, nil
}

// UpsertObject upserts a SpaceObject into the correct collection by type.
// Enforces priority: incoming API telemetry has priority over existing DB state by updated_at comparison.
func (r *MongoRepository) UpsertObject(ctx context.Context, obj SpaceObject) error {
	col := r.debris
	if obj.Type == "SATELLITE" {
		col = r.satellites
	}
	
	// First, check if document exists and compare updated_at
	var existing SpaceObject
	err := col.FindOne(ctx, bson.M{"_id": obj.ID}).Decode(&existing)
	if err == nil {
		// Document exists, check if incoming is newer
		if obj.UpdatedAt.Before(existing.UpdatedAt) || obj.UpdatedAt.Equal(existing.UpdatedAt) {
			// Incoming is not newer, skip update
			return nil
		}
	} else if err != mongo.ErrNoDocuments {
		// Other error
		return err
	}
	// If not found or incoming is newer, proceed with upsert
	
	filter := bson.M{"_id": obj.ID}
	update := bson.M{"$set": obj}
	opts := options.Update().SetUpsert(true)
	_, err = col.UpdateOne(ctx, filter, update, opts)
	return err
}

// GetAllObjects returns all satellites and debris from Atlas.
func (r *MongoRepository) GetAllObjects(ctx context.Context) ([]SpaceObject, []SpaceObject, error) {
	var sats, debs []SpaceObject

	cur, err := r.satellites.Find(ctx, bson.M{})
	if err != nil {
		return nil, nil, err
	}
	if err := cur.All(ctx, &sats); err != nil {
		return nil, nil, err
	}

	cur, err = r.debris.Find(ctx, bson.M{})
	if err != nil {
		return nil, nil, err
	}
	if err := cur.All(ctx, &debs); err != nil {
		return nil, nil, err
	}
	return sats, debs, nil
}

// Insert appends a raw telemetry log record.
func (r *MongoRepository) Insert(ctx context.Context, rec TelemetryRecord) error {
	_, err := r.telemetry.InsertOne(ctx, rec)
	return err
}

func (r *MongoRepository) FindLatest(ctx context.Context, satelliteID string) (*TelemetryRecord, error) {
	filter := bson.M{"satellite_id": satelliteID}
	opts := options.FindOne().SetSort(bson.D{{Key: "timestamp", Value: -1}})
	var rec TelemetryRecord
	if err := r.telemetry.FindOne(ctx, filter, opts).Decode(&rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *MongoRepository) FindAll(ctx context.Context, satelliteID string, limit int64) ([]TelemetryRecord, error) {
	filter := bson.M{"satellite_id": satelliteID}
	opts := options.Find().SetSort(bson.D{{Key: "timestamp", Value: -1}}).SetLimit(limit)
	cursor, err := r.telemetry.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var records []TelemetryRecord
	if err := cursor.All(ctx, &records); err != nil {
		return nil, err
	}
	return records, nil
}

func (r *MongoRepository) Disconnect(ctx context.Context) error {
	return r.client.Disconnect(ctx)
}

// GetSatellitesCollection returns the satellites collection for admin operations.
func (r *MongoRepository) GetSatellitesCollection() *mongo.Collection {
	return r.satellites
}

// GetDebrisCollection returns the debris collection for admin operations.
func (r *MongoRepository) GetDebrisCollection() *mongo.Collection {
	return r.debris
}
