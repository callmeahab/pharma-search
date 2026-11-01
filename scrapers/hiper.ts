import { runApiScraper } from './helpers/apiScrapers';
import { scrapeListing } from './helpers/listingScraper';
import { hiperListing } from './helpers/listingConfigs';

runApiScraper(() => scrapeListing(hiperListing), 'Hiper')
  .then(() => process.exit(0))
  .catch(error => { console.error('Hiper', error); process.exit(1); });
