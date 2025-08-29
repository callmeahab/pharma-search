import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const pharmacyName = 'https://www.apotekasrbotrade.rs/';

// Function to extract category without numbers and trailing dashes
const getCategory = (url: string): string => {
  const category = url.split('/proizvodi/')[1].split('?')[0];
  let cleanedCategory = category.replace(/\d+/g, '').trim();
  cleanedCategory = cleanedCategory.replace(/-$/, '');
  return cleanedCategory;
};

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
      .waitForSelector('.productItemWrapper', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.productItemWrapper', (elements) => {
      return elements
        .map((element) => {
          const title =
            element
              .querySelector('.title')
              ?.textContent?.trim()
              .replace(',', '.') || '';
          const offStockElement = element.querySelector('.offStock');

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const price =
            element.querySelector('.price')?.textContent?.trim() || '';
          const link = element.querySelector('a')?.getAttribute('href') || '';
          const img = element.querySelector('img')?.getAttribute('src') || '';

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
          link: pharmacyName + product.link,
          thumbnail: pharmacyName + product.img,
          photos: pharmacyName + product.img,
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

async function scrapeMultiplePages(pages: string[]): Promise<Product[]> {
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];

    for (const pageUrl of pages) {
      console.log(`Scraping page: ${pageUrl}`);
      const category = getCategory(pageUrl);

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

      if (products.length > 0) {
        allScrapedProducts = [...allScrapedProducts, ...products];
      } else {
        console.log(`No products found on ${pageUrl}`);
      }

      // Add small delay between pages
      await new Promise((resolve) => setTimeout(resolve, 2000));
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

const pagesToScrape = [
  'https://www.apotekasrbotrade.rs/srpski/proizvodi/dodaci-ishrani?page=9999',
  'https://www.apotekasrbotrade.rs/srpski/proizvodi/kozmetika-444?page=9999',
  'https://www.apotekasrbotrade.rs/srpski/proizvodi/nega-i-zastita-2?page=9999',
];

scrapeMultiplePages(pagesToScrape).then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Srbotrade');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
