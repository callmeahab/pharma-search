import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const pharmacyName = 'https://apotekazero.rs';
const baseUrls = [
  'https://apotekazero.rs/shop/category_problemi-sa-varenjem',
  'https://apotekazero.rs/shop/category_prehlada-i-grip',
  'https://apotekazero.rs/shop/category_vitamini-i-minerali',
  'https://apotekazero.rs/shop/category_stres-i-nesanica',
  'https://apotekazero.rs/shop/category_dijabetes',
  'https://apotekazero.rs/shop/category_srce-i-krvni-sudovi',
  'https://apotekazero.rs/shop/category_zenski-problemi',
  'https://apotekazero.rs/shop/category_muski-problemi',
  'https://apotekazero.rs/shop/category_bebe-i-deca',
  'https://apotekazero.rs/shop/category_alergija',
  'https://apotekazero.rs/shop/category_nervni-sistem',
  'https://apotekazero.rs/shop/category_urinarni-sistem',
  'https://apotekazero.rs/shop/category_oko-i-vid',
  'https://apotekazero.rs/shop/category_kosti-i-zglobovi',
  'https://apotekazero.rs/shop/category_zdravlje-jetre',
  'https://apotekazero.rs/shop/category_biljni-lekovi',
  'https://apotekazero.rs/shop/category_posebna-ishrana',
  'https://apotekazero.rs/shop/category_bol',
  'https://apotekazero.rs/shop/category_koza-kosa-nokti',
  'https://apotekazero.rs/shop/category_kozmetika-za-bebe',
  'https://apotekazero.rs/shop/category_dermokozmetika',
  'https://apotekazero.rs/shop/category_nega-i-zastita',
  'https://apotekazero.rs/shop/category_higijena',
  'https://apotekazero.rs/shop/category_meraci-pritiska-toplomeri-inhalatori',
];

// Function to extract category from the URL
function extractCategory(url: string): string {
  const match = url.match(/category_(.+?)(?:!|$)/);
  return match ? match[1] : 'unknown';
}

// Function to scrape products from a given URL
async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = extractCategory(url);

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-holder', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-holder', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h2')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const price =
            element.querySelector('.price')?.textContent?.trim() || '';
          const link =
            element.querySelector('.product-img > a')?.getAttribute('href') ||
            '';
          const imageElement = element.querySelector('a > img');

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

// Function to check for the next page button
async function hasNextPage(page: Page): Promise<boolean> {
  try {
    // Look for the next page button that contains ">" text
    const nextButton = await page.$eval('a', (elements) => {
      return Array.from(document.querySelectorAll('a')).some((el) =>
        el.textContent?.includes('>'),
      );
    });
    return nextButton;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
  }
}

// Main function to scrape from multiple base URLs
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
        const pageUrl = `${baseUrl}!page_${pageNum}`;
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

// Call the main function
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Zero');
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
