# Scraper / Data-Acquisition Audit — 2026-06-22

Audited all 85 registered scrapers + shared framework (multi-agent audit; broken
scrapers diagnosed against their live sites with curl). **35 of 85 scrapers are
currently broken or yield nothing** (up from the 17 that were merely silent at the
last run — rot has worsened since April).

## TL;DR
The biggest problems are **operational, not per-scraper**:
1. **Nothing schedules the scrapers** → the catalog has been frozen at 2026-04-17 for ~2 months.
2. **The worker never imports to the DB** — `npm start` only writes CSVs; the DB load lives only in the `pipeline` script. A naive cron on the documented entrypoint would refresh nothing.
3. **No alerting + always exits 0** → a 22-vendor / 2-month outage went completely unnoticed.
4. **Re-import re-applies old prices and never delists** — stale dated CSVs accumulate; stale products are never removed when a vendor re-scrapes.
5. **`deleteItemsWithoutPrice` is destructive + unscoped** — a single broken price selector permanently deletes valid products (ananas already loses ~3,750 rows/run this way).

---

## Tier 0 — Operational (do first; highest impact)

| # | Issue | Fix |
|---|-------|-----|
| 0.1 | No scheduler; data 2 months stale | systemd `pharma-scrapers.timer` (OnCalendar nightly 03:00 Europe/Belgrade, `Persistent=true`, `RandomizedDelaySec=900`) running the **full** `pipeline`, not just the worker |
| 0.2 | Worker ≠ import | Schedule the `pipeline` npm script (worker → import-csv → postprocess) end-to-end; make it exit non-zero on import failure |
| 0.3 | Silent failures, exit 0 always | Exit non-zero when >10% of scrapers fail or total products drop >X% vs last run; send a Slack/email alert listing failed vendors + product deltas; add a freshness watchdog (alert if newest CSV mtime > 36h) |
| 0.4 | Re-imports stale CSVs; no delisting | Import only the latest CSV per vendor; wrap each vendor's load in a transaction that replaces (delete-then-insert or upsert + delete-missing) that vendor's rows; clean up old dated CSVs |
| 0.5 | `deleteItemsWithoutPrice` unscoped/destructive | Scope deletes per-vendor and abort if a vendor's zero-price ratio exceeds a sane threshold (a broken selector should fail loudly, not silently delete the vendor) |
| 0.6 | Timeout kill leaves orphaned Chromium (runs to 25 min, memory leak) | `spawn(..., {detached:true})` + kill the process group; add SIGTERM handler that `browser.close()`s; `pkill -f 'chrome.*--headless'` safety net after each run |
| 0.7 | No transaction wrapping | Wrap per-vendor import in a transaction so a partial import can't tear the catalog |

## Tier 1 — Broken scrapers (35), grouped by root cause

### Retire — dead sites (4): no fix possible
`4fitness` (now a WordPress blog), `apotekamo` ("under construction"), `explode` (decommissioned placeholder), `supplements` (domain parked / for sale). → remove from worker, prune their rows.

### Uncomment — entire file is commented out (3)
`pansport` (pure uncomment — DOM still matches), `azgard` (uncomment **and** rewrite to its Shopify JSON API), `farmasi` (uncomment **and** rewrite — see below).

### One-line / selector fixes — trivial (4)
- `ringSport` — title selector `h4` → `.h4art_det a`
- `maxFarm` — link/image selectors mis-scoped (query relative to `element`, not page)
- `lama` — 9 category slugs are stale (302→home); update slugs
- `eApotekaRs` — link selector `h3 > a` → `a.link-name > h3`

### Small fixes (10)
- **`gymBeam`** (big vendor!) — price regex broke when the site flipped RSD to the primary price; read the primary RSD node instead of the `≈(… RSD)` parenthetical
- `milica` — load-more id `#load-more` → `#load-more-products` (or drive admin-ajax)
- `ogistra` — pagination slug `/2-pocetak` → `/2-katalog`
- `supplementShop` — drop `?per_page=24` (causes 404 after page 1)
- `fitnessShop` — only scrapes page 1 of 1 category; fix pagination + don't return `[]` on error
- `houseOfSupplements` — category paths moved to `/prodavnica/<slug>/`
- `ananas3` (+ ananas1/2 via shared `ananasHelper.ts`) — stop targeting styled-components build hashes; use stable selectors / embedded `__NEXT_DATA__` Algolia JSON
- `apotekaShop` — origin down (HTTP 522); recheck later, not our bug
- `spartanSuplementi` — markup changed to Elementor Woo loop; remap selectors
- `medXapoteka` / `zelenaApoteka` / `shopmania` — write CSV only once at the very end after iterating all categories → lost on timeout; **persist incrementally** (see X-cutting)

### Rewrites — site replatformed (6, medium effort)
- `apotekarOnline` → Next.js SPA (base `/proizvodi`)
- `fitLab` → Next.js SPA (`/sr/prodavnica?supplement=all`, `?page=N`)
- `proteini` → migrated to `proteinisi.rs` (WooCommerce/Woodmart)
- `atpSport` → PrestaShop→WooCommerce; use the open **Store API** (drop Puppeteer)
- `farmasi` → rewrite against `farmasi.rs` `__NEXT_DATA__` JSON (no login/klub host)
- `azgard` → Shopify products JSON API

### Anti-bot — Cloudflare challenge / 403 (6, larger effort)
`lily`, `benu`, `drMax`, `jugofarm`, `srbotrade` (all 403 `cf-mitigated: challenge`), `apotekaShop` (522 origin down). These need a Cloudflare strategy (realistic full UA + client hints, challenge-clearing, or a scraping proxy) **and** must fail loudly on a detected challenge instead of writing empty success.

## Tier 2 — Cross-cutting robustness & data quality

- **Fail-loud on empty** (70 scrapers affected): a scraper that yields 0 products currently leaves yesterday's CSV in place and is retried identically. Detect block/empty, throw, and don't import a vendor that produced nothing.
- **Incremental persistence** (7+ scrapers): write per-page/per-category, not once at the end, so a timeout doesn't discard hours of work.
- **Shared price parser** (46 scrapers; **high**): the current parser silently makes 100× errors (dot-as-thousands vs decimal ambiguity) and turns unparseable prices into `0`. Centralize a robust Serbian-format parser; treat unparseable as a hard error, not `0`.
- **Use the shared `goto`/retry helpers** — only 6 of 81 scrapers use `ScraperUtils`; the rest duplicate raw `page.goto` with hardcoded timeouts.
- **Politeness** (high): add per-site delays; the 6 `ananas*` scrapers hammer one host concurrently (defeats rate-limiting); UA strings are truncated/implausible.
- **CSV parser** (high): splits on `\n` before honoring quotes → breaks multi-line quoted titles. Use a real CSV parser.
- **Pagination** (73 scrapers flagged): the most common fragility; many hardcode page params that 404/redirect.
- **Dedupe**: importer key is case-sensitive, cleanup is case-insensitive (inconsistent identity); per-scraper dedupe is title-only and drops distinct products.

## Ordered quick wins (high value / low effort)
1. **Schedule the full `pipeline` nightly + freshness alert** (0.1–0.3) — fixes the staleness for *all* vendors at once.
2. **Fix import to delist + transaction-wrap + latest-CSV-only** (0.4, 0.7).
3. **gymBeam price regex** — big vendor, one fix.
4. **Uncomment `pansport`; selector one-liners** for `ringSport`, `maxFarm`, `eApotekaRs`, `lama`.
5. **Guard `deleteItemsWithoutPrice`** per-vendor (0.5) — stops silent data loss.
6. **Retire the 4 dead sites** so runs stop wasting time on them.
7. Centralize the **price parser** + **fail-loud** helper (kills two whole classes of bug).
8. Work through the 6 rewrites and the Cloudflare set.

*(Verdicts for 14 scrapers — ananas5/6, spartanSuplementi, supplementShop, vitaminShop, superior, shopmania, xSport, vitalikum, zelenaApoteka, maelia, srbotrade, mocBilja, medXapoteka — were cut off by a session limit; their audit findings above still stand, just without the second adversarial pass.)*

---

# Implementation status — 2026-06-22

## Done (operational + quick wins)
Scheduling (`deploy/scrapers/`), worker hardening (process-group kill, fail-loud
exit + webhook alert, status-aware retry, Chrome reaper), importer rewrite
(latest-CSV-per-shard, per-vendor transaction + delisting with a broken-scrape
guard — validated on 104,782 rows), per-vendor guard on `deleteItemsWithoutPrice`,
`pansport` uncommented, selector/slug fixes (`ringSport`, `eApotekaRs`, `maxFarm`,
`lama`, `gymBeam`), 4 dead sites retired.

## Replatform rewrites
New shared `helpers/apiScrapers.ts` (WooCommerce Store API + Shopify products.json,
fetch-based, fail-loud). Each rewritten scraper is now a thin call.

| Scraper | New source | Status |
|---|---|---|
| **proteini** | proteinisi.rs WooCommerce Store API | ✅ verified — 329 products |
| **fitLab** | fitlab.rs WooCommerce Store API | ✅ verified — 973 products |
| **atpSport** | atpsport.rs WooCommerce Store API | ⏳ written; verify on a host where atpsport.rs resolves (didn't resolve from dev sandbox) |
| **azgard** | azgard.rs Shopify products.json | ⏳ written; verify on a host where azgard.rs resolves |
| **apotekarOnline** | Vercel/Next app-router, **Supabase** backend (`yltpwsiwalqrekupglvm.supabase.co`) | ⛔ deferred — products fetched server-side (anon key never reaches the browser; results arrive as RSC). Path: capture the Supabase anon key + table via browser devtools → query `…supabase.co/rest/v1/<table>?select=*` with `apikey` header; OR parse the RSC `self.__next_f` flight chunks (product objects with id/sku/name/brand/category/price/image are present). |
| **farmasi** | global `content.farmasi.com` platform (region-gated) | ⛔ deferred — `content.farmasi.rs/api/*` returns 403; client-fetched, GUID-based catalog. Path: capture the authenticated product XHR in browser devtools, then a fetch scraper. Lower priority (cosmetics/MLM). |

## Cloudflare-blocked set
Shared improvements in `helpers/ScraperUtils.ts`: full current Chrome UA + matching
client hints (`sec-ch-ua`), and a new `assertNotBlocked(page)` that throws on a CF
managed challenge / "you have been blocked" wall. Wired into `benu`, `drMax`,
`jugofarm`, `lily`, `srbotrade` right after navigation so a block now **fails loud**
(recorded + alerted) instead of writing an empty "success".

**Reality:** a Cloudflare *managed challenge* (`cf-mitigated: challenge`) generally
cannot be cleared by stealth/UA tweaks alone — it needs a real-browser solve or a
**scraping proxy / CF-solver service** (e.g. a residential or anti-bot proxy). The
code change makes them honest (fail loud + better stealth, which may clear *some*);
actually recovering these 5 vendors requires provisioning such a proxy. `apotekaShop`
is separate — its origin is down (HTTP 522), not our problem.


---

# Coverage audit — 2026-06-23

Compared each vendor's TRUE catalog size (from its product sitemap) against what we
actually have. **67 vendors: 31 under-covered (<70%), 31 healthy (≥70%), 5 unsizable
(dead/blocked).**

**Marketplace caveat:** Ananas (~486k) and Bazzar (~252k) are general marketplaces
(furniture/tools/toys) — their huge "missing" counts are non-pharma and NOT real
addressable loss. We intentionally scrape only their health/beauty categories.

**Dominant root cause:** scrapers crawl a small **hardcoded subset of top-level
categories** (and/or have early-stopping pagination), never reaching subcategories.
**Universal fix:** drive scraping from each vendor's **product sitemap**. For the
many vendors whose product pages expose schema.org/og metadata and are curl-able
(eApoteka, Milica, Oliva, …), a single generic `sitemap → fetch → JSON-LD parse`
scraper would recover them cheaply (no per-site selectors, no Puppeteer). CF-locked
product pages (benu, srbotrade, lily) are the exception — they need the Puppeteer
category crawl.

## Top addressable under-coverers (excl. marketplaces), by missing products
| Vendor | have | true | cov | missing | root cause |
|---|--:|--:|--:|--:|---|
| DM | 3475 | 17928 | 19% | ~14.5k | category subset (also part non-pharma) |
| eApoteka | 48 | 9824 | 0% | 9776 | pagination dies after page 1 |
| Fitness Shop (nssport.com) | 20 | 6592 | 0% | 6572 | 4 hardcoded cats + JS/CAPTCHA |
| Milica | 123 | 6347 | 2% | 6224 | Load-More not advancing |
| Apothecary | 880 | 6941 | 13% | 6061 | category subset |
| Oliva | 3201 | 8623 | 37% | 5422 | 9 hardcoded cats |
| Benu | 1396 | 5175 | 27% | 3779 | pagination stopped on `.legacy-ajax.next` (FIXED) |
| Ring Sport | 6 | 2072 | 0% | 2066 | single URL, no pagination |
| Melisa, Max Farm, Apoteka Zivanovic, Alek Suplementi, Filly, Krsenkovic, Web Apoteka, X Sport, Vitalikum, Apoteka Sunce, eApotekaNet, Ogistra, Titanium Sport, XL Sport, Proteinbox … | | | 30–68% | ~10k combined | category subset / pagination |

**Healthy (≥70%, no action):** Jankovic, Herba, Laurus, Apoteka Net, Apotekarska
ustanova Nis, Biofarm, Hiper, Adonis, Flos, Apoteka Valerijana, Nature Hub, Zero,
Oaza Zdravlja, Prof Farm, FitLab, Esensa, AMG Sport, Supplement Store, E-Apoteka,
House Of Supplements, Pansport, Spartan Suplementi, exYu Fitness, Proteini, Moc
Bilja, Suplementi Shop/Srbija, Lama, Sop, Apotekar Online, ePlaneta, Superior,
Vitamin Shop, Supplement Shop.

**Unsizable (CF-blocked / no public sitemap):** Srbotrade, Dr Max, Lily, Maelia
(all currently scraping fine via Puppeteer; true size just can't be measured externally).

**Recommended next step:** build a generic **sitemap + JSON-LD product scraper** and
apply it to the curl-able under-coverers (eApoteka, Milica, Oliva, Apothecary, Ring
Sport, Filly, etc.) — ~30–40k products recoverable with one reusable helper.

---

# Coverage fixes applied — 2026-06-23

## benu (the flagged one)
Root cause was pagination, not categories: it stopped on a fragile `.legacy-ajax.next`
button. Switched to "paginate until a page yields no new products" (the global
title-dedup naturally stops at the true end / clamp). **Result: 1,396 → 4,247
products** (~82% of the 5,175 true size). Same pattern likely helps other
`.legacy-ajax.next`-style scrapers.

## Generic sitemap scraper (`helpers/sitemapScraper.ts`)
New reusable helper: discovers product URLs from a vendor's sitemap (robots.txt →
sitemap index → product sitemaps, handles .gz), fetches each product page, and
parses **JSON-LD Product / OpenGraph / microdata** price+title+image. No Puppeteer,
no per-site selectors. Fails loud on 0 products.

Classified all 24 curl-able under-coverers by whether this method yields a **price**:
- **Converted (price + title via JSON-LD/og), 5 vendors:** `milica` (123→~2.5k),
  `krsenkovic` (2113→~3.1k), `melisa` (1329→~2k), `eApotekaNet` (450→~0.9k),
  `proteinbox` (300→552 verified). ~+8k products.
- **Parse OK but price is JS-rendered (priced 0/6)** — NOT convertible this way;
  need the listing-page fix or Puppeteer: `eApoteka`, `Fitness Shop`, `Max Farm`,
  `Apoteka Zivanovic`, `Apoteka Sunce`, `Alek Suplementi`, `Titanium Sport`,
  `Aleksandar Mn`, `Livada`, `Ring Sport`.
- **Sitemap not discoverable (urls=0)** — need per-vendor sitemap path / JS sitemap:
  `Oliva`, `Apothecary`, `Web Apoteka`, `X Sport`, `XL Sport`, `Maximalium`,
  `Ogistra`, `Vitalikum`, `Filly`.
