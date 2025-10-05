import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product, initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrl = 'https://www.ananas.rs';
const baseUrls = [
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
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/izbeljivanje-zuba',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/cetkice-za-zube-i-dodaci/decije-cetkice-za-zube',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/cetkice-za-zube-i-dodaci/interdentalne-cetkice',
  'https://ananas.rs/kategorije/lepota-i-nega/oralna-higijena/cetkice-za-zube-i-dodaci/cetkice-za-zube',
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
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/pelene-za-odrasle',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/steznici-i-pojasevi-za-ledja',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/ortopedska-pomagala',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/flasteri',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/masti',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kompresijske-carape',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kreme',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/kompleti-prve-pomoci',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/komprese',
  'https://ananas.rs/kategorije/ishrana-i-zdravlje/kucna-apoteka/pelene-za-odrasle',
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

async function scrollPage(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

async function ensureImagesLoaded(page: Page) {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    // Force load lazy images
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        const srcset = img.getAttribute('data-srcset');
        if (dataSrc) img.src = dataSrc;
        if (srcset) img.srcset = srcset;
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 2000)); // Replace waitForTimeout

    const allImagesLoaded = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.every((img) => {
        // Skip placeholder images
        if (img.src.includes('data:image/gif;base64')) return false;
        return img.complete && img.naturalHeight > 0;
      });
    });

    if (allImagesLoaded) break;
    retries++;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function decodeNextJsImageUrl(src: string) {
  const urlMatch = src.match(/url=(.*?)(&|$)/);
  return urlMatch ? decodeURIComponent(urlMatch[1]) : src;
}

async function scrapePage(
  page: Page,
  url: string,
  pageScrapedTitles: Set<string>
): Promise<{ products: Product[]; skipped: number; totalElements: number }> {
  const allProducts: Product[] = [];
  const category = url.split('/')[5].split('?')[0];
  let pageSkipped = 0;
  let result: any;

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    await page.waitForSelector('.ais-Hits-item', {
      timeout: 15000,
      visible: true,
    });

    // Add scroll and ensure images are loaded
    await scrollPage(page);
    await ensureImagesLoaded(page);

    result = await page.evaluate((baseUrl: string) => {
      const allElements = Array.from(
        document.querySelectorAll('.ais-Hits-item'),
      );
      const skippedElements = allElements.filter((element) =>
        element.querySelector('.sc-492kdg-11'),
      );

      const keptElements = allElements.filter(
        (element) => !element.querySelector('.sc-492kdg-11'),
      );

      const products = keptElements.map((element) => {
        const title = element.querySelector('h3')?.textContent?.trim() || '';
        const spans = element.querySelectorAll('span');
        const priceElement = spans[1]; // second <span> (index starts at 0)
        const price = priceElement?.textContent?.trim() || '';
        const link = element.querySelector('a')?.getAttribute('href') || '';

        const imgElement = element.querySelector('img');
        let imgSrc = '';

        // Try different image source attributes
        const possibleSources = [
          imgElement?.getAttribute('src'),
          imgElement?.getAttribute('data-src'),
          imgElement?.getAttribute('data-lazy'),
          // For srcset pick the LAST (largest) candidate instead of first
          (() => {
            const ss = imgElement?.getAttribute('srcset');
            if (!ss) return undefined;
            const parts = ss.split(',').map(p => p.trim().split(' ')[0]).filter(Boolean);
            return parts[parts.length - 1];
          })(),
        ];

        for (const src of possibleSources) {
            if (src && !src.includes('data:image/gif;base64') && !src.includes('data:image/svg+xml')) {
              imgSrc = src;
              break;
            }
        }

        return {
          title,
          price,
          link: baseUrl + link,
          img: imgSrc,
        };
      });

      return {
        products: products.filter((p) => p.img), // Only keep products with valid images
        skipped: skippedElements.length,
        totalFound: allElements.length,
      };
    }, baseUrl);

    // Decode Next.js proxy image URLs to original before logging and further processing
    if (result?.products?.length) {
      result.products = result.products.map((p: any) => ({
        ...p,
        img: decodeNextJsImageUrl(p.img)
      }));
    }

    // Logging now limited to duplicates only (no full product listing)

    pageSkipped = result.skipped;

    let duplicatesSkipped = 0;
    const duplicatesLogged: any[] = [];
    for (const product of result.products) {
      if (!pageScrapedTitles.has(product.title)) {
        const decodedImg = decodeNextJsImageUrl(product.img);

        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: product.link,
          thumbnail: decodedImg,
          photos: decodedImg,
        });
        pageScrapedTitles.add(product.title);
      }
    }

    if (duplicatesLogged.length > 0) {
      console.log(`🔁 Duplicates on page (count=${duplicatesLogged.length}):`);
      duplicatesLogged.forEach((d, i) => {
        console.log(`   ↪ [${i + 1}] ${d.title} | Price: ${d.price} | Link: ${d.link}`);
      });
    }

    console.log(
      `🟢 ${url} - Found ${result.totalFound} total elements, ${result.products.length} valid products (${allProducts.length} new, ${duplicatesSkipped} duplicates), Skipped ${pageSkipped} out-of-stock items`,
    );
  } catch (error) {
    console.error(`🔴 ${url} - Error: ${(error as Error).message}`);
  }

  return { products: allProducts, skipped: pageSkipped, totalElements: result?.totalFound || 0 };
}

async function scrapeMultipleBaseUrls(): Promise<{
  products: Product[];
  totalSkipped: number;
}> {
  const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  const page = await browser.newPage();
  await ScraperUtils.configurePage(page);
  let allScrapedProducts: Product[] = [];
  let totalSkipped = 0;

  try {
    for (const baseUrl of baseUrls) {
      // Create a new Set for each category to track duplicates within that category only
      const categoryScrapedTitles = new Set<string>();
      let pageIndex = 1;
      while (true) {
        const pageUrl = `${baseUrl}?page=${pageIndex}`;
        console.log(`🌐 Scraping: ${pageUrl}`);

        const { products, skipped, totalElements } = await scrapePage(page, pageUrl, categoryScrapedTitles);
        totalSkipped += skipped;

        // Check if we found any elements at all on the page
        // If no elements found, we've reached the end of the category
        if (totalElements === 0) {
          console.log(`⏹️ Reached end of pagination at page ${pageIndex} - no elements found`);
          break;
        }

        console.log(`📄 Page ${pageIndex}: ${totalElements} elements found, ${products.length} new products processed`);

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageIndex++;

        // Standard delay between requests
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error(`🚨 Critical error: ${(error as Error).message}`);
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }

  return { products: allScrapedProducts, totalSkipped };
}

async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();

    const { products } = await scrapeMultipleBaseUrls();

    if (products.length > 0) {
      await insertData(products, 'Ananas');
      console.log(`✅ Successfully stored ${products.length} products`);
      console.log(`⏭️ Total out-of-stock items skipped: ${totalSkipped}`);
    } else {
      console.log('❌ No products found across all categories');
    }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
  }
}

// Run the scraper
main();
