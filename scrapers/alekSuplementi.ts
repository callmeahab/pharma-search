import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://aleksuplementi.com', 'Alek Suplementi'), 'Alek Suplementi')
  .then(() => process.exit(0)).catch((e) => { console.error('Alek Suplementi scraper failed:', e); process.exit(1); });
