import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.atpsport.com/10-suplementi',
  'https://www.atpsport.com/27-proteini',
  'https://www.atpsport.com/16-ugljeni-hidrati',
  'https://www.atpsport.com/17-korisne-masti-i-biljni-ekstrakti',
  'https://www.atpsport.com/18-vitamini-i-minerali',
  'https://www.atpsport.com/19-povecanje-telesne-tezine-i-misicne-mase',
  'https://www.atpsport.com/20-aminokiseline',
  'https://www.atpsport.com/21-sagorevaci-masti',
  'https://www.atpsport.com/22-stimulatori-hormona',
  'https://www.atpsport.com/23-kreatini',
  'https://www.atpsport.com/24-no-reaktori',
  'https://www.atpsport.com/25-zastita-zglobova-i-tetiva',
  'https://www.atpsport.com/26-cokoladice-i-napici',
  'https://www.atpsport.com/28-ostali-preparati',
  'https://www.atpsport.com/38-dodaci-ishrani-za-decu',
  'https://www.atpsport.com/11-sportska-oprema',
  'https://www.atpsport.com/41-atletska-oprema',
  'https://www.atpsport.com/12-meraci-srcane-frekvencije',
  'https://www.atpsport.com/13-elektromisicni-stimulatori',
  'https://www.atpsport.com/35-trake-za-trcanje',
  'https://www.atpsport.com/36-tegovi',
  'https://www.atpsport.com/31-masazeri',
  'https://www.atpsport.com/32-trenazeri',
  'https://www.atpsport.com/14-steznici',
  'https://www.atpsport.com/29-sejkeri',
  'https://www.atpsport.com/33-razno',
  'https://www.atpsport.com/39-senzori',
  'https://www.atpsport.com/42-merni-instrumenti',
  'https://www.atpsport.com/43-ledene-kade',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for products to be visible
    await page.waitForSelector('article', {
      visible: true,
      timeout: 20000,
    });

    // Add a small delay to ensure dynamic content loads
    await ScraperUtils.delay(2000);

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Check if product wrappers exist
    try {
      await page.waitForSelector('article', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      'article',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.ty-qty-out-of-stock')) {
              return null;
            }

            const titleElement = element.querySelector('h3');
            const title = titleElement?.textContent?.trim() || '';

            const price =
              element.querySelector('.price')?.textContent?.trim() || '';
            const linkElement = element.querySelector(
              '.thumbnail-container-image > a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.thumbnail-container-image > a > img',
            ) as HTMLImageElement;
            const img = imgElement?.src || '';

            return {
              title,
              price,
              link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          })
          .filter((product) => product !== null); // Filter out null products (out of stock)
      },
      category,
    );

    return products.filter((product) => product.title);
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [];
  }
}

// Main scraping function with pagination
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
      // Extract category from the last URL segment after removing any page numbers
      const urlWithoutParams = baseUrl.split('?')[0];
      const urlParts = urlWithoutParams.split('-');
      const category = urlParts[urlParts.length - 1] || 'unknown';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}?page=${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);
        if (products.length === 0) {
          console.log(`No products found on page ${pageNumber}, stopping...`);
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageNumber++;
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
    await insertData(allProducts, 'ATP Sport');
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
