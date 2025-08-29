#!/bin/bash

# Next.js Build Script with Memory Management
# Run this script to build the frontend with memory optimizations

set -e

APP_DIR="/var/www/pharma-search"
cd "$APP_DIR/frontend"

bun run build

echo "✅ Build completed successfully!"