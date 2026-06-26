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

### Fetching Pharmacy/Shop Locations Locally

Place data is fetched from the dev machine and stored in the local PostgreSQL
database; nothing is scheduled or run on the production server. The importer can
combine OpenStreetMap/Overpass, TomTom Search, and Foursquare Places, then stores
normalized rows in `VendorPlace`.

```bash
# Preview one vendor without writing rows
VENDOR=Benu DRY_RUN=1 make fetch-places

# Fetch places for every vendor with priced products using the default sources
make fetch-places

# Run only free OSM/Overpass matching
SOURCES=osm make fetch-places

# Try TomTom for one vendor without writing rows
SOURCES=tomtom VENDOR=Benu DRY_RUN=1 make fetch-places

# Use all local sources explicitly
SOURCES=osm,tomtom,foursquare make fetch-places

# Useful local knobs
MAX_VENDORS=5 make fetch-places
CONTINUE_ON_ERROR=1 make fetch-places
COVERAGE_BOUNDS="42.2322,18.8170,46.1900,23.0063" MAX_SPLIT_DEPTH=8 LIMIT=50 SLEEP=250ms make fetch-places
```

The command loads `.env`, applies migrations, then runs `go run ./cmd/fetchplaces`.
`PLACE_SOURCES` defaults to `osm,tomtom,foursquare`. OSM does not need an API
key. TomTom uses `TOMTOM_API_KEY`; Foursquare uses `FOURSQUARE_API_KEY`. If a
paid source is selected without a key and another source is available, the run
logs a warning and continues. Set `PLACE_REQUIRE_ALL_SOURCES=true` to fail fast
instead.

OSM is fetched with one Serbia administrative-area Overpass query, cached at
`cache/osm-places-serbia-v2.json`, then matched locally against every vendor.
Set `OSM_REFRESH=1` to force a fresh Overpass pull.

TomTom searches by vendor name across Serbia with `countrySet=RS`, the Serbia
bounds, `limit=100`, paged offsets, and `openingHours=nextSevenDays` when
available. Increase `TOMTOM_MAX_PAGES` if a vendor reports capped TomTom
results.

Foursquare searches by vendor name across Serbia using recursive Foursquare
bounding boxes. If a box returns Foursquare's 50-result maximum, the importer
splits the box and searches again, then deduplicates by Foursquare place id. If
any smallest box still hits the limit, the source is treated as incomplete so
stale locations are not trusted as complete. Successful complete vendor sweeps
prune stale cached locations for that vendor/source.

The importer keeps pharmacies, drugstores, and relevant supplement/health shops,
then prunes cached places that no longer look relevant. It also requests the
place photos field and stores Foursquare's full-resolution photo URL metadata
locally with the pharmacy/shop record. If you want to override the requested
Foursquare fields, include `photos` to keep place images available:

```bash
FIELDS=fsq_place_id,name,latitude,longitude,categories,location,tel,website,hours,photos make fetch-places
```

To deliberately prefilter Foursquare requests locally, override category IDs.
This is faster and cheaper, but can miss supplement shops that Foursquare does
not classify as Pharmacy/Drugstore:

```bash
CATEGORY_IDS=4bf58dd8d48988d10f951735,5745c2e4498e11e7bccabdbd make fetch-places
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
