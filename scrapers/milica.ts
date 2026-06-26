// Rewritten 2026-06-23: sitemap-driven (coverage audit found the old category
// crawl under-covered). Discovers product URLs from the sitemap and parses
// JSON-LD/OpenGraph from each product page — no Puppeteer, full-catalog coverage.
import { runSitemapScraper } from './helpers/sitemapScraper';

// Milica's sitemap also lists taxonomy pages (/category/, /tag-proizvoda/) which
// have no single price and parsed to 0 (≈490 junk rows). Keep only real product
// pages — WooCommerce products live under /product/<slug>.
runSitemapScraper('https://www.apotekamilica.rs', 'Milica', {
  concurrency: 8,
  productUrlPattern: /\/product\//,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Milica scraper failed:', error);
    process.exit(1);
  });
