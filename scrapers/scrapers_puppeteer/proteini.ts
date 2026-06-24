// Rewritten 2026-06-22: rs.proteini.si migrated to proteinisi.rs (WooCommerce).
// Use the WooCommerce Store API (verified live) instead of Puppeteer DOM scraping.
import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';

runApiScraper(() => scrapeWooStore('https://proteinisi.rs', 'Proteini'), 'Proteini')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Proteini scraper failed:', error);
    process.exit(1);
  });
