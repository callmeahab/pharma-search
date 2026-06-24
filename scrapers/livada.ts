import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://apotekalivada.rs', 'Livada'), 'Livada')
  .then(() => process.exit(0)).catch((e) => { console.error('Livada scraper failed:', e); process.exit(1); });
