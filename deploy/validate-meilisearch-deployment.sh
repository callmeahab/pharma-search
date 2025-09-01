#!/bin/bash

# Meilisearch Deployment Validation Script
# Run this script to validate the Meilisearch deployment integration

echo "🔍 Validating Meilisearch Deployment Integration"
echo "=============================================="

ERRORS=0

# Check if all required scripts exist
echo "📂 Checking deployment scripts..."

REQUIRED_SCRIPTS=(
    "01-system-setup.sh"
    "02b-meilisearch-setup.sh"
    "03-app-setup.sh"
    "07-meilisearch-index.sh"
    "deploy.sh"
)

for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        echo "  ✅ $script - Found"
    else
        echo "  ❌ $script - Missing"
        ((ERRORS++))
    fi
done

# Check if all scripts are executable
echo ""
echo "🔧 Checking script permissions..."
for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ -f "$script" ] && [ -x "$script" ]; then
        echo "  ✅ $script - Executable"
    elif [ -f "$script" ]; then
        echo "  ⚠️  $script - Not executable (will be fixed during deployment)"
    fi
done

# Check if required files exist
echo ""
echo "📋 Checking required application files..."

REQUIRED_FILES=(
    "../meilisearch_indexer.py"
    "../backend/requirements.txt"
    "../backend/src/meilisearch_engine.py"
    "../backend/src/api.py"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file - Found"
    else
        echo "  ❌ $file - Missing"
        ((ERRORS++))
    fi
done

# Check requirements.txt for requests dependency
echo ""
echo "🐍 Checking Python dependencies..."
if grep -q "requests" "../backend/requirements.txt"; then
    echo "  ✅ requests - Found in requirements.txt"
else
    echo "  ❌ requests - Missing from requirements.txt"
    ((ERRORS++))
fi

# Check Meilisearch indexer script content
echo ""
echo "🔍 Validating indexer script..."
if [ -f "../meilisearch_indexer.py" ]; then
    if grep -q "dosageCount" "../meilisearch_indexer.py"; then
        echo "  ✅ Enhanced dosage count extraction - Present"
    else
        echo "  ❌ Enhanced dosage count extraction - Missing"
        ((ERRORS++))
    fi
    
    if grep -q "MeiliProduct" "../meilisearch_indexer.py"; then
        echo "  ✅ MeiliProduct dataclass - Present"
    else
        echo "  ❌ MeiliProduct dataclass - Missing"
        ((ERRORS++))
    fi
fi

# Check backend API integration
echo ""
echo "🌐 Validating backend API..."
if [ -f "../backend/src/api.py" ]; then
    if grep -q "MeilisearchEngine" "../backend/src/api.py"; then
        echo "  ✅ MeilisearchEngine integration - Present"
    else
        echo "  ❌ MeilisearchEngine integration - Missing"
        ((ERRORS++))
    fi
fi

# Check deployment script integration
echo ""
echo "🚀 Validating deployment script integration..."
if grep -q "02b-meilisearch-setup.sh" "deploy.sh"; then
    echo "  ✅ Meilisearch setup step - Integrated"
else
    echo "  ❌ Meilisearch setup step - Not integrated"
    ((ERRORS++))
fi

if grep -q "07-meilisearch-index.sh" "deploy.sh"; then
    echo "  ✅ Indexing step - Integrated"
else
    echo "  ❌ Indexing step - Not integrated"
    ((ERRORS++))
fi

# Summary
echo ""
echo "📊 Validation Summary"
echo "===================="

if [ $ERRORS -eq 0 ]; then
    echo "🎉 All validation checks passed!"
    echo "✅ Deployment is ready for Meilisearch integration"
    echo ""
    echo "🚀 Next Steps:"
    echo "  1. Copy all files to your server: /var/www/pharma-search/"
    echo "  2. Run: sudo ./deploy/deploy.sh"
    echo "  3. The deployment will automatically set up Meilisearch"
    echo "  4. Choose 'Y' when prompted for indexing during deployment"
    echo ""
    echo "📋 After deployment:"
    echo "  • Monitor: /var/www/pharma-search/monitor.sh"
    echo "  • Re-index: /var/www/pharma-search/deploy/07-meilisearch-index.sh"
    echo "  • Check logs: journalctl -u meilisearch -f"
else
    echo "❌ Found $ERRORS validation error(s)"
    echo "🔧 Please fix the issues above before deploying"
    exit 1
fi