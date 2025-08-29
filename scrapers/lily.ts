import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.lilly.rs/zdravlje',
  'https://www.lilly.rs/sminka',
  'https://www.lilly.rs/lepota-i-nega',
  'https://www.lilly.rs/parfemi-i-toaletne-vode',
  'https://www.lilly.rs/decji-kutak',
  'https://www.lilly.rs/muski-kutak',
  'https://www.lilly.rs/tekstil',
  'https://www.lilly.rs/domacinstvo',
  'https://www.lilly.rs/nasi-proizvodi',
  'https://www.lilly.rs/ekskluzivni-proizvodi',
  'https://www.lilly.rs/novi-proizvodi',
  'https://www.lilly.rs/poklon-setovi',
  'https://www.lilly.rs/loyalty-program',
];

async function scrapePage(page: Page, category: string): Promise<Product[]> {
  try {
    // Add a more lenient timeout and catch specific timeout errors
    await page
      .waitForSelector('#maincontent .product-item', {
        timeout: 20000,
      })
      .catch(() => {
        // If selector times out, we assume no products are found
        return [];
      });

    // Check if products exist before trying to scrape
    const hasProducts = await page.$('#maincontent .product-item');
    if (!hasProducts) {
      return [];
    }

    const products = await page.$$eval(
      '#maincontent .product-item',
      (items, cat) =>
        items.map((item) => {
          const title =
            item
              .querySelector('.text-base.truncate-title-2')
              ?.textContent?.trim() || '';
          const price =
            item
              .querySelector('.flex.font-medium.text-body-l')
              ?.textContent?.trim() || '';
          const link = item.querySelector('a')?.href || '';
          const thumbnail = item.querySelector('img')?.src || '';
          const photos = item.querySelector('img')?.src || '';

          return {
            title,
            price,
            link,
            thumbnail,
            photos,
            category: cat,
          };
        }),
      category,
    );

    // Filter out products with empty titles and duplicates
    const validProducts = products.filter(
      (p) => p.title && !scrapedTitles.has(p.title),
    );
    validProducts.forEach((p) => scrapedTitles.add(p.title));

    return validProducts;
  } catch (error) {
    console.error(`Error scraping ${category} page:`, error);
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

    // Set a realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    );

    // Enable stealth mode
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    let allScrapedProducts: Product[] = [];

    for (const baseUrl of baseUrls) {
      const category = baseUrl.split('/').slice(-1)[0];
      let pageNumber = 1;
      let consecutiveEmptyPages = 0;

      while (consecutiveEmptyPages < 2) {
        // Stop after 2 empty pages in a row
        const pageUrl = `${baseUrl}?p=${pageNumber}&product_list_limit=54`;
        console.log(`Scraping page: ${pageUrl}`);

        try {
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          const products = await scrapePage(page, category);
          console.log(
            `Scraped ${products.length} products from page ${pageNumber}`,
          );

          if (products.length === 0) {
            consecutiveEmptyPages++;
            console.log(`Empty page found (${consecutiveEmptyPages} in a row)`);
          } else {
            consecutiveEmptyPages = 0;
            allScrapedProducts = [...allScrapedProducts, ...products];
          }

          pageNumber++;
        } catch (error) {
          console.error(`Error on page ${pageNumber}:`, error);
          consecutiveEmptyPages++;

          // Add a longer delay on error
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      console.log(`Finished scraping category: ${category}`);

      // Add a longer delay between categories
      await new Promise((resolve) => setTimeout(resolve, 5000));
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
    try {
      await insertData(allProducts, 'Lily');
      console.log(`Successfully inserted ${allProducts.length} products`);
    } catch (error) {
      console.error('Error inserting products into database:', error);
    }
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
