# Scheduling the scrapers

The scrapers do **not** run themselves. Before this, the catalog froze for ~2
months because nothing scheduled them. Schedule the **full pipeline**
(`run-pipeline.sh` = scrape → import-csv → postprocess) — NOT `bun start`, which
only writes CSVs and never updates the DB.

## Where does this run?

The scraper host needs: Bun, headless Chromium deps (puppeteer), and
`DATABASE_URL` pointing at the catalog DB. Pick one:

- **Dedicated scraper host / the dev box** (recommended): run the pipeline there
  against the production `DATABASE_URL` (or a local DB + `deploy/sync-data.sh`).
- **The prod server**: note `deploy/deploy.sh` currently rsync-excludes `scrapers`
  and `scrapers_logs`, so they aren't shipped there. You'd remove those excludes
  and install Chromium — but Puppeteer competing with the app on a small box is
  risky. Prefer a separate host.

## Install (systemd, as root on the scraper host)

```bash
# Set the host timezone so 03:00 means Belgrade time:
timedatectl set-timezone Europe/Belgrade

cp deploy/scrapers/pharma-scrapers.service /etc/systemd/system/
cp deploy/scrapers/pharma-scrapers.timer   /etc/systemd/system/
# Edit the .service: User, WorkingDirectory, SCRAPERS_DIR, and (optional)
# SCRAPER_ALERT_WEBHOOK for failure alerts.

systemctl daemon-reload
systemctl enable --now pharma-scrapers.timer
systemctl list-timers pharma-scrapers.timer     # confirm next run

# Run once now to verify:
systemctl start pharma-scrapers.service
journalctl -u pharma-scrapers.service -f
```

## Crontab alternative

```cron
0 3 * * * SCRAPERS_DIR=/path/to/scrapers SCRAPER_ALERT_WEBHOOK=https://hooks.slack.com/... /path/to/deploy/scrapers/run-pipeline.sh >> /var/log/pharma-scrapers.log 2>&1
```

## Alerting & freshness

- The worker exits non-zero and POSTs to `SCRAPER_ALERT_WEBHOOK` when the failure
  rate exceeds `SCRAPER_FAILURE_ALERT_RATIO` (default 0.10). With systemd, also add
  an `OnFailure=` handler or rely on the webhook.
- **Freshness watchdog** (catch a stuck/disabled timer): alert if the newest
  output CSV is older than ~36h, e.g. a separate daily cron:
  ```bash
  find /path/to/scrapers/output -name '*.csv' -mtime -2 | grep -q . \
    || curl -s -X POST "$SCRAPER_ALERT_WEBHOOK" -d '{"text":"⚠️ scrapers: no fresh CSV in 48h"}'
  ```

## Tuning env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `SCRAPER_CONCURRENCY` | 6 | parallel scrapers |
| `SCRAPER_RETRIES` | 1 | retries (only transient *errors* are retried now) |
| `SCRAPER_TIMEOUT_MS` | 900000 | per-scraper timeout (15m) |
| `SCRAPER_FAILURE_ALERT_RATIO` | 0.1 | failure rate that triggers alert + non-zero exit |
| `SCRAPER_ALERT_WEBHOOK` | — | Slack-style webhook for failures |
| `IMPORT_DELIST_MIN_RATIO` | 0.5 | skip delisting a vendor if its fresh snapshot is < this × stored count (broken-scrape guard) |
| `CLEANUP_MAX_ZERO_RATIO` | 0.5 | skip zero-price cleanup for a vendor above this zero ratio (broken-selector guard) |
