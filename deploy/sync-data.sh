#!/usr/bin/env bash
# Atomic publication of catalog tables; append observations and preserve accounts.
# Additive migrations must already be installed by deploy.sh or cmd/migrate.
set -euo pipefail
SERVER=pharma
for arg in "$@"; do
  case "$arg" in --skip-schema) ;; --*) echo "Unknown option: $arg" >&2; exit 1;; *) SERVER="$arg";; esac
done
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${DATABASE_URL:-}" && -f "$REPO_ROOT/.env" ]]; then
 set -a; source "$REPO_ROOT/.env"; set +a
fi
LOCAL_DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
WORK_DIR="$(mktemp -d /tmp/pharma-sync.XXXXXX)"
REMOTE_DIR=""
cleanup() {
  if [[ -n "$REMOTE_DIR" ]]; then ssh -o BatchMode=yes "$SERVER" "rm -rf -- '$REMOTE_DIR'" || true; fi
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT
CORE=(Vendor VendorPlace ProductStandardization CatalogSku Product CatalogLexeme CatalogSuggestion CatalogOffer CatalogPublication)
HISTORY=(CatalogRun ScraperRun OfferPriceObservation CatalogPriceHistory CatalogIdentityAlias OfferLifecycle)
DUMP_ARGS=()
for table in "${CORE[@]}"; do DUMP_ARGS+=(--table="public.\"$table\""); done
psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -c 'DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM "CatalogPublication") OR NOT EXISTS(SELECT 1 FROM "CatalogOffer") THEN RAISE EXCEPTION '\''No published catalog'\''; END IF; END $$;' >/dev/null
pg_dump "$LOCAL_DB_URL" --data-only --no-owner --no-privileges "${DUMP_ARGS[@]}" -f "$WORK_DIR/data.sql"
sed -i.bak -e '/^SET transaction_timeout/d' -e '/^SET statement_timeout/d' -e '/^SET lock_timeout/d' -e '/^\\restrict/d' -e '/^\\unrestrict/d' "$WORK_DIR/data.sql"
rm "$WORK_DIR/data.sql.bak"
cat > "$WORK_DIR/prepare.sql" <<'SQL'
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';
SELECT pg_advisory_xact_lock(hashtext('pharma-catalog-rebuild'));
CREATE TEMP TABLE preserved_account_counts AS SELECT
 (SELECT count(*) FROM "User") users,(SELECT count(*) FROM "Watch") watches,
 (SELECT count(*) FROM "GroupPriceHistory") legacy_history;
-- MVCC deletes let readers keep the previous publication until commit.
DELETE FROM "VendorPlace";
DELETE FROM "ProductStandardization";
DELETE FROM "Product";
DELETE FROM "CatalogOffer";
DELETE FROM "CatalogSku";
DELETE FROM "CatalogLexeme";
DELETE FROM "CatalogSuggestion";
DELETE FROM "CatalogPublication";
DELETE FROM "Vendor";
SQL
echo 'SET LOCAL search_path=public,pg_catalog;' > "$WORK_DIR/history.sql"
for table in "${HISTORY[@]}"; do
  # Serial observation IDs belong to each DB; merge by natural unique keys.
  columns=$(psql "$LOCAL_DB_URL" -XAt -v ON_ERROR_STOP=1 -c "SELECT string_agg(quote_ident(column_name),',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='$table' AND COALESCE(column_default,'') NOT LIKE 'nextval%'")
  [[ -n "$columns" ]] || { echo "Missing schema: $table" >&2; exit 1; }
  psql "$LOCAL_DB_URL" -X -v ON_ERROR_STOP=1 -c "\copy (SELECT $columns FROM \"$table\") TO '$WORK_DIR/$table.csv' CSV" >/dev/null
  printf 'CREATE TEMP TABLE sync_%s (LIKE "%s" INCLUDING DEFAULTS);\n' "$table" "$table" >> "$WORK_DIR/history.sql"
  printf '\\copy sync_%s (%s) FROM '\''%s.csv'\'' CSV\n' "$table" "$columns" "$table" >> "$WORK_DIR/history.sql"
  if [[ "$table" == CatalogIdentityAlias ]]; then
    printf 'INSERT INTO "%s" (%s) SELECT %s FROM sync_%s WHERE true ON CONFLICT(legacy_key) DO UPDATE SET sku_id=EXCLUDED.sku_id,candidate_count=EXCLUDED.candidate_count,reviewed_at=EXCLUDED.reviewed_at WHERE EXCLUDED.reviewed_at>="CatalogIdentityAlias".reviewed_at;\n' "$table" "$columns" "$columns" "$table" >> "$WORK_DIR/history.sql"
  else
    printf 'INSERT INTO "%s" (%s) SELECT %s FROM sync_%s WHERE true ON CONFLICT DO NOTHING;\n' "$table" "$columns" "$columns" "$table" >> "$WORK_DIR/history.sql"
  fi
done
cat > "$WORK_DIR/validate.sql" <<'SQL'
-- Migrate only unique legacy identities; retain ambiguous watches for review.
UPDATE "Watch" w SET "groupKey"=a.sku_id,"lastPrice"=NULL,needs_review=false,review_reason=NULL
FROM "CatalogIdentityAlias" a WHERE w."groupKey"=a.legacy_key AND a.candidate_count=1 AND a.sku_id IS NOT NULL

AND w.id=(SELECT min(candidate.id) FROM "Watch" candidate JOIN "CatalogIdentityAlias" ca ON ca.legacy_key=candidate."groupKey" WHERE candidate."userId"=w."userId" AND ca.sku_id=a.sku_id AND ca.candidate_count=1)
AND NOT EXISTS(SELECT 1 FROM "Watch" o WHERE o."userId"=w."userId" AND o."groupKey"=a.sku_id AND o.id<>w.id);
UPDATE "Watch" SET needs_review=true,review_reason='Izaberite tačan proizvod i pakovanje da biste nastavili praćenje.'
WHERE "groupKey" NOT LIKE 'sku:v2:%' AND "groupKey" NOT LIKE 'offer:v2:%';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM preserved_account_counts p WHERE p.users<>(SELECT count(*) FROM "User") OR p.watches<>(SELECT count(*) FROM "Watch") OR p.legacy_history<>(SELECT count(*) FROM "GroupPriceHistory")) THEN RAISE EXCEPTION 'Account/history count changed'; END IF;
 IF EXISTS(SELECT 1 FROM "CatalogOffer" p LEFT JOIN "CatalogSku" s ON s.id=p.sku_id LEFT JOIN "Vendor" v ON v.id=p."vendorId" WHERE s.id IS NULL OR v.id IS NULL) THEN RAISE EXCEPTION 'Orphaned offers'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "CatalogPublication" p JOIN "CatalogRun" r ON r.id=p.run_id WHERE r.status='ok') THEN RAISE EXCEPTION 'Invalid publication'; END IF;
END $$;
SQL
for table in "${CORE[@]}"; do
 count=$(psql "$LOCAL_DB_URL" -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM \"$table\"")
 printf 'DO $$ BEGIN IF (SELECT count(*) FROM "%s")<>%s THEN RAISE EXCEPTION '\''%s count mismatch'\''; END IF; END $$;\n' "$table" "$count" "$table" >> "$WORK_DIR/validate.sql"
done
if [[ -n "${SYNC_EXPORT_DIR:-}" ]]; then
 mkdir -p "$SYNC_EXPORT_DIR"
 cp "$WORK_DIR/"*.sql "$WORK_DIR/"*.csv "$SYNC_EXPORT_DIR/"
 echo "Exported reviewable sync transaction to $SYNC_EXPORT_DIR"
 exit 0
fi
REMOTE_DIR=$(ssh -o BatchMode=yes "$SERVER" 'mktemp -d /tmp/pharma-sync.XXXXXX')
[[ "$REMOTE_DIR" =~ ^/tmp/pharma-sync\.[a-zA-Z0-9]+$ ]] || { REMOTE_DIR=""; exit 1; }
scp -Cq "$WORK_DIR/"*.sql "$WORK_DIR/"*.csv "$SERVER:$REMOTE_DIR/"
ssh -o BatchMode=yes "$SERVER" bash -s -- "$REMOTE_DIR" <<'ENDSSH'
set -euo pipefail
work_dir=$1
chmod 755 "$work_dir"
chmod 644 "$work_dir/"*
backup_dir=/var/backups/pharma-search
install -d -m 700 -o postgres -g postgres "$backup_dir"
backup_file="$backup_dir/before-catalog-$(date +%Y%m%d-%H%M%S)-$$.dump"
# Full backup provides an inspectable rollback point; normal sync never copies accounts.
sudo -u postgres pg_dump -d pharma_search -Fc -f "$backup_file"
echo "Production backup: $backup_file"
cd "$work_dir"
sudo -u postgres psql -d pharma_search -X -v ON_ERROR_STOP=1 --single-transaction \
 -f prepare.sql -f data.sql -f history.sql -f validate.sql
sudo -u postgres psql -d pharma_search -X -v ON_ERROR_STOP=1 -c 'ANALYZE "CatalogSku"; ANALYZE "CatalogOffer"; ANALYZE "CatalogLexeme"; ANALYZE "Product";'
ENDSSH
echo "Catalog published; account and legacy history counts verified."
