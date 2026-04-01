package repository

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

type TelemetryRecord struct {
	SatelliteID string                 `bson:"satellite_id" json:"satellite_id"`
	Timestamp   time.Time              `bson:"timestamp"    json:"timestamp"`
	Data        map[string]interface{} `bson:"data"         json:"data"`
}

type MongoRepository struct {
	client     *mongo.Client
	collection *mongo.Collection
}

func NewMongoRepository(ctx context.Context, uri, dbName, collName string) (*MongoRepository, error) {
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}
	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}
	col := client.Database(dbName).Collection(collName)
	return &MongoRepository{client: client, collection: col}, nil
}

func (r *MongoRepository) Insert(ctx context.Context, rec TelemetryRecord) error {
	_, err := r.collection.InsertOne(ctx, rec)
	return err
}

func (r *MongoRepository) FindLatest(ctx context.Context, satelliteID string) (*TelemetryRecord, error) {
	filter := bson.M{"satellite_id": satelliteID}
	opts := options.FindOne().SetSort(bson.D{{Key: "timestamp", Value: -1}})
	var rec TelemetryRecord
	if err := r.collection.FindOne(ctx, filter, opts).Decode(&rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *MongoRepository) FindAll(ctx context.Context, satelliteID string, limit int64) ([]TelemetryRecord, error) {
	filter := bson.M{"satellite_id": satelliteID}
	opts := options.Find().SetSort(bson.D{{Key: "timestamp", Value: -1}}).SetLimit(limit)
	cursor, err := r.collection.Find(ctx, filter, opts)
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
