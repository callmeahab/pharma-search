#!/bin/bash

# Pharma Search Backend Services Starter
# This script starts the Go backend and gRPC-Web proxy

set -e  # Exit on any error

echo "🚀 Starting Pharma Search Backend Services"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the go-backend directory
if [ ! -f "main.go" ]; then
    print_error "Please run this script from the go-backend directory"
    print_error "Usage: cd go-backend && ./start-services.sh"
    exit 1
fi

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -i :$port >/dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to kill processes on a port
kill_port() {
    local port=$1
    local pids=$(lsof -ti :$port)
    if [ -n "$pids" ]; then
        print_warning "Killing existing processes on port $port"
        kill $pids 2>/dev/null || true
        sleep 2
    fi
}

# Check and install Go if needed
print_status "Checking Go installation..."
if ! command -v go &> /dev/null; then
    print_error "Go is not installed. Please install Go first."
    print_error "Visit: https://golang.org/doc/install"
    exit 1
fi
print_success "Go is installed: $(go version)"

# Check and install grpcwebproxy if needed
print_status "Checking grpcwebproxy installation..."
if ! command -v ~/go/bin/grpcwebproxy &> /dev/null; then
    print_warning "grpcwebproxy not found. Installing..."
    go install github.com/improbable-eng/grpc-web/go/grpcwebproxy@latest
    if [ $? -eq 0 ]; then
        print_success "grpcwebproxy installed successfully"
    else
        print_error "Failed to install grpcwebproxy"
        exit 1
    fi
else
    print_success "grpcwebproxy is already installed"
fi

# Build the Go backend
print_status "Building Go backend..."
if go build -o main .; then
    print_success "Go backend built successfully"
else
    print_error "Failed to build Go backend"
    exit 1
fi

# Check if ports are in use and clean them up
print_status "Checking ports..."

if check_port 50051; then
    print_warning "Port 50051 is in use"
    kill_port 50051
fi

if check_port 8080; then
    print_warning "Port 8080 is in use"
    kill_port 8080
fi

# Start the Go backend
print_status "Starting Go backend server on port 50051..."
./main &
BACKEND_PID=$!

# Wait a moment for the backend to start
sleep 3

# Check if backend started successfully
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    print_error "Go backend failed to start"
    exit 1
fi
print_success "Go backend started (PID: $BACKEND_PID)"

# Start the gRPC-Web proxy
print_status "Starting gRPC-Web proxy on port 8080..."
~/go/bin/grpcwebproxy \
    --backend_addr=127.0.0.1:50051 \
    --run_tls_server=false \
    --allow_all_origins \
    --use_websockets \
    --server_bind_address=0.0.0.0 \
    --server_http_debug_port=8080 &
PROXY_PID=$!

# Wait a moment for the proxy to start
sleep 2

# Check if proxy started successfully
if ! kill -0 $PROXY_PID 2>/dev/null; then
    print_error "gRPC-Web proxy failed to start"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi
print_success "gRPC-Web proxy started (PID: $PROXY_PID)"

# Test the connection
print_status "Testing service connection..."
if curl -s --max-time 5 http://localhost:8080/service.PharmaAPI/Health >/dev/null 2>&1; then
    print_success "Services are responding correctly"
else
    print_warning "Health check failed, but services may still be starting..."
fi

# Create PID files for easy cleanup
echo $BACKEND_PID > .backend.pid
echo $PROXY_PID > .proxy.pid

echo ""
print_success "✅ All services started successfully!"
echo ""
echo "📊 Service Status:"
echo "  🗄️  Go Backend:      http://localhost:50051 (gRPC)"
echo "  🌐 gRPC-Web Proxy:  http://localhost:8080 (HTTP)"
echo ""
echo "📝 Process IDs saved to:"
echo "  📄 Backend PID:  .backend.pid"
echo "  📄 Proxy PID:    .proxy.pid"
echo ""
echo "🛑 To stop services:"
echo "  ./stop-services.sh"
echo ""
echo "📋 Logs:"
echo "  Backend: Check terminal output or logs"
echo "  Proxy:   Check terminal output or logs"
echo ""
print_status "Services are running in the background..."
print_status "You can now start your frontend application!"

# Keep the script running to show logs (optional)
if [ "$1" = "--follow-logs" ] || [ "$1" = "-f" ]; then
    echo ""
    print_status "Following logs (Ctrl+C to stop log viewing, services will continue)..."
    echo ""
    tail -f /dev/null &  # This keeps the script running to show background process output
    wait
fi