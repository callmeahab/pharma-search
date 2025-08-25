import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.adonisapoteka.rs/dijetetski-suplementi/prikazi-100',
  'https://www.adonisapoteka.rs/nega-i-zastita/prikazi-100',
  'https://www.adonisapoteka.rs/kozmetika/prikazi-100',
  'https://www.adonisapoteka.rs/bebi-program/prikazi-100',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/')[3];

  try {
    // Modified navigation strategy
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }), // Changed from networkidle0 to domcontentloaded
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), // More lenient network idle
    ]);

    // Wait for either products or a "no products" indicator
    await page
      .waitForSelector('.product-thumb', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    // Replace waitForTimeout with setTimeout promise
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

          if (img.startsWith('data:image')) {
            img = imageElement?.getAttribute('data-original') || img;
          }

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
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 2;

      while (consecutiveFailures < maxConsecutiveFailures) {
        const pageUrl =
          pageNumber === 1 ? baseUrl : `${baseUrl}/page-${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        try {
          const products = await scrapePage(page, pageUrl);

          if (products.length === 0) {
            consecutiveFailures++;
            console.log(
              `No products found on page ${pageNumber} (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`,
            );

            if (consecutiveFailures >= maxConsecutiveFailures) {
              console.log(
                `Stopping after ${maxConsecutiveFailures} consecutive empty pages`,
              );
              break;
            }
          } else {
            consecutiveFailures = 0;
            allScrapedProducts = [...allScrapedProducts, ...products];
          }

          pageNumber++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Error on page ${pageUrl}:`, error);
          consecutiveFailures++;
        }
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
    await insertData(allProducts, 'Adonis');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
