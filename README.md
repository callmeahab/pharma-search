# Pharma Search - Pharmaceutical Product Search System

A full-stack application for searching and comparing pharmaceutical product prices with intelligent normalization for Serbian language support.

## Features

- **Intelligent Product Normalization**: Handles Serbian/English mixed text, extracts dosages, quantities, and brands
- **Semantic Search**: Uses multilingual embeddings for finding similar products
- **Fuzzy Matching**: Handles typos and variations in product names
- **Product Grouping**: Groups similar products for easy price comparison
- **Real-time Search**: Fast API with pre-built search indexes

## Tech Stack

- **Backend**: Python 3.12, FastAPI, PostgreSQL, Sentence Transformers, FAISS
- **Frontend**: Next.js 15 with React 19 (minimal implementation)

## Setup

### Prerequisites

- Docker and Docker Compose
- Python 3.12+
- Node.js 22+

### Quick Start

1. Clone the repository
2. Create `.env` files in both backend and frontend directories
3. Run with Docker Compose:

\`\`\`bash
docker-compose up
\`\`\`

4. Process products:

\`\`\`bash
docker-compose exec backend python scripts/process_products.py
\`\`\`

5. Access the application:
   - Frontend: http://localhost:3000
   - API: http://localhost:8000/docs
   -

### Manual Setup

#### Backend

\`\`\`bash
cd backend
pip install -r requirements.txt
python scripts/process_products.py
uvicorn src.api:app --reload
\`\`\`

#### Frontend

\`\`\`bash
cd frontend
npm install
npm run dev
\`\`\`

## API Endpoints

- `GET /api/search` - Search products
  - Query params: `q` (required), `limit`, `offset`, `min_price`, `max_price`
- `POST /api/process` - Trigger product processing

## Product Processing

The system processes products through several steps:

1. **Text Normalization**: Cleans and standardizes product names
2. **Attribute Extraction**: Extracts brand, dosage, quantity, form
3. **Group Creation**: Groups similar products together
4. **Search Index**: Builds semantic and fuzzy search indexes

## Examples

Search queries that work well:

- "vitamin d" - finds all Vitamin D variants
- "omega 3" - finds all Omega-3 products
- "креатин" - Serbian search works too
- "whey protein 2kg" - specific searches with attributes
