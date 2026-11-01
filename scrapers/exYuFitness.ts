import { runApiScraper } from './helpers/apiScrapers';
import { scrapeListing } from './helpers/listingScraper';
import { exYuListing } from './helpers/listingConfigs';

runApiScraper(() => scrapeListing(exYuListing), 'exYu Fitness')
  .then(() => process.exit(0))
  .catch(error => { console.error('exYu Fitness', error); process.exit(1); });
