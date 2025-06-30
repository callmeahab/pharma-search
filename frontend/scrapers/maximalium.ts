import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.maximalium.rs/whey-protein-2',
  'https://www.maximalium.rs/kreatin-16',
  'https://www.maximalium.rs/tribulus-terrestis-12',
  'https://www.maximalium.rs/amino-kiseline-4',
  'https://www.maximalium.rs/gaineri-proteini-za-masu-15',
  'https://www.maximalium.rs/sagorevac-masti-11',
  'https://www.maximalium.rs/vitamini-i-minerali-18',
  'https://www.maximalium.rs/ugljeni-hidrati-nadoknada-energije-13',
  'https://www.maximalium.rs/paketi-23',
  'https://www.maximalium.rs/sportska-oprema-14',
  'https://www.maximalium.rs/paketi-31',
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
    const category =
      baseUrl.split('/').pop()?.split('-').slice(0, -1).join('-') || '';

    // Update selector to match new HTML structure
    await page.waitForSelector('.shop-content .product-article-item', {
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
        '.shop-content .product-article-item',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock by looking for the "currently-not-available" element that's visible
          const outOfStockElement = element.querySelector(
            '.currently-not-available',
          ) as HTMLElement;
          const outOfStock =
            outOfStockElement && outOfStockElement.style.display !== 'none';
          if (outOfStock) {
            return null;
          }

          const titleElement = element.querySelector('.single-product__title');
          const title = titleElement?.textContent?.trim() || '';

          const priceElement = element.querySelector('.sale-price span');
          const price = priceElement?.textContent?.trim() || '';

          const linkElement = element.querySelector('.product-img a');
          const link = linkElement?.getAttribute('href') || '';

          const imgElement = element.querySelector('.product-img img');
          const img = imgElement?.getAttribute('src') || '';

          return {
            title,
            price,
            link: link.startsWith('http')
              ? link
              : `https://www.maximalium.rs${link}`,
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
    }, category);

    return products;
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [];
  }
}

// Main scraping function
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
      console.log(`Scraping: ${baseUrl}`);
      const products = await scrapePage(page, baseUrl, baseUrl);
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
    await insertData(allProducts, 'Maximalium');
  } else {
    console.log('No products found.');
  }
});
