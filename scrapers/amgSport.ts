import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://amgsport.net', 'AMG Sport'), 'AMG Sport')
  .then(() => process.exit(0)).catch((e) => { console.error('AMG Sport scraper failed:', e); process.exit(1); });
