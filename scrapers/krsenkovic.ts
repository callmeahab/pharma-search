// Rewritten 2026-06-23: sitemap-driven (coverage audit found the old category
// crawl under-covered). Discovers product URLs from the sitemap and parses
// JSON-LD/OpenGraph from each product page — no Puppeteer, full-catalog coverage.
import { runSitemapScraper } from './helpers/sitemapScraper';

runSitemapScraper('https://apotekakrsenkovic.rs', 'Krsenkovic', { concurrency: 8 })
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Krsenkovic scraper failed:', error);
    process.exit(1);
  });
