import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.apotekavalerijana.rs/apoteka-online/limit-100',
  'https://www.apotekavalerijana.rs/dermokozmetika/limit-100',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/')[3];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-thumb', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-thumb', (elements) => {
      return elements
        .map((element) => {
          const title =
            element.querySelector('.name')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.out-of-stock');

          if (offStockElement) {
            return null;
          }

          const price =
            element
              .querySelector('.price-new, .price-normal')
              ?.textContent?.trim() || '';
          const link =
            element.querySelector('.name a')?.getAttribute('href') || '';
          const imageElement = element.querySelector('a img');
          let img =
            imageElement?.getAttribute('data-src') ||
            imageElement?.getAttribute('src') ||
            imageElement?.getAttribute('data-original') ||
            '';

          return { title, price, link, img };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: product.link,
          thumbnail: product.img,
          photos: product.img,
        });
        scrapedTitles.add(product.title);
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
    return [];
  }
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
      let page_num = 1;

      while (true) {
        const pageUrl = `${baseUrl}/page-${page_num}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          try {
            products = await scrapePage(page, pageUrl);
            if (products.length > 0) break;
          } catch (error) {
            console.error(`Error on attempt ${retryCount + 1}:`, error);
          }
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (products.length === 0) {
          console.log(
            `No products found on page ${page_num} of ${baseUrl}, stopping...`,
          );
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        page_num++;
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apoteka Valerijana');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
