import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 6 - Categories 151-177 (Home Pharmacy, Sports Nutrition, Medical, Food)
const categoryUrls = [
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/pelene-za-odrasle',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/steznici-i-pojasevi-za-ledja',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/ortopedska-pomagala',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/flasteri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/masti',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kompresijske-carape',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kreme',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kompleti-prve-pomoci',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/komprese',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/proteini',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/l-carnitine',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/kreatini',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/gejneri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/aminokiseline-i-glutamini',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/ugljeni-hidrati',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/sportska-ishrana/sagorevaci-masti',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/medicinski-magneti',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/pulsni-oksimetri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/aspiratori-nazalni',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/ostali-medicinski-aparati',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/meraci-pritiska',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/inhalatori',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/toplomeri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/medicinski-aparati/stetoskopi',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/cbd-kozmetika',
  'https://ananas.rs/kategorije/hrana-i-pice/caj',
  'https://ananas.rs/kategorije/hrana-i-pice/zdrava-hrana',
];

runAnanasScraper(categoryUrls, 'Ananas6');
