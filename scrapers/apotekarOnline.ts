// Rewritten 2026-06-23: site rebuilt as Next.js (old WooCommerce dead). Use the
// sitemap (/proizvod/ URLs) + JSON-LD price.
import { runSitemapScraper } from './helpers/sitemapScraper';
runSitemapScraper('https://apotekar-online.rs', 'Apotekar Online', { concurrency: 6, productUrlPattern: /\/proizvod/ })
  .then(() => process.exit(0)).catch((e) => { console.error('Apotekar Online scraper failed:', e); process.exit(1); });
