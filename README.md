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
# Frontend (port 3000)
cd frontend && bun dev

# Backend (port 50051)
go run .

# Scrapers
cd scrapers && bun start
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

Four core tables:

| Table | Purpose |
|-------|---------|
| Vendor | Pharmacy/store metadata |
| Product | Scraped products with prices |
| ProductGroup | Grouped similar products |
| ProductStandardization | ML-extracted attributes |

### Migrations

```bash
# Apply migrations (in devcontainer)
for f in migrations/*.sql; do psql -d pharma_search -f "$f"; done

# Seed data
psql -d pharma_search -f migrations/seed/vendors.sql
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

## ML Pipeline

Extracts structured data from product titles:

```
Input:  "VITAMIN D3 2000IU 60 KAPSULA"
Output: { name: "Vitamin D3", dosage: 2000, unit: "IU", quantity: 60, form: "kapsula" }
```

### Training

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python train_ner.py
```

### Batch Processing

```bash
python batch_processor.py  # Processes new products
```

## Deployment

Server deployment scripts in `deploy/`:

```bash
# Full deployment
./deploy/01-system-setup.sh      # System packages
./deploy/02-postgresql-setup.sh  # Database
./deploy/02a-apply-migrations.sh # Migrations
./deploy/03-app-setup.sh         # Go backend
./deploy/04-nginx-setup.sh       # Reverse proxy
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
