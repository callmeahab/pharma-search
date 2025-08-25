import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrl = 'https://apotekar-online.rs/prodavnica/';

async function scrapePage(page: Page): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await page
      .waitForSelector('.product', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product', (elements) => {
      return elements.map((element) => {
        const title = element.querySelector('h2')?.textContent?.trim() || '';
        const priceElement =
          element.querySelector('.price ins .woocommerce-Price-amount') ||
          element.querySelector('.price .woocommerce-Price-amount');
        const price = priceElement?.textContent?.trim() || '';
        const link =
          element.querySelector('.product > a')?.getAttribute('href') || '';
        const img =
          element.querySelector('.product > a > img')?.getAttribute('src') ||
          '';

        return { title, price, link, img };
      });
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category: '',
          link: product.link,
          thumbnail: product.img,
          photos: product.img,
        });
        scrapedTitles.add(product.title);
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping page: ${(error as Error).message}`);
    return [];
  }
}

async function hasNextPage(page: Page, nextValue: number): Promise<boolean> {
  try {
    const nextButton = await page.$(
      `.jet-filters-pagination__item[data-value="${nextValue}"]`,
    );
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
  }
}

async function scrapeMultiplePages(): Promise<Product[]> {
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];
    let currentPageValue = 1;

    await Promise.all([
      page.goto(baseUrl, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    while (true) {
      console.log(`Scraping page with data-value=${currentPageValue}`);

      let retryCount = 0;
      const maxRetries = 2;
      let products: Product[] = [];

      while (retryCount < maxRetries) {
        try {
          products = await scrapePage(page);
          if (products.length > 0) break;
        } catch (error) {
          console.error(`Error on attempt ${retryCount + 1}:`, error);
        }
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (products.length === 0) {
        console.log('No products found on current page, stopping pagination.');
        break;
      }

      allScrapedProducts = [...allScrapedProducts, ...products];

      const nextPageExists = await hasNextPage(page, currentPageValue + 1);
      if (!nextPageExists) {
        console.log('No more pages available. Scraping finished.');
        break;
      }

      console.log(`Clicking on pagination number: ${currentPageValue + 1}`);
      await page.click(
        `.jet-filters-pagination__item[data-value="${currentPageValue + 1}"]`,
      );
      await page.waitForSelector('.product');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      currentPageValue++;
    }

    console.log(
      `Scraping completed. Total products found: ${allScrapedProducts.length}`,
    );
    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultiplePages().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apotekar Online');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
