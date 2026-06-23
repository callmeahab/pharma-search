// Rewritten 2026-06-22: fitlab.rs replatformed to a Next.js SPA backed by
// WooCommerce. Use the WooCommerce Store API (verified live) instead of DOM.
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';

runApiScraper(() => scrapeWooStore('https://fitlab.rs', 'FitLab'), 'FitLab')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('FitLab scraper failed:', error);
    process.exit(1);
  });
