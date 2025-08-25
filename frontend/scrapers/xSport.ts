import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://xsport.rs/besplatna_dostava',
  'https://xsport.rs/webcena',
  'https://xsport.rs/grupa/u_borbi_protiv_virusa',
  'https://xsport.rs/grupa/one-dose-jedna-doza',
  'https://xsport.rs/grupa/sagorevaci_masti',
  'https://xsport.rs/grupa/veganski-proteini-100-biljnog-porekla',
  'https://xsport.rs/grupa/vitamini_minerali_multivitamini',
  'https://xsport.rs/grupa/poboljsanje_raspolozenje_i_sna',
  'https://xsport.rs/grupa/anti',
  'https://xsport.rs/grupa/minerali-1',
  'https://xsport.rs/grupa/regulisanje-secera-i-pomoc-pri-insulinskoj-rezistenciji',
  'https://xsport.rs/grupa/podrska-i-regeracija-jetre',
  'https://xsport.rs/grupa/nootropici_i_proizvodi_za_bolju_koncetraciju_i_memoriju',
  'https://xsport.rs/grupa/povecanje_plodnosti_poboljsanje_potencije_zastita_prostate',
  'https://xsport.rs/grupa/regulacija-hormona-stitnezlezde',
  'https://xsport.rs/grupa/stimulatori_hormona',
  'https://xsport.rs/grupa/proteini',
  'https://xsport.rs/grupa/omega_3_i_esencijalne_masne_kiseline',
  'https://xsport.rs/grupa/probava_digestivni_enzimi_detoksikacija_organizma',
  'https://xsport.rs/grupa/aminokiseline',
  'https://xsport.rs/grupa/kreatin',
  'https://xsport.rs/grupa/no_reaktori_i_preworkou_suplementi',
  'https://xsport.rs/grupa/biljni_ekstrakti',
  'https://xsport.rs/grupa/stimulatori_na_bazi_kofeina_i_taurina',
  'https://xsport.rs/grupa/poveanje_performansi',
  'https://xsport.rs/grupa/proteinske_okoladice_gelovi_isotonini_napici',
  'https://xsport.rs/grupa/garderoba',
  'https://xsport.rs/grupa/body_font_faceverdana_colorff0066_size3font_enski_kutakbody_',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for products to be visible
    await page.waitForSelector('.product-list-item', {
      visible: true,
      timeout: 20000,
    });

    // Add a small delay to ensure dynamic content loads
    await ScraperUtils.delay(2000);

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Check if product wrappers exist
    try {
      await page.waitForSelector('.product-list-item', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-list-item',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.fa.fa-warning')) {
              return null;
            }

            const titleElement = element.querySelector('.product-list-title');
            const title = titleElement?.textContent?.trim() || '';

            // Handle price ranges
            const priceText =
              element.querySelector('.price')?.textContent?.trim() || '';
            const price = priceText.split('-')[0].trim(); // Take the lower price from the range

            const linkElement = element.querySelector(
              '.product-list-title',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.img-responsive',
            ) as HTMLImageElement;
            const img = imgElement?.src || '';

            return {
              title,
              price,
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          })
          .filter((product) => product !== null); // Filter out null products (out of stock)
      },
      category,
    );

    return products.filter((product) => product.title);
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [];
  }
}

// Main scraping function with pagination
async function scrapeMultipleBaseUrls(): Promise<Product[]> {
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];

    for (const baseUrl of baseUrls) {
      // Extract category from the URL path
      const urlPath = new URL(baseUrl).pathname;
      const category = urlPath.split('/').pop() || 'unknown';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}?page=${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);
        if (products.length === 0) {
          console.log(`No products found on page ${pageNumber}, stopping...`);
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageNumber++;
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'X Sport');
  } else {
    console.log('No products found.');
  }
});
