import { runApiScraper } from './helpers/apiScrapers';
import { scrapeMaelia } from './helpers/maeliaHelper';

runApiScraper(scrapeMaelia, 'Maelia')
  .then(() => process.exit(0))
  .catch(error => { console.error('Maelia scraper failed:', error); process.exit(1); });
