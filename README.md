# Pharma Search

Pharmaceutical product price comparison platform for Serbia. Aggregates prices from 80+ pharmacies and supplement stores with intelligent product grouping.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Next.js   │────▶│  Go + ConnectRPC │────▶│ PostgreSQL  │
│  Frontend   │     │     Backend      │     │             │
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Meilisearch   │
                    │  (Search Index) │
                    └─────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 15, React 19, TailwindCSS, shadcn/ui |
| Backend | Go 1.24, ConnectRPC |
| Database | PostgreSQL 16 |
| Search | Meilisearch |
| Scrapers | Puppeteer, Bun |
| ML | Python 3.12, spaCy |

## Local Development

### Prerequisites

- VS Code with Dev Containers extension
- Docker Desktop

### Quick Start

1. Open project in VS Code
2. Click "Reopen in Container" when prompted
3. Wait for setup to complete

The devcontainer automatically:
- Starts PostgreSQL and Meilisearch
- Applies database migrations
- Installs all dependencies

### Running Services

```bash
# Apply database migrations and sync static vendors
go run ./cmd/migrate

# Frontend (port 3000)
cd frontend && bun dev

# Backend (port 50051)
# Use `go run .` so all files in package main are compiled together.
go run .

# Scrapers
cd scrapers && bun start

# Full scrape -> import -> cleanup pipeline
cd scrapers && bun run pipeline

# Import scraped CSVs through the Go wrapper
go run ./cmd/importcsv
```

## Project Structure

```
pharma-search/
├── main.go            # Go API server entry point
├── gen/               # Generated protobuf code
├── proto/             # Protocol buffer definitions
├── frontend/          # Next.js app
│   ├── app/           # App router pages
│   ├── components/    # React components
│   └── lib/           # Utilities, gRPC client
├── scrapers/          # Price scrapers
├── ml/                # ML extraction pipeline
├── migrations/        # SQL migrations
│   └── seed/          # Seed data
└── deploy/            # Server deployment scripts
```

## Database

Core tables:

| Table | Purpose |
|-------|---------|
| Vendor | Pharmacy/store metadata |
| Product | Scraped products with prices |
| ProductStandardization | Standardized product titles and extracted attributes |

### Migrations

```bash
# Apply schema migrations and seed vendors
go run ./cmd/migrate

# Skip the vendor seed if you only want schema changes
go run ./cmd/migrate -seed-vendors=false
```

## API

ConnectRPC endpoints on port 50051:

| Method | Description |
|--------|-------------|
| `Search` | Full-text product search via Meilisearch |
| `GetProductGroups` | Retrieve grouped products |
| `GetVendors` | List all vendors |

### Generating Protobuf Code

```bash
# Frontend (TypeScript)
cd frontend && npx buf generate

# Backend (Go)
buf generate proto
```

## Product Enrichment

Primary product enrichment now comes from lookup tables plus deterministic normalization rules.
Optional spaCy model support is still possible, but it is no longer the primary workflow.

Example structured output:

```
Input:  "Solgar Vitamin D3 2000IU 60 kapsula"
Output: { brand: "Solgar", dosage: "2000IU", form: "kapsula", quantity: "60" }
```

### Runtime Setup

```bash
cd ml
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### Optional spaCy Support

```bash
pip install -r requirements-ml.txt
```

If you already have a compatible saved model under `ml/models/pharma_ner`, `populate_missing_data.py` will use it automatically. Otherwise it falls back to deterministic rules.

### Populate Database

Extract entities from product titles and update the database:

```bash
# Show stats and sample extractions (dry run)
python populate_missing_data.py --dry-run

# Process products with missing data
python populate_missing_data.py

# Re-process all products
python populate_missing_data.py --all

# Limit number of products
python populate_missing_data.py --limit 1000

# Run without spaCy/model dependencies
python populate_missing_data.py --rules-only
```

## Deployment

Three scripts in `deploy/` handle server deployment:

### Initial Server Setup

Run once on a fresh Ubuntu server:

```bash
# SSH into server and run setup
scp deploy/setup.sh root@your-server:/tmp/
ssh root@your-server 'bash /tmp/setup.sh'
```

This installs and configures:
- Node.js, Bun, PM2, Go 1.24
- PostgreSQL 15, Meilisearch
- Nginx reverse proxy
- UFW firewall

### Deploy Code

Run from your local machine to deploy updates:

```bash
./deploy/deploy.sh root@your-server
```

This will:
- Sync code via rsync (excludes ml/, scrapers/, node_modules/)
- Build frontend (`bun install` + `bun run build`)
- Build backend (`go build`)
- Apply database migrations
- Restart PM2 processes

### Sync Data

Copy database and rebuild search index:

```bash
# Sync PostgreSQL and rebuild Meilisearch index
./deploy/sync-data.sh root@your-server

# PostgreSQL only
./deploy/sync-data.sh root@your-server --pg-only

# Rebuild Meilisearch index only
./deploy/sync-data.sh root@your-server --meili-only
```

### SSL Certificate

After initial setup, configure SSL:

```bash
ssh root@your-server
certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

## Environment Variables

### Backend (.env)

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/pharma_search
MEILI_URL=http://localhost:7700
MEILI_API_KEY=your_key
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:50051
```

## License

Private - All rights reserved
