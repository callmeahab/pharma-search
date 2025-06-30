import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.pansport.rs/amino-kiseline',
  'https://www.pansport.rs/antioksidanti',
  'https://www.pansport.rs/biljni-ekstrakti',
  'https://www.pansport.rs/esencijalne-masne-kiseline',
  'https://www.pansport.rs/kreatin',
  'https://www.pansport.rs/minerali',
  'https://www.pansport.rs/oporavak-i-regeneracija',
  'https://www.pansport.rs/ostalo',
  'https://www.pansport.rs/povecanje-performansi',
  'https://www.pansport.rs/povecanje-telesne-tezine-misicne-mase',
  'https://www.pansport.rs/povecanje-testosterona-i-hormona-rasta',
  'https://www.pansport.rs/prelivi-i-namazi',
  'https://www.pansport.rs/proteini',
  'https://www.pansport.rs/proteinske-cokoladice',
  'https://www.pansport.rs/regulisanje-probave',
  'https://www.pansport.rs/sagorevaci-masti',
  'https://www.pansport.rs/sportska-oprema',
  'https://www.pansport.rs/transportni-sistemi-i-no-reaktori',
  'https://www.pansport.rs/vitamini',
  'https://www.pansport.rs/vitaminsko-mineralni-kompleksi',
  'https://www.pansport.rs/zamene-za-obrok',
  'https://www.pansport.rs/zastita-zglobova',
  'https://www.pansport.rs/zenski-kutak',
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
    await page.waitForSelector('.product-teaser-holder', {
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
      await page.waitForSelector('.product-teaser-holder', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.$$eval(
      '.product-teaser-holder',
      (elements, categoryArg) => {
        return elements.map((element) => {
          const titleElement = element.querySelector('h4');
          const title = titleElement?.textContent?.trim() || '';

          const price =
            element.querySelector('.price-amount')?.textContent?.trim() || '';
          const linkElement = element.querySelector(
            '.teaser-image > a',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.teaser-image > a img',
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
        });
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
      const category = baseUrl.split('/').pop() || 'unknown';
      const pageUrl = `${baseUrl}?items_per_page=All`;
      console.log(`Scraping: ${pageUrl}`);

      const products = await scrapePage(page, pageUrl, category);
      if (products.length === 0) {
        console.log(`No products found for ${category}`);
        continue;
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
scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Pansport');
  } else {
    console.log('No products found.');
  }
});
