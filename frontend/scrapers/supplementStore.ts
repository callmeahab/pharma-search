import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];

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
          const title = element.querySelector('h4')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.label.label-danger');

          if (offStockElement) {
            return null;
          }

          // First try to get price-new, if not found get regular price
          const priceElement =
            element.querySelector('.price-new') ||
            element.querySelector('.price:not(:has(.price-old))');
          const price = priceElement?.textContent?.trim() || '';
          const link =
            element.querySelector('.image > a')?.getAttribute('href') || '';
          const img =
            element.querySelector('.image > a > img')?.getAttribute('src') ||
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
          category: 'Suplement Store',
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

async function scrapeMultiplePages(): Promise<Product[]> {
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
    let pageNumber = 1;
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 2;

    while (consecutiveFailures < maxConsecutiveFailures) {
      const url = `https://supplementstore.rs/kategorije/svi-proizvodi?limit=100&page=${pageNumber}`;
      console.log(`Scraping page: ${url}`);

      let retryCount = 0;
      const maxRetries = 2;
      let products: Product[] = [];

      while (retryCount < maxRetries) {
        console.log(`Attempt ${retryCount + 1}`);
        try {
          products = await scrapePage(page, url);
          if (products.length > 0) break;
        } catch (error) {
          console.error(`Error on attempt ${retryCount + 1}:`, error);
        }
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

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
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
scrapeMultiplePages().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Supplement Store');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
