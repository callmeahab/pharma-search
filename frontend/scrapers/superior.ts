import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = ['https://www.superior14.rs/proizvodi'];
const baseUrl = 'https://www.superior14.rs';

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

    // Clean up category extraction to consistently remove URL parameters
    const categoryFromUrl =
      url.split('/product-category/')[1]?.split('/')[0]?.split('?')[0] ||
      category;

    // Update selector to match new HTML structure
    await page.waitForSelector('.block', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    try {
      await page.waitForSelector('.block', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.evaluate(
      (categoryArg: string, baseUrlArg: string) => {
        const productElements = document.querySelectorAll('.block');
        return Array.from(productElements)
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.stock.out-of-stock')) {
              return null;
            }

            const titleElement = element.querySelector('.title');
            const title = titleElement?.textContent?.trim() || '';

            const priceElement = element.querySelector('.price');
            const price =
              priceElement?.textContent?.trim().replace('RSD', '').trim() || '';

            const linkElement = element.querySelector('a');
            const link = linkElement?.getAttribute('href') || '';

            const imgElement = element.querySelector('figure.zoomzoom img');
            const img =
              imgElement?.getAttribute('src') ||
              imgElement?.getAttribute('data-src') ||
              '';

            return {
              title,
              price,
              link: baseUrlArg + link,
              thumbnail: img,
              photos: img,
              category: categoryArg,
            };
          })
          .filter(
            (product): product is NonNullable<typeof product> =>
              product !== null &&
              Boolean(product.title) &&
              Boolean(product.price),
          );
      },
      categoryFromUrl,
      baseUrl,
    );

    return products;
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
      // Clean up category name by removing URL parameters and trailing slashes
      const category = 'suplementi';

      let pageNumber = 1;
      while (true) {
        const pageUrl =
          pageNumber === 1 ? `${baseUrl}` : `${baseUrl}/strana-${pageNumber}`;

        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);

        // Check if there are any products and if next page button exists
        const hasNextPage = await page.evaluate(() => {
          return !document.querySelector('.next');
        });

        if (products.length === 0 || hasNextPage) {
          console.log(
            `Reached last page (${pageNumber}) for category ${category}`,
          );
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
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Superior');
  } else {
    console.log('No products found.');
  }
});
