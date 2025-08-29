import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.apotekasunce.rs/sr/proizvodi/zdravlje',
  'https://www.apotekasunce.rs/sr/proizvodi/vitamini-i-minerali',
  'https://www.apotekasunce.rs/sr/proizvodi/zene-i-muskarci',
  'https://www.apotekasunce.rs/sr/proizvodi/deca-i-bebe',
  'https://www.apotekasunce.rs/sr/proizvodi/nega',
  'https://www.apotekasunce.rs/sr/proizvodi/kozmetika',
  'https://www.apotekasunce.rs/sr/proizvodi/medicinska-sredstva',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/').pop() || '';

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-preview-item', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-preview-item', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h3')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            return null;
          }

          const priceText =
            element.querySelector('.price')?.textContent?.trim() || '';
          const price = priceText.replace(/[^\d,]/g, '');
          const link =
            element.querySelector('h3 > a')?.getAttribute('href') || '';
          const imageElement = element.querySelector('.image-wrapper img');
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

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.fa.fa-angle-right');
    return !!nextButton;
  } catch {
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
      let pageNumber = 1;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 2;

      while (consecutiveFailures < maxConsecutiveFailures) {
        const pageUrl = `${baseUrl}/${pageNumber}?limit=48`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          console.log(`Attempt ${retryCount + 1}`);
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

          // Check for next page
          const nextPageExists = await hasNextPage(page);
          if (!nextPageExists) {
            console.log('No next page found, moving to next category');
            break;
          }
        }

        pageNumber++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apoteka Sunce');
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
