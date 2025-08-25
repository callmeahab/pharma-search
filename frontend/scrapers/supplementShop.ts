import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://supplementshop.rs/kategorija-proizvoda/aminokiseline/',
  'https://supplementshop.rs/kategorija-proizvoda/antioksidansi/',
  'https://supplementshop.rs/kategorija-proizvoda/elektroliti/',
  'https://supplementshop.rs/kategorija-proizvoda/sejkeri-flasice-termosi/',
  'https://supplementshop.rs/kategorija-proizvoda/kreatin/',
  'https://supplementshop.rs/kategorija-proizvoda/post-workout/',
  'https://supplementshop.rs/kategorija-proizvoda/pre-workout-i-no-reaktori/',
  'https://supplementshop.rs/kategorija-proizvoda/proteini/',
  'https://supplementshop.rs/kategorija-proizvoda/proteinske-i-energetske-cokoladice/',
  'https://supplementshop.rs/kategorija-proizvoda/imunitet-vitamini-i-minerali/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-kosti-i-zglobove/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-misicnu-masu/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-muskarce/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-regulaciju-telesne-tezine/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-snagu-i-izdrzljivost/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-vegane/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-vegetarijance/',
  'https://supplementshop.rs/kategorija-proizvoda/suplementi-za-zene/',
  'https://supplementshop.rs/kategorija-proizvoda/ugljeni-hidrati/',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Check if product wrappers exist
    try {
      await page.waitForSelector('.product-wrapper', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-wrapper',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('h3');
          const title = titleElement?.textContent?.trim() || '';

          let price = '';
          const priceElement = element.querySelector('.price');
          const newPriceElement = priceElement?.querySelector(
            'ins .woocommerce-Price-amount',
          );

          if (newPriceElement) {
            price = newPriceElement.textContent?.trim() || '';
          } else {
            price =
              priceElement
                ?.querySelector('.woocommerce-Price-amount')
                ?.textContent?.trim() || '';
          }

          const linkElement = element.querySelector(
            '.product-image-link',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.product-image-link img',
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
        });
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
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}page/${pageNumber}/?per_page=24`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, 'pharmacy');
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
    await insertData(allProducts, 'Supplement Shop');
  } else {
    console.log('No products found.');
  }
});
