# SQL Migration Files

This directory contains SQL files for setting up and enhancing the pharmaceutical search functionality.

## Files

### 1. `init.sql`
Initial database schema setup. This is run during the first deployment.

### 2. `optimize_search_indexes.sql` 
Basic database indexes for search performance. Run after schema setup.

### 3. `enhanced_search_functions.sql`
**IMPORTANT**: This file contains all the enhanced search functionality including:
- Pharmaceutical abbreviation expansion (vitc → vitamin c)
- Fuzzy search with trigram matching
- Enhanced relevance scoring
- Dosage-aware search functions
- Required PostgreSQL extensions (pg_trgm, fuzzystrmatch)

## Deployment Order

1. First deployment: `init.sql` (handled by Prisma migrations)
2. After schema setup: `optimize_search_indexes.sql` 
3. **MUST RUN**: `enhanced_search_functions.sql` (contains all search improvements)

## Notes

- `enhanced_search_functions.sql` must be run on every deployment to ensure search functions are up to date
- The file is safe to run multiple times (uses `IF NOT EXISTS` and `CREATE OR REPLACE`)
- Extensions `pg_trgm` and `fuzzystrmatch` are automatically enabled