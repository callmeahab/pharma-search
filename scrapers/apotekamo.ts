import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const pagesToScrape = [
  'https://apotekamo.rs/kategorija-proizvoda/zdravlje/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/lepota-nega-zastita/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/prehrana-i-suplementi/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/zdravlje-dece/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/zdravlje-zena/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/ljubavne-igracke/?loadMore=9999',
  'https://apotekamo.rs/kategorija-proizvoda/zdravlje-muskaraca/?loadMore=9999',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/')[4];

  try {
    await Promise.all([
      page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      }),
      page
        .waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 120000,
        })
        .catch((err) => {
          console.log(
            `Navigation timeout for ${url}, continuing anyway:`,
            err.message,
          );
        }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await page
      .waitForSelector('.product', {
        timeout: 10000,
      })
      .catch(() => console.log('No products found on page'));

    const products = await page.$$eval('.product', (elements) => {
      return elements
        .map((element) => {
          const title =
            element
              .querySelector('h3')
              ?.textContent?.trim()
              .replace(',', '.') || '';
          const offStockElement = element.querySelector('.stock.out-of-stock');

          if (offStockElement) {
            return null;
          }

          let price = '';
          const priceElement = element.querySelector('.price');
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

          const link =
            element.querySelector('figure > a')?.getAttribute('href') || '';
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
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];

    for (const url of pagesToScrape) {
      let retryCount = 0;
      const maxRetries = 2;
      let products: Product[] = [];

      while (retryCount < maxRetries) {
        console.log(`Scraping page: ${url} (attempt ${retryCount + 1})`);
        try {
          products = await scrapePage(page, url);
          if (products.length > 0) break;
        } catch (error) {
          console.error(`Error on attempt ${retryCount + 1}:`, error);
        }
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      allScrapedProducts = [...allScrapedProducts, ...products];
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
    
    const allProducts = await scrapeMultiplePages();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apoteka MO');
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
