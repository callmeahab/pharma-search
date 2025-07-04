import puppeteer from 'puppeteer-extra';
import { createWorker } from 'tesseract.js';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://bazzar.rs/c/lepota-i-nega?page='];
const baseUrl = 'https://bazzar.rs';

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    // Use a more lenient loading strategy
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for a short time to allow dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Try to wait for results with a longer timeout
    try {
      await page.waitForSelector('.row[id="results"]', { timeout: 30000 });
    } catch (error) {
      console.log('Results container not found, checking if page is empty...');
      const emptyMessage = await page.$('.alert.alert-info');
      if (emptyMessage) {
        console.log('No products found on page, stopping...');
        return [];
      }
      throw error;
    }

    const products = await page.$$eval(
      '.row[id="results"] .card.card-product',
      (items, baseUrl, category) => {
        return items.map((item) => {
          const title = item.querySelector('h3')?.textContent?.trim() || '';
          const priceText =
            item.querySelector('.lead.mb-1 span')?.textContent?.trim() || '';
          const price = priceText
            .replace(/\s+/g, ' ')
            .replace(' RSD', '')
            .trim();
          const link = item.closest('a')?.getAttribute('href') || '';
          const img =
            item.querySelector('.product-img')?.getAttribute('src') || '';

          return {
            title,
            price,
            link: baseUrl + link,
            thumbnail: img,
            photos: img,
            category,
          };
        });
      },
      baseUrl,
      category,
    );

    // Filter duplicates
    const allProducts: Product[] = [];
    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push(product);
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
    let consecutiveEmptyPages = 0;

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, 'beauty');

        if (products.length === 0) {
          consecutiveEmptyPages++;
          console.log(
            `No products found on page ${pageNumber}, consecutive empty pages: ${consecutiveEmptyPages}`,
          );

          if (consecutiveEmptyPages >= 2) {
            console.log('Stopping scraping after 2 consecutive empty pages');
            break;
          }
        } else {
          consecutiveEmptyPages = 0; // Reset counter if we found products
          allScrapedProducts = [...allScrapedProducts, ...products];
        }

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
    await insertData(allProducts, 'Bazzar');
  } else {
    console.log('No products found.');
  }
});
