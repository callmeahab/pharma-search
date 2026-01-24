import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 2 - Categories 31-60 (Makeup, Face & Eyes)
const categoryUrls = [
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/puderi-za-setovanje',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/rumenila',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/proizvodi-za-konturisanje',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/puderi',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/prajmeri',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/korektori',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/baza-za-senku',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/senke-za-oci',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/ajlajneri',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/olovke-za-oci',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/gliteri-za-oci',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/pigmenti-za-oci',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/sminka-za-obrve',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/maskare',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/vestacke-trepavice',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/lepak-za-vestacke-trepavice',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-oci/dodaci',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-usne/olovke-za-usne',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-usne/sjajevi-za-usne',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-usne/ruzevi',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/cetkice-za-sminkanje-i-dodaci/drzaci-za-cetkice-za-sminku',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/cetkice-za-sminkanje-i-dodaci/cetkice-za-sminkanje',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/cetkice-za-sminkanje-i-dodaci/sredstva-za-ciscenje-cetkica',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/maramice-i-vate/blaznice-i-tupferi',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/maramice-i-vate/vlazne-maramice-za-lice',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/maramice-i-vate/stapici-za-usi',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/ciscenje-lica/micelarna-voda',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/ciscenje-lica/losion-za-lice',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-lica/ciscenje-lica/proizvodi-za-umivanje',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/neseseri-i-kozmeticki-koferi/kozmeticki-koferi',
];

runAnanasScraper(categoryUrls, 'Ananas2');
