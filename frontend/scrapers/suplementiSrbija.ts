import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.suplementisrbija.rs/proteini-3',
  'https://www.suplementisrbija.rs/amino-kiseline-4',
  'https://www.suplementisrbija.rs/kreatini-5',
  'https://www.suplementisrbija.rs/no-i-pretrenazni-proizvodi-6',
  'https://www.suplementisrbija.rs/sagorevaci-7',
  'https://www.suplementisrbija.rs/vitamini-i-minerali-8',
  'https://www.suplementisrbija.rs/imunitet-i-zastita-organizma-9',
  'https://www.suplementisrbija.rs/obnova-i-zastita-zglobova-i-tetiva-10',
  'https://www.suplementisrbija.rs/prostata-zastita-i-prevencija-11',
  'https://www.suplementisrbija.rs/prirodni-stimulatori-hormona-12',
  'https://www.suplementisrbija.rs/omega-3-i-druge-esencijalne-masne-kiseline-13',
  'https://www.suplementisrbija.rs/energija-izdrzljivost-i-ugljeni-hidrat-14',
  'https://www.suplementisrbija.rs/oprema-za-vezbanje-15',
];

// Function to extract category from URL
function extractCategory(url: string): string {
  const urlPath = url.split('/').pop() || '';
  // Remove the trailing number and any special characters, return the category name
  return urlPath.replace(/-\d+$/, '');
}

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

    // Check if we're on a valid page by looking for the product grid
    const isValidPage = await page.$('.single-product');
    if (!isValidPage) {
      console.log('Invalid page - no product grid found');
      return [];
    }

    // Wait for products to be visible or for "no results" indicator
    try {
      await page.waitForSelector('.single-product', {
        visible: true,
        timeout: 20000,
      });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    // Add a small delay to ensure dynamic content loads
    await ScraperUtils.delay(2000);

    // Check for CAPTCHA
    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Get the actual products
    const products = await page.$$eval(
      '.single-product',
      (elements, { categoryArg }) => {
        // Filter out any empty product containers first
        const validElements = elements.filter((element) =>
          element.querySelector('h3')?.textContent?.trim(),
        );

        return validElements.map((element) => {
          const titleElement = element.querySelector('h3');
          const title = titleElement?.textContent?.trim() || '';

          const price =
            element.querySelector('.sale-price')?.textContent?.trim() || '';
          const linkElement = element.querySelector(
            '.product-img > a',
          ) as HTMLAnchorElement;
          const link = linkElement?.href || '';

          const imgElement = element.querySelector(
            '.product-img > a img',
          ) as HTMLImageElement;
          const img = imgElement?.src || '';

          return {
            title,
            price,
            link: link,
            thumbnail: img,
            photos: img,
            category: categoryArg,
          };
        });
      },
      { categoryArg: category },
    );

    // If no valid products were found or less than expected, we've reached the end
    if (products.length === 0 || products.length < 12) {
      console.log('End of products reached');
      return [];
    }

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
      const category = extractCategory(baseUrl);
      let pageOffset = 0;

      while (true) {
        const pageUrl = pageOffset === 0 ? baseUrl : `${baseUrl}/${pageOffset}`;

        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);
        if (products.length === 0) {
          console.log(
            `No products found on page with offset ${pageOffset}, stopping...`,
          );
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageOffset += 12;
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
    await insertData(allProducts, 'Suplementi Srbija');
  } else {
    console.log('No products found.');
  }
});
