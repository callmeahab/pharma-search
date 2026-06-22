-- Migration: 009_accounts_and_alerts
-- User accounts, sessions, one-time auth tokens, watchlist + price alerts, and
-- vendor contact enrichment. Independent of the catalog tables (no FKs into
-- Product/ProductStandardization), so a catalog-only data reload won't touch them.

-- ---- Accounts ----
CREATE TABLE IF NOT EXISTS "User" (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email           text NOT NULL,
    name            text,
    "passwordHash"  text,                 -- null for OAuth / magic-link-only users
    "googleSub"     text,                 -- Google subject id
    "emailVerified" boolean NOT NULL DEFAULT false,
    "createdAt"     timestamptz NOT NULL DEFAULT now(),
    "updatedAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON "User" (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_google ON "User" ("googleSub") WHERE "googleSub" IS NOT NULL;

-- Opaque session tokens (only the sha256 hash is stored).
CREATE TABLE IF NOT EXISTS "Session" (
    "tokenHash" text PRIMARY KEY,
    "userId"    text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "userAgent" text,
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "expiresAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_user ON "Session" ("userId");

-- One-time tokens for magic-link login, password reset, email verification.
CREATE TABLE IF NOT EXISTS "AuthToken" (
    "tokenHash" text PRIMARY KEY,
    email       text NOT NULL,
    purpose     text NOT NULL,            -- magic_login | password_reset | verify_email
    "userId"    text,
    "expiresAt" timestamptz NOT NULL,
    "usedAt"    timestamptz,
    "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_authtoken_email ON "AuthToken" (lower(email), purpose);

-- ---- Watchlist + price alerts ----
-- A watch targets a product GROUP (matching.BuildGroupKey output), so it tracks
-- the cheapest offer across all pharmacies.
CREATE TABLE IF NOT EXISTS "Watch" (
    id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId"        text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "groupKey"      text NOT NULL,
    "displayName"   text,
    "thumbnail"     text,
    "targetPrice"   double precision,     -- optional: alert when cheapest <= this
    "lastPrice"     double precision,     -- cheapest seen at last check (diff baseline)
    "lastVendor"    text,
    "lastInStock"   boolean,
    "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_user_group ON "Watch" ("userId", "groupKey");
CREATE INDEX IF NOT EXISTS idx_watch_group ON "Watch" ("groupKey");

-- Snapshots of the cheapest price per (watched) group over time — powers alerts
-- and price-history sparklines.
CREATE TABLE IF NOT EXISTS "GroupPriceHistory" (
    id           bigserial PRIMARY KEY,
    "groupKey"   text NOT NULL,
    "minPrice"   double precision NOT NULL,
    "offerCount" integer NOT NULL DEFAULT 0,
    "recordedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gph_group_time ON "GroupPriceHistory" ("groupKey", "recordedAt");

-- Sent alerts (dedupe + user-facing notification history).
CREATE TABLE IF NOT EXISTS "AlertEvent" (
    id         bigserial PRIMARY KEY,
    "watchId"  text NOT NULL REFERENCES "Watch"(id) ON DELETE CASCADE,
    "userId"   text NOT NULL,
    kind       text NOT NULL,             -- drop | new_low | target | back_in_stock
    "oldPrice" double precision,
    "newPrice" double precision,
    "vendor"   text,
    "sentAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alertevent_user ON "AlertEvent" ("userId", "sentAt");

-- ---- Vendor contact enrichment ----
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS hours text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "mapsUrl" text;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "contactUpdatedAt" timestamptz;
