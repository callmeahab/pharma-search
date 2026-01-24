import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 3 - Categories 61-90 (Hair, Shaving, Depilation, Intimate)
const categoryUrls = [
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/neseseri-i-kozmeticki-koferi/neseseri',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/samponi-za-kosu',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/regeneratori-za-kosu',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/maske-za-kosu',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/preparati-za-rast-kose',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/farbanje-kose/farba-za-kosu',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/farbanje-kose/oprema-za-farbanje-kose',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/nadogradnja-kose',
  'https://ananas.rs/kategorije/lepota-i-nega/nega-kose/preparati-za-kosu',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/vosak-za-depilaciju',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/topilice-za-vosak',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/prasak-za-depilaciju',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/krema-za-depilaciju',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/nega-posle-depilacije',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/depilacija/trake-za-depilaciju',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparati-za-brijanje-i-oprema/aparati-za-depilaciju-i-oprema',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparati-za-brijanje-i-oprema/elektricni-brijaci',
  'https://ananas.rs/kategorije/aparati-za-negu-i-lepotu/aparati-za-brijanje-i-oprema/trimeri',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/nega-brade',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/pribor-za-brijanje/kreme-za-brijanje',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/pribor-za-brijanje/gelovi-za-brijanje',
  'https://ananas.rs/kategorije/lepota-i-nega/brijanje-i-depilacija/pribor-za-brijanje/after-shave',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/kondomi',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/ulosci/dnevni-ulosci',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/ulosci/ulosci-za-inkontinenciju',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/ulosci/higijenski-ulosci',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/tamponi',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/intimne-vlazne-maramice',
  'https://ananas.rs/kategorije/lepota-i-nega/intimna-higijena/intimni-gelovi',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/paste-za-zube',
];

runAnanasScraper(categoryUrls, 'Ananas3');
