// Rewritten 2026-06-23: was 7 hardcoded categories (~1,414 of ~6,941). PrestaShop
// sitemap (CDATA) → product URLs end in .html; JSON-LD/itemprop price.
import { runSitemapScraper } from './helpers/sitemapScraper';
runSitemapScraper('https://apothecary.rs', 'Apothecary', { concurrency: 8, productUrlPattern: /\.html$/ })
  .then(() => process.exit(0))
  .catch((e) => { console.error('Apothecary scraper failed:', e); process.exit(1); });
