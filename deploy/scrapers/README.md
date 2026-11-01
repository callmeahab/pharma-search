# Catalog pipeline and scheduling

`run-pipeline.sh` runs migrations → scrapers → CSV import → cleanup → extraction
→ categories → optional canonicalization → atomic SKU publication → source health
→ optional production sync. Schedule this script, rather than the CSV-only worker.

The current scraper host is `/Users/ahab/pharma-search`. A LaunchAgent named
`rs.aposteka.catalog` is installed for **03:00 Europe/Belgrade**, with `SYNC=1`.
An independent `rs.aposteka.health` watchdog is loaded for 12:00 daily and writes
`cache/scheduled-source-health.json`, so monitoring does not depend on pipeline completion.
Both run as the logged-in Mac user; the Mac and local PostgreSQL must be available.
Launchd handles missed calendar starts on wake. Logs are in `cache/scheduled-pipeline*.log`.

```bash
# Reinstall/update the existing job; does not start a scrape immediately.
bash deploy/scrapers/install-macos-schedule.sh
launchctl print gui/$(id -u)/rs.aposteka.catalog
# Manual full run:
SYNC=1 SKIP_CANONICALIZE=1 bash deploy/scrapers/run-pipeline.sh
# Independent per-source watchdog (exits nonzero on stale or failed sources):
cd scrapers && bun catalog-health.ts --check
```

Linux alternatives are `pharma-scrapers.service` and `pharma-scrapers.timer`.
Adjust paths/user before installing; the timer explicitly uses Europe/Belgrade.
Scraping remains separate from the small production app server. No outbound
notification destination is configured by the installer.

Each worker attempt writes status/count/timestamps into `output/.runs/`, imported
into `ScraperRun` by `catalog-health.ts`. The report distinguishes each source's
latest attempt from its latest price observation; one successful vendor cannot
hide another vendor's outage. The public `/api/catalog/status` also reports source
freshness and recorded attempts. `SOURCE_FRESHNESS_HOURS` defaults to 36 for the
watchdog; current price eligibility uses `OFFER_MAX_AGE` (default `168h`).

Failed, blocked, incomplete and timed-out snapshots retain the previous CSV.
Successful CSVs are validated in `.pending/` and renamed into place. A worker's
failure threshold does not prevent the full pipeline from importing successful
sources: it publishes healthy snapshots and returns a failing health status at
the end. Interrupted workers and import/enrichment failures stop publication.
A PID lock prevents concurrent pipelines and recovers abandoned process locks.

CSV v2 appends `availability,sourceProductId,gtin` after the original eight fields.
The importer still accepts complete legacy eight-column snapshots. Stock defaults
to **unknown**; positive prices do not establish stock. Shopify variants retain
separate URLs, titles and supplied barcodes. Listings are identified by vendor
plus source ID, so title edits preserve IDs and same-title variants survive.
Missing products in a sufficiently complete snapshot create `OfferLifecycle`
evidence before delisting. `IMPORT_DELIST_MIN_RATIO` defaults to 0.5.

Imports/enrichment change raw `Product` rows. Customers read `CatalogOffer`, which
changes only in the rebuild transaction along with SKU metadata and publication
version. Observations/history survive source delisting and production syncs.

Useful controls: `SKIP_SCRAPE=1`, `SKIP_EXTRACT=1`, `SKIP_CATEGORIZE=1`,
`SKIP_CANONICALIZE=1`, `SCRAPER_FILTER=a.ts,b.ts`, `SCRAPER_CONCURRENCY`,
`SCRAPER_TIMEOUT_MS`, `SCRAPER_RETRIES`, and `SCRAPER_OUTPUT_DIR`.
The canonicalizer is optional enrichment and is not used to assert SKU identity.
