import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://apotekaproffarm.com/product-category/kozmetika/page/',
  'https://apotekaproffarm.com/product-category/dekorativa/page/',
  'https://apotekaproffarm.com/product-category/higijena/page/',
  'https://apotekaproffarm.com/product-category/dijetetika/page/',
  'https://apotekaproffarm.com/product-category/bebi-program/page/',
  'https://apotekaproffarm.com/product-category/medicinska-kozmetika/page/',
  'https://apotekaproffarm.com/product-category/lokalna-primena/page/',
  'https://apotekaproffarm.com/product-category/medicinska-sredstva/page/',
  'https://apotekaproffarm.com/product-category/ostalo/page/',
];

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    // Check for empty message first
    const emptyMessage = await page.$('.message.info.empty');
    if (emptyMessage) {
      console.log(`No more products available on ${url}`);
      return [];
    }

    await page
      .waitForSelector('.product-block', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-block', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h3')?.textContent?.trim() || '';
          const offStockElement = element.querySelector(
            '.prod-price-on-request',
          );

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const priceElement = element.querySelector('.price');
          let price =
            priceElement
              ?.querySelector('ins .woocommerce-Price-amount')
              ?.textContent?.trim() || '';
          if (!price) {
            price =
              priceElement
                ?.querySelector('.woocommerce-Price-amount')
                ?.textContent?.trim() || '';
          }

          const link =
            element.querySelector('h3 > a')?.getAttribute('href') || '';
          const imgElement = element.querySelector('.product-image > img');
          let img =
            imgElement?.getAttribute('data-src') ||
            imgElement?.getAttribute('src') ||
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
      const category =
        baseUrl.split('?')[0].split('/').filter(Boolean).slice(-2, -1)[0] || '';

      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}${pageNum}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          try {
            products = await scrapePage(page, pageUrl, category);
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
        pageNum++;

        // Add small delay between pages
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      console.log(`Finished scraping ${baseUrl}`);
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
    await insertData(allProducts, 'Prof Farm');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
