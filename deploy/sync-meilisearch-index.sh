#!/bin/bash

# Sync Meilisearch index from local machine to server
# Usage: ./sync-meilisearch-index.sh [server-host]

set -e

# Configuration
LOCAL_MEILI_URL="http://localhost:7700"
LOCAL_MEILI_KEY="${MEILI_API_KEY:-""}"
REMOTE_HOST="${1:-aposteka.rs}"
REMOTE_USER="root"
REMOTE_MEILI_URL="http://localhost:7700"
INDEX_NAME="products"
TEMP_DIR="/tmp/meili-sync-$$"

echo "🔄 Syncing Meilisearch index from local to $REMOTE_HOST"
echo "================================================"

# Check if local Meilisearch is running
echo "📡 Checking local Meilisearch connection..."
if ! curl -s "$LOCAL_MEILI_URL/health" > /dev/null; then
    echo "❌ Local Meilisearch is not running at $LOCAL_MEILI_URL"
    exit 1
fi

# Create temp directory
mkdir -p "$TEMP_DIR"
trap "rm -rf $TEMP_DIR" EXIT

# Export index from local Meilisearch
echo "📤 Exporting index '$INDEX_NAME' from local Meilisearch..."
EXPORT_FILE="$TEMP_DIR/meili-export.jsonl"

# Use curl to get all documents from local Meilisearch
LOCAL_AUTH_HEADER=""
if [ -n "$LOCAL_MEILI_KEY" ]; then
    LOCAL_AUTH_HEADER="Authorization: Bearer $LOCAL_MEILI_KEY"
fi

# Get total document count
TOTAL_DOCS=$(curl -s -H "$LOCAL_AUTH_HEADER" "$LOCAL_MEILI_URL/indexes/$INDEX_NAME/stats" | jq -r '.numberOfDocuments // 0')
echo "📊 Found $TOTAL_DOCS documents to export"

if [ "$TOTAL_DOCS" -eq 0 ]; then
    echo "⚠️  No documents found in local index"
    exit 1
fi

# Export documents in batches
BATCH_SIZE=1000
OFFSET=0
> "$EXPORT_FILE"  # Clear file

while [ $OFFSET -lt $TOTAL_DOCS ]; do
    echo "📦 Exporting batch: $OFFSET - $((OFFSET + BATCH_SIZE))"
    curl -s -H "$LOCAL_AUTH_HEADER" "$LOCAL_MEILI_URL/indexes/$INDEX_NAME/documents?limit=$BATCH_SIZE&offset=$OFFSET" | \
        jq -c '.results[]' >> "$EXPORT_FILE"
    OFFSET=$((OFFSET + BATCH_SIZE))
done

# Get index settings
echo "⚙️  Exporting index settings..."
SETTINGS_FILE="$TEMP_DIR/meili-settings.json"
curl -s -H "$LOCAL_AUTH_HEADER" "$LOCAL_MEILI_URL/indexes/$INDEX_NAME/settings" > "$SETTINGS_FILE"

# Upload files to server
echo "🚀 Uploading files to server..."
scp "$EXPORT_FILE" "$SETTINGS_FILE" "$REMOTE_USER@$REMOTE_HOST:/tmp/"

# Create remote import script
REMOTE_SCRIPT="$TEMP_DIR/remote-import.sh"
cat > "$REMOTE_SCRIPT" << 'EOF'
#!/bin/bash
set -e

MEILI_URL="http://localhost:7700"
INDEX_NAME="products"
EXPORT_FILE="/tmp/meili-export.jsonl"
SETTINGS_FILE="/tmp/meili-settings.json"

# Get Meilisearch API key from environment or docker
MEILI_KEY=""
if [ -f "/opt/pharma-search/.env" ]; then
    MEILI_KEY=$(grep MEILI_API_KEY /opt/pharma-search/.env | cut -d'=' -f2 | tr -d '"')
fi

AUTH_HEADER=""
if [ -n "$MEILI_KEY" ]; then
    AUTH_HEADER="Authorization: Bearer $MEILI_KEY"
fi

echo "🗑️  Clearing existing index..."
curl -X DELETE -H "$AUTH_HEADER" "$MEILI_URL/indexes/$INDEX_NAME" || true
sleep 2

echo "🔧 Creating index..."
curl -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    "$MEILI_URL/indexes" \
    -d "{\"uid\":\"$INDEX_NAME\",\"primaryKey\":\"id\"}" || true
sleep 2

echo "⚙️  Applying settings..."
curl -X PATCH -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    "$MEILI_URL/indexes/$INDEX_NAME/settings" \
    -d "@$SETTINGS_FILE"
sleep 2

echo "📥 Importing documents..."
# Import in batches to avoid timeout
split -l 500 "$EXPORT_FILE" "/tmp/batch_"

for batch_file in /tmp/batch_*; do
    if [ -f "$batch_file" ]; then
        echo "📦 Importing batch: $(basename "$batch_file")"
        # Convert JSONL to JSON array
        echo "[" > "/tmp/batch.json"
        sed 's/$/,/' "$batch_file" | sed '$ s/,$//' >> "/tmp/batch.json"
        echo "]" >> "/tmp/batch.json"
        
        curl -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" \
            "$MEILI_URL/indexes/$INDEX_NAME/documents" \
            -d "@/tmp/batch.json"
        
        rm -f "$batch_file" "/tmp/batch.json"
        sleep 1
    fi
done

echo "🧹 Cleaning up..."
rm -f "$EXPORT_FILE" "$SETTINGS_FILE" /tmp/batch_*

echo "✅ Index sync completed successfully!"

# Verify import
TOTAL_DOCS=$(curl -s -H "$AUTH_HEADER" "$MEILI_URL/indexes/$INDEX_NAME/stats" | jq -r '.numberOfDocuments // 0')
echo "📊 Total documents in remote index: $TOTAL_DOCS"
EOF

# Upload and run remote script
scp "$REMOTE_SCRIPT" "$REMOTE_USER@$REMOTE_HOST:/tmp/remote-import.sh"
ssh "$REMOTE_USER@$REMOTE_HOST" "chmod +x /tmp/remote-import.sh && /tmp/remote-import.sh"

echo "🎉 Meilisearch index sync completed!"
echo "✅ Local index successfully uploaded to $REMOTE_HOST"