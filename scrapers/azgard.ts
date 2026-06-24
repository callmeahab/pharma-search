// Rewritten 2026-06-22: azgard.rs is a Shopify store. Use the public
// /products.json API instead of the old (commented-out) Puppeteer scraper.
// NOTE: verify on a host where azgard.rs resolves (it did not resolve from the
// dev sandbox at rewrite time).
import { runApiScraper, scrapeShopify } from './helpers/apiScrapers';

runApiScraper(() => scrapeShopify('https://azgardnutrition.rs/', 'Azgard'), 'Azgard')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Azgard scraper failed:', error);
    process.exit(1);
  });
