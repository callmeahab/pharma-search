#!/bin/bash

# Start gRPC server and grpcwebproxy

set -e

echo "🚀 Starting gRPC services..."

# Check if grpcwebproxy is installed
if ! command -v ~/go/bin/grpcwebproxy &> /dev/null; then
    echo "❌ grpcwebproxy not found at ~/go/bin/grpcwebproxy"
    echo "Please install it first: go install github.com/improbable-eng/grpc-web/go/grpcwebproxy@latest"
    exit 1
fi

# Kill existing processes on ports 50051 and 8080
echo "🧹 Cleaning up existing processes..."
lsof -ti:50051 | xargs kill -9 2>/dev/null || true
lsof -ti:8080 | xargs kill -9 2>/dev/null || true

# Start gRPC backend server
echo "📡 Starting Go gRPC server on port 50051..."
cd go-backend
go run . &
GRPC_PID=$!
cd ..

# Wait for gRPC server to start
sleep 2

# Start grpcwebproxy
echo "🌐 Starting grpcwebproxy on port 8080..."
~/go/bin/grpcwebproxy \
  --backend_addr=127.0.0.1:50051 \
  --run_tls_server=false \
  --allow_all_origins \
  --use_websockets \
  --server_bind_address=0.0.0.0 \
  --server_http_debug_port=8080 &
PROXY_PID=$!

# Wait for proxy to start
sleep 2

echo ""
echo "✅ gRPC services started successfully!"
echo "📡 gRPC server: localhost:50051 (PID: $GRPC_PID)"
echo "🌐 gRPC-Web proxy: localhost:8080 (PID: $PROXY_PID)"
echo ""
echo "To stop services:"
echo "  kill $GRPC_PID $PROXY_PID"
echo ""
echo "Press Ctrl+C to stop both services..."

# Trap Ctrl+C and cleanup
trap "echo ''; echo '🛑 Stopping services...'; kill $GRPC_PID $PROXY_PID 2>/dev/null; exit" INT TERM

# Wait for both processes
wait
