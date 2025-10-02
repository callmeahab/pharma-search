.PHONY: help update-mappings test-grouping update-and-test clean

# Default target
help:
	@echo "📊 Product Grouping System - Available Commands:"
	@echo ""
	@echo "  make update-mappings    - Update mappings from products.csv"
	@echo "  make test-grouping      - Test the grouping system"
	@echo "  make update-and-test    - Update mappings and test (recommended)"
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
	@cd go-backend && go run test_grouping_example.go.txt enhanced_grouping.go comprehensive_mappings.go 2>/dev/null || \
	 (echo "⚠️  Standalone test not available. Use 'make build && ./go-backend/pharma-server' to test integration." && exit 1)

# Update and test (recommended workflow)
update-and-test: update-mappings test-grouping
	@echo ""
	@echo "✅ Update and test complete!"
	@echo ""
	@echo "📝 Next steps:"
	@echo "  1. Review changes: git diff go-backend/comprehensive_mappings.go"
	@echo "  2. If good, commit: git add go-backend/comprehensive_mappings.go && git commit -m 'Update mappings'"
	@echo "  3. Deploy your changes"

# Clean temporary files
clean:
	@echo "🧹 Cleaning temporary files..."
	rm -f /tmp/variations_output.txt
	rm -f /tmp/extract_all_variations.py
	rm -f /tmp/analyze_products.py
	@echo "✅ Clean complete!"

# Advanced: Update with custom parameters
update-strict:
	@echo "🔄 Updating mappings with stricter brand filtering..."
	python3 scripts/update_mappings.py --min-brand-count 20

update-lenient:
	@echo "🔄 Updating mappings with lenient brand filtering..."
	python3 scripts/update_mappings.py --min-brand-count 5

# Development helpers
dev-test:
	@echo "🧪 Running development tests..."
	cd go-backend && go test ./...

fmt:
	@echo "📝 Formatting Go code..."
	cd go-backend && go fmt ./...

# Build backend
build:
	@echo "🔨 Building backend..."
	cd go-backend && go build -o pharma-server

# Process products with enhanced grouping
process:
	@echo "🔄 Processing products with enhanced grouping..."
	cd go-backend && go run . process

# Index products to Meilisearch
index:
	@echo "📊 Indexing products to Meilisearch..."
	cd go-backend && go run . index

# Integration test (requires backend running)
integration-test:
	@echo "🌐 Testing grouping via API..."
	@curl -s "http://localhost:8080/api/search?q=vitamin+d+2000" | jq '.groups[] | {id, product_count, vendor_count}' || echo "⚠️ Backend not running or jq not installed"

# Test search relevance (direct CLI test)
test-search:
	@echo "🔍 Testing search relevance..."
	@cd go-backend && go run . test-search "$(QUERY)"

# Quick search examples
test-v-vein:
	@cd go-backend && go run . test-search "v-vein"

test-omega:
	@cd go-backend && go run . test-search "omega 3"
