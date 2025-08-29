import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.oliva.rs/zdravlje?limit=100&page=',
  'https://www.oliva.rs/kosa?limit=100&page=',
  'https://www.oliva.rs/sminka?limit=100&page=',
  'https://www.oliva.rs/nega?limit=100&page=',
  'https://www.oliva.rs/mame-i-deca?limit=100&page=',
  'https://www.oliva.rs/muskarci?limit=100&page=',
  'https://www.oliva.rs/kucni-ljubimci?limit=100&page=',
  'https://www.oliva.rs/sportska-suplementacija?limit=100&page=',
  'https://www.oliva.rs/snizene-cene?limit=100&page=',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/')[3].split('?')[0];

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
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
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
      let pageNum = 1;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 2;

      while (consecutiveFailures < maxConsecutiveFailures) {
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
          consecutiveFailures++;
          console.log(
            `No products found on page ${pageNum} (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`,
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

async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Oliva');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
  }
}

// Run the scraper
main();
