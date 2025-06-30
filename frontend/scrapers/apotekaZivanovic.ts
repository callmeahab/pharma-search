import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrl = 'https://www.apoteka-zivanovic.rs';
const baseUrls = [
  'https://www.apoteka-zivanovic.rs/category/testovi-i-aparati/2305/',
  'https://www.apoteka-zivanovic.rs/category/kozmetika/2306/',
  'https://www.apoteka-zivanovic.rs/category/sve-za-mamu-i-decu/2307/',
  'https://www.apoteka-zivanovic.rs/category/apoteka/2308/',
  'https://www.apoteka-zivanovic.rs/category/preparati-za-zastitu/2309/',
  'https://www.apoteka-zivanovic.rs/category/obuca-carape-i-ulosci/2310/',
  'https://www.apoteka-zivanovic.rs/category/promocija/2506/',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/')[4].split('?')[0];

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.product-box', { timeout: 15000 });

    const products = await page.evaluate((baseUrl) => {
      return Array.from(document.querySelectorAll('.product-box')).map(
        (element) => {
          const title = element.querySelector('h6')?.textContent?.trim() || '';
          const priceElement = element.querySelector('h4 span');
          const price = priceElement?.textContent?.trim() || '';
          const link =
            element.querySelector('.link_to_product')?.getAttribute('href') ||
            '';
          const img =
            element
              .querySelector('.link_to_product img')
              ?.getAttribute('src') || '';
          const isOutOfStock = element.querySelector('.rasprodato') !== null;

          return { title, price, link, img, isOutOfStock };
        },
      );
    }, baseUrl);

    for (const product of products) {
      if (!product.isOutOfStock && !scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: product.link,
          thumbnail: baseUrl + product.img,
          photos: baseUrl + product.img,
        });
        scrapedTitles.add(product.title);
      }
    }

    console.log(
      `Found ${products.length} products, ${allProducts.length} new on ${url}`,
    );
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
  }

  return allProducts;
}

async function scrapeMultipleBaseUrls(): Promise<Product[]> {
  const tempBrowser = await puppeteer.launch();
  const tempPage = await tempBrowser.newPage();
  const args = await ScraperUtils.configurePage(tempPage);
  await tempBrowser.close();

  const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args,
  });

  try {
    const page = await browser.newPage();
    let allScrapedProducts: Product[] = [];

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl);
        if (products.length === 0) break;

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageNumber++;

        // Add delay between requests
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultipleBaseUrls().then(async (products) => {
  if (products.length > 0) {
    await insertData(products, 'Apoteka Zivanovic');
    console.log(`Successfully stored ${products.length} products`);
  } else {
    console.log('No products found.');
  }
});
