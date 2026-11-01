# App improvements — implementation record

Scope: implement the November 1 audit in `APP_EVALUATION.md`, preserving the
existing workspace changes and catalog/account history. Baseline workspace saved
under `cache/implementation-before/`. No subagents are authorized in this session.

Status: implemented, catalog synced, production activation and live HTTP checks passed.

## Work sequence

- [x] Conservative, versioned exact SKU identity; separate family identity;
      reviewed brand aliases; preserve pack/form/strength/size/stage/flavor.
- [x] Additive catalog schema and rebuild command; source offer IDs, stock
      provenance, catalog-wide observations/history and safe legacy watch handling.
- [x] Complete PostgreSQL SKU search, all filters before paging, precise totals
      and facets, bounds/deadlines, stable ordering, cache generation and coalescing.
- [x] Query intent, numeric/formulation qualifiers, explicit spelling correction,
      useful prefix autocomplete and matching evaluation cases.
- [x] Shared featured/search/mobile/detail/watch identities and offer eligibility;
      summary payloads with complete offers on demand; list mode retains all offers.
- [x] One saved-product API, list-mode watch IDs, safe price-history/alert behavior.
- [x] Accessible autocomplete, stale-request guards, URL filters/sort/view/paging,
      per-offer age, honest stock/location/savings copy and optional unit prices.
- [x] Consent-controlled privacy-preserving analytics; actual completion counts,
      latency and query/rank attribution for clicks.
- [x] Server-rendered product/category/family pages, canonical URLs, sitemap,
      robots and structured product/offer metadata; Serbian language and copy.
- [x] Per-source run persistence/freshness watchdog; complete-pipeline scheduling
      on the scraper host; preserve successful source snapshots and raw observations.
- [x] Lint fixes, CI, extraction/search/grouping regression fixtures and load checks.
- [x] Backfill and evaluate split/merge changes against the refreshed catalog;
      validate local/production settings, safe sync/deployment and rollback.

## Design decisions

- Continue using PostgreSQL. New materialized SKU keys let the database page
  complete SKU candidates and aggregate eligible offers without a 5,000-offer cap.
- Keep original source titles and previous observations. Unknown metadata never
  becomes an asserted match to a sibling. Only exact units are converted.
- Preserve legacy group references. Migrate only unambiguous mappings; ambiguous
  watches require product review and cannot generate misleading alerts.
- Default current-offer eligibility: positive price, not explicitly unavailable,
  and a price observation within seven days (configurable).
- Technical changes must not add or infer seller delivery costs, branch stock,
  GTINs, medical equivalence or historical prices that the sources do not supply.

Update this record with completed checks, remaining work and rollout details.

## Verification and operating limits

- Go unit tests and vet pass. PostgreSQL integration fixtures cover exact brands,
  packs/forms/strengths, stale offers, diaper sizes versus weight ranges, complete
  comparisons, watch parity, unpublished imports and results beyond 5,000 SKUs.
- 37 scraper tests pass, including a real isolated-database import fixture for
  stable listing IDs, distinct same-title variants, legacy CSVs and delisting.
- TypeScript, ESLint (zero warnings), and local/production frontend builds pass.
  GitHub Actions runs these checks against PostgreSQL 15 and regenerates protobufs.
- The real sync SQL was rehearsed in a disposable database. Account/target/history
  preservation, idempotent observation replay and forced-failure rollback passed.
- Synthetic query replay and four-worker/32-request latency samples are retained
  in `evaluation-after.json`. These are not user-traffic or global accuracy metrics.
- Browser automation inventory has no enabled browsers/apps. HTTP/HTML checks
  cover SSR, canonical/structured metadata, filters, cursors, validation and sitemap;
  visual layout and interactive keyboard/touch behavior remain unverified in a browser.
- Five sources still return external failures: Apoteka Net (403), Apotekar Online
  (503/paused), Azgard (402), Apoteka Shop (522), and Jugofarm (maintenance).
  Their failures are recorded; current comparisons exclude stale/unavailable offers.
- Delivery costs and branch inventory are not supplied by these sources and are
  not inferred. Unconfirmed identities remain individual offers. Existing ambiguous
  saved items are retained for review; their alerts are paused.
- Analytics now uses optional first-party aggregate events only. No Google
  Analytics code is loaded. Queries/product names/links are excluded from events;
  server access logs are configured to omit query strings and referrers.
- Nightly full pipeline installed as `rs.aposteka.catalog`, 03:00 Belgrade, on this
  Mac with production sync enabled; an independent `rs.aposteka.health` check runs
  at 12:00 daily. The Mac/local database must remain available.

## Catalog refresh

The v2 importer retained distinct source listings instead of deduplicating mutable
names. The refreshed catalog has 239,029 offers across 187,601 active SKU/offer
identities; 146,270 offers have conservative comparable identities, with 17,367
multi-vendor SKUs. 22,094 legacy keys map to more than one SKU and are not guessed
into a single watch. These counts describe model coverage, not measured precision.
A separate family identity supports related products without comparing their prices
as equivalent packs. Source titles and immutable observations remain inspectable.

## Rollout and rollback

Migrations 018–021 are additive apart from replacing the mutable title uniqueness
rule with source identity. Production migration ownership and application grants
were verified. Builds run in `/var/www/pharma-search-releases/`; the original app
folder remains available. Activation stores private previous PM2 definitions in
`rollback.json`, checks health and restarts only the two app processes. The sync
backs up the complete production database before changing catalog rows. Do not
restore a full backup over newer account activity; recover catalog tables selectively
if a data rollback is needed. Price/watch/history accounts are never imported from
local development data.

## Live verification — November 1

- Live HTTPS smoke checks passed: search intent/filters, complete SKU details,
  cursor pagination, malformed request rejection, SSR home/product/family/category
  pages, canonical pagination, structured product metadata, robots, sitemap and hero.
- PostgreSQL 15 production replay: all 31 audited queries ran; reviewed regression
  and search/watch parity checks had zero failures. Four workers issued 32 synthetic
  requests: median 77.5 ms, p95 288.2 ms, maximum 288.2 ms. These are server-side CLI
  samples, not browser or external-network latency. Prefix autocomplete timings and
  first-request query measurements are in `evaluation-production.json`.
- Published catalog generation: `072a5c1c-6e9d-4e7d-a9c6-646d25b0715a`; dictionary fingerprint: `cd9199a67cfc8f65`.
  Current eligible offers: 238,594, across 187,282 SKU/offer identities.
- Nginx logging privacy patch passed configuration validation and was reloaded.
  TLS configuration was preserved. The full pipeline LaunchAgent was loaded and
  the host timezone was verified as Europe/Belgrade.

Final active release: `/var/www/pharma-search-releases/source-c75f4e3e7726e075-20261101215723`.
Runtime source fingerprint `source-c75f4e3e7726e075` matches local sources. Both PM2 apps are online
with zero restarts after activation. The previous working release is retained for
rollback. Temporary previews and failed preparation directories were cleaned up.

The fresh-database CI sequence was also executed locally: all migrations, synthetic
catalog seed, rebuild, backend/frontend startup, and the HTTP/SSR smoke checks passed.
GitHub Actions is configured to run on pushes and pull requests. The implementation,
regression fixtures, and verification records are included in this change.
