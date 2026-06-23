// Rewritten 2026-06-23: was 13 hardcoded categories (~3,987 of ~8,100). OpenCart
// advanced sitemap → full catalog; static price on product pages.
import { runSitemapScraper } from './helpers/sitemapScraper';
runSitemapScraper('https://www.shop.apotekalaurus.rs', 'Laurus', { concurrency: 8 })
  .then(() => process.exit(0))
  .catch((e) => { console.error('Laurus scraper failed:', e); process.exit(1); });
