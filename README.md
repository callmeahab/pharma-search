# Pharma Search

Pharmaceutical product price comparison platform for Serbia. Aggregates prices from 80+ pharmacies and supplement stores with intelligent product grouping.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   Next.js   │────▶│  Go + ConnectRPC │────▶│ PostgreSQL  │
│  Frontend   │     │     Backend      │     │  (pg_trgm)  │
└─────────────┘     └─────────────────┘     └─────────────┘
```

Search runs in PostgreSQL (`pg_trgm` trigram + ILIKE + concept token matching) — no external search service. Grouping is computed at query time by `internal/matching`.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 15, React 19, TailwindCSS, shadcn/ui |
| Backend | Go 1.24, ConnectRPC |
| Database | PostgreSQL 16 |
| Search | PostgreSQL `pg_trgm` (trigram + concept matching) |
| Scrapers | Puppeteer, Bun |
| ML | Python 3.12 (deterministic rules + mined dictionaries) |

## Local Development

### Prerequisites

- VS Code with Dev Containers extension
- Docker Desktop

### Quick Start

1. Open project in VS Code
2. Click "Reopen in Container" when prompted
3. Wait for setup to complete

The devcontainer automatically:
- Starts PostgreSQL
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
| `Search` | Product search via PostgreSQL `pg_trgm` |
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

Product enrichment comes from lookup tables (`ProductStandardization`) plus deterministic
normalization rules over the LLM-mined shared dictionaries in `internal/matching/data/`.

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

### Populate Database

Extract entities from product titles (deterministic rules + the shared dictionaries
in `internal/matching/data/`) and update the database:

```bash
# Show stats and sample extractions (dry run)
python populate_missing_data.py --dry-run

# Process products with missing data
python populate_missing_data.py

# Re-process all products
python populate_missing_data.py --all

# Limit number of products
python populate_missing_data.py --limit 1000
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
- PostgreSQL 15
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

Copy the catalog database to the server (account/watchlist tables are preserved):

```bash
./deploy/sync-data.sh root@your-server
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
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://localhost:50051
```

## License

Private - All rights reserved
