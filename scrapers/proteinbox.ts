// Rewritten 2026-06-23: sitemap-driven (coverage audit found the old category
// crawl under-covered). Discovers product URLs from the sitemap and parses
// JSON-LD/OpenGraph from each product page — no Puppeteer, full-catalog coverage.
import { runSitemapScraper } from './helpers/sitemapScraper';

// Skip /proizvodjaci/<brand>/ manufacturer listing pages — the sitemap lists them
// alongside real products, but they have no price (imported as price=0 junk).
runSitemapScraper('https://proteinbox.rs', 'Proteinbox', {
  concurrency: 8,
  excludeUrlPattern: /\/proizvodjaci\//,
})
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Proteinbox scraper failed:', error);
    process.exit(1);
  });
