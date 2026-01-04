-- Migration: 000_extensions
-- PostgreSQL extensions required for the application

-- Support for indexing common datatypes in GIN
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;

-- Determine similarities and distance between strings
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;

-- Text similarity measurement and index searching based on trigrams
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- Generate universally unique identifiers (UUIDs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
