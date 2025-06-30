import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.azgardnutrition.rs/proizvodi/azgard-proteini',
  'https://www.azgardnutrition.rs/proizvodi/azgard-gejneri-gainers',
  'https://www.azgardnutrition.rs/proizvodi/aminokiseline',
  'https://www.azgardnutrition.rs/proizvodi/azgard-sagorevaci-masti',
  'https://www.azgardnutrition.rs/proizvodi/pojacivaci-testosterona',
  'https://www.azgardnutrition.rs/proizvodi/azgard-vitamini',
  'https://www.azgardnutrition.rs/proizvodi/azgard-kreatini',
  'https://www.azgardnutrition.rs/proizvodi/azgard-preworkout-proizvodi',
  'https://www.azgardnutrition.rs/proizvodi/azgard-oprema',
  'https://www.azgardnutrition.rs/proizvodi/azgard-paketi',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  baseUrl: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Extract category from baseUrl
    const lastPart = baseUrl.split('/').pop() || '';
    const category = lastPart.startsWith('azgard-')
      ? lastPart.replace('azgard-', '')
      : lastPart;

    // Update selector to match new HTML structure
    await page.waitForSelector('.shop-product-wrap.grid.row .product-item', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll(
        '.shop-product-wrap.grid.row .product-item',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          const outOfStock = element.querySelector('button[disabled]') !== null;
          if (outOfStock) {
            return null;
          }

          const name = element
            .querySelector('.product-name h4 a')
            ?.textContent?.trim();
          const priceElement = element
            .querySelector('.regular-price')
            ?.textContent?.trim();
          const price = priceElement
            ? parseFloat(priceElement.replace(/[^\d,]/g, '').replace(',', '.'))
            : 0;
          const link = element
            .querySelector('.product-name h4 a')
            ?.getAttribute('href');
          const imageUrl = element
            .querySelector('.product-thumb img')
            ?.getAttribute('src');

          if (!name || !price || !link || !imageUrl) {
            return null;
          }

          return {
            title: name,
            price: price.toString(),
            link,
            thumbnail: imageUrl,
            photos: imageUrl,
            category: categoryArg,
          };
        })
        .filter(
          (product): product is NonNullable<typeof product> => product !== null,
        );
    }, category);

    return products;
  } catch (error) {
    console.error(`Error scraping page ${url}:`, error);
    return [];
  }
}

// Main scraping function without pagination
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
      const urlWithParams = `${baseUrl}?sort=4&show=48`;
      console.log(`Scraping: ${urlWithParams}`);
      const products = await scrapePage(page, urlWithParams, baseUrl);
      allScrapedProducts = [...allScrapedProducts, ...products];
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
    await insertData(allProducts, 'Azgard');
  } else {
    console.log('No products found.');
  }
});
