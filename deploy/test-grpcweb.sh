#!/bin/bash

# Test script for gRPC-Web proxy functionality
# Run this on the server to test grpc-web connectivity

echo "🧪 Testing gRPC-Web Proxy Connectivity"
echo "======================================"

# Test 1: Check if grpcwebproxy is running
echo "1️⃣ Checking grpcwebproxy service..."
if systemctl is-active --quiet grpcwebproxy; then
    echo "✅ grpcwebproxy is running"
else
    echo "❌ grpcwebproxy is not running"
    echo "Starting grpcwebproxy..."
    systemctl start grpcwebproxy
    sleep 2
fi

# Test 2: Check if Go backend is running on port 50051
echo ""
echo "2️⃣ Checking Go backend on port 50051..."
if ss -lntp | grep -q ":50051"; then
    echo "✅ Go backend is listening on port 50051"
else
    echo "❌ Go backend is not listening on port 50051"
    echo "Checking PM2 status..."
    pm2 status
    exit 1
fi

# Test 3: Test gRPC-Web proxy response
echo ""
echo "3️⃣ Testing gRPC-Web proxy response..."

# Create a minimal gRPC-Web health check request
echo "Testing health endpoint via grpc-web..."
response=$(curl -s -w "\nHTTP_CODE:%{http_code}\nCONTENT_TYPE:%{content_type}" \
    -H "Content-Type: application/grpc-web+proto" \
    -H "Accept: application/grpc-web+proto" \
    -X POST \
    "http://127.0.0.1:8080/service.PharmaAPI/Health" \
    -d "")

echo "Response:"
echo "$response"

# Test 4: Check response headers
echo ""
echo "4️⃣ Checking response headers..."
curl -I -H "Content-Type: application/grpc-web+proto" \
    "http://127.0.0.1:8080/service.PharmaAPI/Health" 2>/dev/null

# Test 5: Test autocomplete endpoint specifically
echo ""
echo "5️⃣ Testing autocomplete endpoint..."

# Create a basic autocomplete request (empty query)
# This is a minimal grpc-web frame - just testing connectivity
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -H "Content-Type: application/grpc-web+proto" \
    -H "Accept: application/grpc-web+proto" \
    -X POST \
    "http://127.0.0.1:8080/service.PharmaAPI/Autocomplete" \
    -d $'\x00\x00\x00\x00\x02\x08\x05')

echo "Autocomplete response:"
echo "$response"

echo ""
echo "6️⃣ Checking logs for errors..."
echo "grpcwebproxy logs (last 10 lines):"
journalctl -u grpcwebproxy --no-pager -n 10

echo ""
echo "PM2 backend logs (last 5 lines):"
pm2 logs pharma-go-backend --lines 5 2>/dev/null || echo "No PM2 logs found"

echo ""
echo "🏁 Test completed!"
