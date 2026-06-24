// Rewritten 2026-06-23: was a fragile Puppeteer crawl. fillyfarm.rs exposes the
// WooCommerce Store API — full catalog, no browser.
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://fillyfarm.rs', 'Filly', { perPage: 100 }), 'Filly')
  .then(() => process.exit(0)).catch((e) => { console.error('Filly scraper failed:', e); process.exit(1); });
