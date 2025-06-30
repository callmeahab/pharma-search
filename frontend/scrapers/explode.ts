import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://explode.rs/aminokiseline',
  'https://explode.rs/kozmetika',
  'https://explode.rs/bcaa-aminokiseline',
  'https://explode.rs/coq-10-i-antioksidanti-0',
  'https://explode.rs/energetski-preparati',
  'https://explode.rs/esencijalne-masne-kis-0',
  'https://explode.rs/glutamini',
  'https://explode.rs/imuno-i-biljni-suplementi',
  'https://explode.rs/kompleksni-suplementi',
  'https://explode.rs/kreatini',
  'https://explode.rs/no-i-pretrenazni-proizv-0',
  'https://explode.rs/oprema-0',
  'https://explode.rs/podrska-zglobovima',
  'https://explode.rs/post-trenazni-suplementi',
  'https://explode.rs/protein-izolati',
  'https://explode.rs/proteini',
  'https://explode.rs/proteini-za-masu',
  'https://explode.rs/proteinske-cok-i-obroci-0',
  'https://explode.rs/sagorevaci',
  'https://explode.rs/stimulatori-hormona',
  'https://explode.rs/varenje',
  'https://explode.rs/vitamini-i-minerali',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<{ products: Product[]; hasNextPage: boolean }> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for products to be visible
    await page.waitForSelector('.cart-list ', {
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
      await page.waitForSelector('.cart-list ', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return { products: [], hasNextPage: false };
    }

    // Check if there's a next page by looking for .pager-last
    const hasNextPage = await page.evaluate(() => {
      return !!document.querySelector('.pager-last');
    });

    const products = await page.$$eval(
      '.cart-list ',
      (elements, categoryArg) => {
        return elements
          .map((element) => {
            // Check if product is out of stock
            if (element.querySelector('.fa.fa-warning')) {
              return null;
            }

            const titleElement = element.querySelector('.catalog-grid-title');
            const title = titleElement?.textContent?.trim() || '';

            // Handle price ranges
            const price =
              element.querySelector('.uc-price')?.textContent?.trim() || '';

            const linkElement = element.querySelector(
              '.catalog-grid-title > a',
            ) as HTMLAnchorElement;
            const link = linkElement?.href || '';

            const imgElement = element.querySelector(
              '.catalog-grid-image img',
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

    return {
      products: products.filter((product) => product.title),
      hasNextPage,
    };
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return { products: [], hasNextPage: false };
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

      let pageNumber = 1;
      let hasNextPage = true;

      while (hasNextPage) {
        // First page should not have the page parameter
        const pageUrl =
          pageNumber === 1 ? baseUrl : `${baseUrl}?page=${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const { products, hasNextPage: nextPageExists } = await scrapePage(
          page,
          pageUrl,
          category,
        );

        if (products.length === 0) {
          console.log(`No products found on page ${pageNumber}, stopping...`);
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        hasNextPage = nextPageExists;
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
    await insertData(allProducts, 'Explode');
  } else {
    console.log('No products found.');
  }
});
