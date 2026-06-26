.PHONY: help update-mappings test-grouping update-and-test clean server migrate import-csv fetch-places fetch-places-dry-run

# Default target
help:
	@echo "📊 Product Grouping System - Available Commands:"
	@echo ""
	@echo "  make update-mappings    - Update mappings from products.csv"
	@echo "  make test-grouping      - Test the grouping system"
	@echo "  make update-and-test    - Update mappings and test (recommended)"
	@echo "  make server             - Start the Go backend"
	@echo "  make migrate            - Apply PostgreSQL schema migrations via Go wrapper"
	@echo "  make import-csv         - Import scraped CSVs into PostgreSQL via Go wrapper"
	@echo "  make fetch-places       - Fetch local OSM/TomTom/Foursquare places for vendors"
	@echo "  make fetch-places-dry-run VENDOR=Benu - Preview local place matches"
	@echo "  make clean              - Remove temporary files"
	@echo ""
	@echo "After scraping new products, run:"
	@echo "  make update-and-test"

# Update mappings from products.csv
update-mappings:
	@echo "🔄 Updating product mappings..."
	python3 scripts/update_mappings.py
	@echo "✅ Mappings updated!"

# Test grouping with current mappings
test-grouping:
	@echo "🧪 Testing product grouping..."
	@go run . test-search "vitamin d" || echo "⚠️ Test failed"

# Update and test (recommended workflow)
update-and-test: update-mappings test-grouping
	@echo ""
	@echo "✅ Update and test complete!"
	@echo ""
	@echo "📝 Next steps:"
	@echo "  1. Review changes: git diff comprehensive_mappings.go"
	@echo "  2. If good, commit: git add comprehensive_mappings.go && git commit -m 'Update mappings'"
	@echo "  3. Deploy your changes"

migrate:
	@echo "🗄️ Applying database migrations..."
	@go run ./cmd/migrate

server:
	@echo "🚀 Starting backend..."
	@go run .

# Clean temporary files
clean:
	@echo "🧹 Cleaning temporary files..."
	rm -f /tmp/variations_output.txt
	rm -f /tmp/extract_all_variations.py
	rm -f /tmp/analyze_products.py
	rm -f pharma-search
	@echo "✅ Clean complete!"

import-csv:
	@echo "📥 Importing scraper CSVs..."
	@go run ./cmd/importcsv

fetch-places:
	@bash scripts/fetch-places-local.sh

fetch-places-dry-run:
	@DRY_RUN=1 bash scripts/fetch-places-local.sh

# Development helpers
dev-test:
	@echo "🧪 Running development tests..."
	go test ./...

fmt:
	@echo "📝 Formatting Go code..."
	go fmt ./...

# Build backend
build:
	@echo "🔨 Building backend..."
	go build -o pharma-server

# Generate protobuf code
generate:
	@echo "🔧 Generating protobuf code..."
	buf generate proto

# Integration test (requires backend running)
integration-test:
	@echo "🌐 Testing grouping via API..."
	@curl -s "http://localhost:50051/service.PharmaAPI/Search" -H "Content-Type: application/json" -d '{"q":"vitamin d"}' | jq '.data.groups[] | {id, product_count, vendor_count}' || echo "⚠️ Backend not running or jq not installed"

# Test search relevance (direct CLI test)
test-search:
	@echo "🔍 Testing search relevance..."
	@go run . test-search "$(QUERY)"

# Quick search examples
test-v-vein:
	@go run . test-search "v-vein"

test-omega:
	@go run . test-search "omega 3"
