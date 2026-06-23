// Rewritten 2026-06-23: Magento 2, server-rendered. Use the product sitemap +
// Magento data-price-amount (the explicit product sitemap avoids category pages).
import { runSitemapScraper } from './helpers/sitemapScraper';
runSitemapScraper('https://aleksandarmn.com', 'Aleksandar Mn', { concurrency: 6, productSitemaps: ['https://aleksandarmn.com/product_sitemap.xml'] })
  .then(() => process.exit(0)).catch((e) => { console.error('Aleksandar Mn scraper failed:', e); process.exit(1); });
