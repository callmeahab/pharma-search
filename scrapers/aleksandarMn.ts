// Shopify migration: fetch the public catalog in batches instead of requesting
// every product page, which triggers the store's rate limit.
import { runApiScraper, scrapeShopify } from './helpers/apiScrapers';
runApiScraper(() => scrapeShopify('https://aleksandarmn.com', 'Aleksandar Mn'), 'Aleksandar Mn')
  .then(() => process.exit(0)).catch((e) => { console.error('Aleksandar Mn scraper failed:', e); process.exit(1); });
