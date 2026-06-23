// Rewritten 2026-06-23: was 9 hardcoded categories (~960 of ~8,600). OpenCart
// advanced sitemap → all product URLs; product pages have static price.
import { runSitemapScraper } from './helpers/sitemapScraper';
runSitemapScraper('https://www.oliva.rs', 'Oliva', { concurrency: 8 })
  .then(() => process.exit(0))
  .catch((e) => { console.error('Oliva scraper failed:', e); process.exit(1); });
