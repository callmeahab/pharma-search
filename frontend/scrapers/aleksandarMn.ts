import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://aleksandarmn.com/zdravlje',
  'https://aleksandarmn.com/suplementi',
  'https://aleksandarmn.com/fitness',
  'https://aleksandarmn.com/kozmetika',
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
    await page.waitForSelector('.products li', {
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
      await page.waitForSelector('.products li', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll(
        '.item.product.product-item',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          if (element.querySelector('.stock.unavailable')) {
            return null;
          }

          const titleElement = element.querySelector('.product-item-link h3');
          const title = titleElement?.textContent?.trim() || '';

          // Check both price selectors and get the text content
          const specialPrice = element.querySelector('.special-price .price');
          const regularPrice = element.querySelector(
            '.price-final_price .price',
          );
          const price =
            (specialPrice || regularPrice)?.textContent?.trim() || '';

          const linkElement = element.querySelector(
            '.product.photo.product-item-photo',
          );
          const link = linkElement?.getAttribute('href') || '';

          const imgElement = element.querySelector('.product-image-photo');
          const img = imgElement?.getAttribute('src') || '';

          return {
            title,
            price,
            link,
            thumbnail: img,
            photos: img,
            category: categoryArg,
          };
        })
        .filter((product) => product !== null);
    }, category);

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
      // Extract category from URL by taking the last segment
      const category = baseUrl.split('/').pop() || '';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}?p=${pageNumber}`;
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
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Aleksandar Mn');
  } else {
    console.log('No products found.');
  }
});
