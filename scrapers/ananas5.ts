import { runAnanasScraper } from './helpers/ananasHelper';

// Ananas Scraper Part 5 - Categories 121-150 (Supplements, Home Pharmacy)
const categoryUrls = [
  'https://ananas.rs/kategorije/lepota-i-nega/kozmeticki-setovi',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/vitamini',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-prehladu',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/zdravlje-zena',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/jacanje-imuniteta',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-varenje',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-vene-i-hemoroide',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/jetra-i-detoksikacija',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-trudnice-i-dojilje',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/zdravlje-muskaraca',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-kasalj',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/srce-krvni-sudovi-i-cirkulacija',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/pamcenje-i-koncentracija',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-decu',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/minerali',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/kosti-i-zglobovi',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/probiotici',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-kosu-kozu-i-nokte',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/regulacija-secera',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-mrsavljenje',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/urinarni-sistem',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/suplementi/preparati-za-oci',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/gelovi',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/gaze',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/zavoji',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/maske-rukavice-i-viziri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/cajevi',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/etarska-ulja',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/dezinfekcija',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/ulosci-za-cipele',
];

runAnanasScraper(categoryUrls, 'Ananas5');
