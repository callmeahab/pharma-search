import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://apothecary.rs/12-nega',
  'https://apothecary.rs/13-sminka',
  'https://apothecary.rs/432-parfemi',
  'https://apothecary.rs/14-zdravlje',
  'https://apothecary.rs/634-physio-spa',
  'https://apothecary.rs/16-bebe',
  'https://apothecary.rs/17-muskarci',
];

// Function to clean the category by removing numbers and hyphens
function cleanCategory(rawCategory: string): string {
  return rawCategory.replace(/[\d-]/g, '').trim();
}

// Function to extract category from the URL
function extractCategory(url: string): string {
  const cleanedUrl = url.split('?')[0];
  const segments = cleanedUrl.split('/');
  const lastSegment = segments[segments.length - 1];
  return cleanCategory(lastSegment);
}

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = extractCategory(url);

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.item-product', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.item-product', (elements) => {
      return elements.map((element) => {
        const manufacturer =
          element.querySelector('.manufacturer')?.textContent?.trim() || '';
        const title = element.querySelector('h3')?.textContent?.trim() || '';
        const combinedTitle = `${manufacturer} ${title}`.trim();

        const price =
          element.querySelector('.price')?.textContent?.trim() || '';
        const link =
          element.querySelector('.img_block > a')?.getAttribute('href') || '';
        const img = element.querySelector('a > img')?.getAttribute('src') || '';

        return { combinedTitle, price, link, img };
      });
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.combinedTitle)) {
        allProducts.push({
          title: product.combinedTitle,
          price: product.price,
          category,
          link: product.link,
          thumbnail: product.img,
          photos: product.img,
        });
        scrapedTitles.add(product.combinedTitle);
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
    return [];
  }
}

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.next.js-search-link');
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
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

    for (const baseUrl of baseUrls) {
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}?page=${pageNum}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 3;
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
      }
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

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Apothecary');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
