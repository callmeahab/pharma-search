#!/bin/bash
set -e

echo "Setting up development environment..."

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
until pg_isready -h db -U postgres; do
  sleep 1
done
echo "PostgreSQL is ready!"

# Apply migrations
echo "Applying database migrations..."
for migration in /workspace/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "  -> Applying $(basename $migration)..."
    PGPASSWORD=postgres psql -h db -U postgres -d pharma_search -f "$migration" 2>&1 | grep -v "NOTICE" || true
  fi
done

# Apply seed data
if [ -d "/workspace/migrations/seed" ]; then
  echo "Applying seed data..."
  for seed in /workspace/migrations/seed/*.sql; do
    if [ -f "$seed" ]; then
      echo "  -> Seeding $(basename $seed)..."
      PGPASSWORD=postgres psql -h db -U postgres -d pharma_search -f "$seed" 2>&1 | grep -v "NOTICE" || true
    fi
  done
fi

# Install frontend dependencies
echo "Installing frontend dependencies..."
cd /workspace/frontend
bun install

# Install Go dependencies
echo "Installing Go dependencies..."
cd /workspace
go mod download

# Install Go tools
echo "Installing Go tools..."
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install connectrpc.com/connect/cmd/protoc-gen-connect-go@latest
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# Setup ML environment
echo "Setting up ML environment..."
cd /workspace/ml
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Install GPU-accelerated spacy (CUDA for Linux/Windows devcontainer)
if command -v nvidia-smi &> /dev/null; then
  echo "NVIDIA GPU detected, installing spacy with CUDA support..."
  pip install spacy[cuda12x]
else
  echo "No NVIDIA GPU detected, using CPU-only spacy"
fi

python -m spacy download xx_ent_wiki_sm || true
deactivate

# Install scrapers dependencies
echo "Installing scrapers dependencies..."
cd /workspace/scrapers
bun install

echo ""
echo "Development environment ready!"
echo ""
echo "Quick start:"
echo "  Frontend:  cd frontend && bun dev"
echo "  Backend:   go run ."
echo "  ML:        cd ml && source .venv/bin/activate"
echo "  Scrapers:  cd scrapers && bun start"
echo ""
echo "Services:"
echo "  PostgreSQL:  db:5432 (user: postgres, pass: postgres)"
echo "  Meilisearch: http://localhost:7700"
