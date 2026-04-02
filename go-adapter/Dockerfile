FROM golang:1.22 AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download || true
COPY . .
RUN go mod tidy && go build -o go-adapter .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/go-adapter .
COPY --from=builder /app/admin_config.yaml .
EXPOSE 8080
CMD ["./go-adapter"]
