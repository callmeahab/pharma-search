import { runApiScraper, scrapeWooStore } from './helpers/apiScrapers';
runApiScraper(() => scrapeWooStore('https://medxapoteka.rs', 'Med X Apoteka'), 'Med X Apoteka')
  .then(() => process.exit(0)).catch((e) => { console.error('Med X Apoteka scraper failed:', e); process.exit(1); });
