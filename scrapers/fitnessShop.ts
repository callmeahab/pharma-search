import { runApiScraper } from './helpers/apiScrapers';
import { scrapeListing } from './helpers/listingScraper';
import { fitnessShopListing } from './helpers/listingConfigs';

runApiScraper(() => scrapeListing(fitnessShopListing), 'Fitness Shop')
  .then(() => process.exit(0))
  .catch(error => { console.error('Fitness Shop', error); process.exit(1); });
