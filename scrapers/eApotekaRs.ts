import { runApiScraper } from './helpers/apiScrapers';
import { scrapeListing } from './helpers/listingScraper';
import { eApotekaListing } from './helpers/listingConfigs';

runApiScraper(() => scrapeListing(eApotekaListing), 'eApoteka')
  .then(() => process.exit(0))
  .catch(error => { console.error('eApoteka', error); process.exit(1); });
