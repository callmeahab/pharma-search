// Rewritten 2026-06-22: atpsport.rs migrated PrestaShop -> WooCommerce. Use the
// WooCommerce Store API instead of DOM scraping.
// NOTE: verify on a host where atpsport.rs resolves (it did not resolve from the
// dev sandbox at rewrite time, but the audit confirmed the Store API is live).
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';

runApiScraper(() => scrapeWooStore('https://atpsport.rs', 'ATP Sport'), 'ATP Sport')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('ATP Sport scraper failed:', error);
    process.exit(1);
  });
