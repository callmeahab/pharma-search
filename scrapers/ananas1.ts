import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 1 - Categories 1-30 (Beauty & Perfumes, Sex Shop)
const categoryUrls = [
  'https://ananas.rs/kategorije/lepota-i-nega/oprema-za-salone/kozmeticki-aparati',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/zenski-parfemi',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/muski-parfemi',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/unisex-parfemi',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/bodi-mist',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/parfemski-setovi',
  'https://ananas.rs/kategorije/lepota-i-nega/parfemi/mali-parfemi',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/analne-kupe',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/masazeri-prostate',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/lutke-na-naduvavanje',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/kuglice',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/klito-stimulatori',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/dildo',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/bdsm-i-bondage',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/sexy-ves',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/prstenovi-za-penis',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/navlake-za-penis',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/masturbatori',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/pumpe',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/strap-on',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/setovi-pomagala',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/vibro-jaje',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/vibratori',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/ostala-erotska-pomagala',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/vibro-metak',
  'https://ananas.rs/kategorije/lepota-i-nega/sex-shop/preparati-za-potenciju',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/iluminatori-i-hajlateri',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/fiksatori-i-seting-sprejevi',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/bronzeri',
  'https://ananas.rs/kategorije/lepota-i-nega/sminka/sminka-za-lice/bb-i-cc-kreme',
];

runAnanasScraper(categoryUrls, 'Ananas1');
