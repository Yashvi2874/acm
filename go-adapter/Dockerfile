FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
RUN go mod download || true
COPY . .
RUN go mod tidy && go build -o go-adapter .

FROM alpine:3.19
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=builder /app/go-adapter .
COPY --from=builder /app/admin_config.yaml .
EXPOSE 8080
CMD ["./go-adapter"]
