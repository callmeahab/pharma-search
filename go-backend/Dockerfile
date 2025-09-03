# Build stage  
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Install git for go modules that might need it
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Install grpcwebproxy
RUN go install github.com/improbable-eng/grpc-web/go/grpcwebproxy@latest

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o pharma-server .

# Runtime stage
FROM alpine:3.19

# Install ca-certificates and bash for script execution
RUN apk --no-cache add ca-certificates bash curl

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/pharma-server .
COPY --from=builder /go/bin/grpcwebproxy .

# Create startup script
RUN echo '#!/bin/bash' > start.sh && \
    echo 'set -e' >> start.sh && \
    echo 'echo "Starting Go backend server..."' >> start.sh && \
    echo './pharma-server &' >> start.sh && \
    echo 'BACKEND_PID=$!' >> start.sh && \
    echo 'sleep 3' >> start.sh && \
    echo 'echo "Starting gRPC-Web proxy..."' >> start.sh && \
    echo './grpcwebproxy --backend_addr=127.0.0.1:50051 --run_tls_server=false --allow_all_origins --use_websockets --server_bind_address=0.0.0.0 --server_http_debug_port=8080 &' >> start.sh && \
    echo 'PROXY_PID=$!' >> start.sh && \
    echo 'echo "Services started - Backend PID: $BACKEND_PID, Proxy PID: $PROXY_PID"' >> start.sh && \
    echo 'wait' >> start.sh && \
    chmod +x start.sh

# Set environment variables for external services
ENV DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/pharmagician
ENV MEILI_URL=http://host.docker.internal:7700

# Expose ports
EXPOSE 8080 50051

# Run both services
CMD ["./start.sh"]