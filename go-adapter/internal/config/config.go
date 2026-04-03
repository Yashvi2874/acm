package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	MongoURI    string `yaml:"mongo_uri"`
	Database    string `yaml:"database"`
	Collection  string `yaml:"collection"`
	Port        string `yaml:"port"`
	BufferSize  int    `yaml:"buffer_size"`
	WorkerCount int    `yaml:"worker_count"`
	Mode        string `yaml:"mode"`
}

func LoadConfig(path string) (*Config, error) {
	// Allow env override for Docker
	if uri := os.Getenv("MONGO_URI"); uri != "" {
		// will be applied after yaml load
		_ = uri
	}

	data, err := os.ReadFile(path)
	if err != nil {
		// Return defaults if file missing
		return defaultConfig(), nil
	}

	cfg := defaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}

	// Env vars override yaml
	if uri := os.Getenv("MONGO_URI"); uri != "" {
		cfg.MongoURI = uri
	}
	if port := os.Getenv("PORT"); port != "" {
		cfg.Port = port
	}
	if mode := os.Getenv("MODE"); mode != "" {
		cfg.Mode = mode
	}

	return cfg, nil
}

func defaultConfig() *Config {
	return &Config{
		MongoURI:    "mongodb://localhost:27017",
		Database:    "acm_db",
		Collection:  "telemetry",
		Port:        "8080",
		BufferSize:  10000,
		WorkerCount: 32,
		Mode:        "actual",
	}
}
