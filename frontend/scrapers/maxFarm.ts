import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.markfarm.rs/category/kozmetika/1498/',
  'https://www.markfarm.rs/category/beauty/36413/',
  'https://www.markfarm.rs/category/probiotici-i-enzimi/1494/',
  'https://www.markfarm.rs/category/vitamini-i-minerali/1495/',
  'https://www.markfarm.rs/category/suplementi/1493/',
  'https://www.markfarm.rs/category/medicinska-sredstva/1496/',
  'https://www.markfarm.rs/category/uho-grlo-nos/1497/',
  'https://www.markfarm.rs/category/preparati-za-oci/1500/',
  'https://www.markfarm.rs/category/dentalni-program/1499/',
  'https://www.markfarm.rs/category/masti-kremovi-gelovi/1501/',
  'https://www.markfarm.rs/category/indikacije/1712/',
  'https://www.markfarm.rs/category/otc/12824/',
];

function getCategoryFromUrl(url: string): string {
  const parts = url.split('/category/');
  const category = parts[1]?.split('/')[0] || '';
  return category;
}

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-list-item', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-list-item', (elements) => {
      return elements
        .map((element) => {
          const title =
            element.querySelector('.pli-text')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.sticker2');

          if (offStockElement) {
            console.log(`Product out of stock: ${title}`);
            return null;
          }

          const priceText =
            element.querySelector('.pli-price')?.textContent?.trim() || '';
          const prices = priceText.split('Trenutna cena:');
          const price = prices[1] ? prices[1].trim() : '';

          const link =
            element
              .querySelector('.product-list-item > div > a')
              ?.getAttribute('href') || '';
          const img =
            element
              .querySelector('.product-list-item a img')
              ?.getAttribute('src') || '';

          return { title, price, link, img };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category: getCategoryFromUrl(url),
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

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.fa.fa-chevron-right');
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
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
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}${pageNum}`;
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
            `No products found on page ${pageNum} of ${baseUrl}, stopping...`,
          );
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];

        const nextPageExists = await hasNextPage(page);
        if (!nextPageExists) {
          console.log(`No next page found for ${pageUrl}, stopping...`);
          break;
        }

        pageNum++;

        // Add small delay between pages
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
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

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Max Farm');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
