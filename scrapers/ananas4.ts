import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 4 - Categories 91-120 (Oral, Hands, Nails, Feet, Supplements)
const categoryUrls = [
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/izbeljivanje-zuba',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/interdentalne-cetkice',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/cetkice-za-zube',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/elektricne-cetkice-za-zube',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/masazeri-za-lice',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/masazeri-za-telo',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/irigator-za-zube',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/vage-za-merenje',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparti-za-negu-lica-i-tela/dodatna-oprema-za-oralnu-higijenu',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/tecnost-za-ispiranje-usta',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/osvezivac-daha',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/konac-za-zube',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-ruku/kreme-za-ruke',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-ruku/maske-za-ruke',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/lakovi-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/gelovi-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/tretmani-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/turpije-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/makazice-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/grickalice',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/pribor-za-manikir-i-pedikir',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/uv-lampe',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/elektricne-turpije',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/vestacki-nokti',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-noktiju/ukrasi-za-nokte',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-stopala/kreme-za-stopala',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-stopala/maske-za-stopala',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-stopala/pribor-za-negu-stopala',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-stopala/ulosci-za-obucu',
  'https://ananas.rs/kategorije/lepota-i-nega/melemi',
];

runAnanasScraper(categoryUrls, 'Ananas4');
