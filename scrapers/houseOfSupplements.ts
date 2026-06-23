// Rewritten 2026-06-23: category paths moved; use the live WooCommerce Store API.
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://houseofsupplements.rs', 'House Of Supplements', { perPage: 100, inStockOnly: true }), 'House Of Supplements')
  .then(() => process.exit(0)).catch((e) => { console.error('House Of Supplements scraper failed:', e); process.exit(1); });
