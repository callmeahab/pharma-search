// Rewritten 2026-06-23: was a category subset. mocbilja.rs exposes the full
// WooCommerce Store API (x-wp-total ~314).
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://www.mocbilja.rs', 'Moc Bilja', { perPage: 100 }), 'Moc Bilja')
  .then(() => process.exit(0)).catch((e) => { console.error('Moc Bilja scraper failed:', e); process.exit(1); });
