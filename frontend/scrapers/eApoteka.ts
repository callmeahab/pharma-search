import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://www.e-apoteka.rs/prodavnica/'];

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

    await page
      .waitForSelector('.product', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h2')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            return null;
          }

          const priceElement = element.querySelector('.price');
          let price = '';

          const oldPriceElement = priceElement?.querySelector(
            'del .woocommerce-Price-amount',
          );
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

          const link = element.querySelector('a')?.getAttribute('href') || '';
          const imageElement = element.querySelector('img');
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

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.fa.fa-angle-right');
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
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
      const category = baseUrl.split('/').pop() || '';
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}page/${pageNum}`;
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

        const nextPageExists = await hasNextPage(page);
        if (!nextPageExists) {
          console.log(`No next page found for ${pageUrl}, stopping...`);
          break;
        }

        pageNum++;
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
    await insertData(allProducts, 'E-Apoteka');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
