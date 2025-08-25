import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrl = 'https://www.shopmania.rs';
const baseUrls = [
  'https://www.shopmania.rs/fitness/p',
  'https://www.shopmania.rs/parfemi/p',
  'https://www.shopmania.rs/razni-prirodni-preparati/p',
  'https://www.shopmania.rs/zenska-kozmetika/p',
  'https://www.shopmania.rs/nega-tela/p',
  'https://www.shopmania.rs/vitamini-i-suplementi-ishrane/p',
  'https://www.shopmania.rs/licna-nega/p',
  'https://www.shopmania.rs/apoteka/p',
];

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    // Check for error message
    const errorText = await page
      .$eval('h2.h4.serif.mb-2', (el) => el.textContent || '')
      .catch(() => '');
    if (errorText.includes('Ooops... ☹️')) {
      console.log(`Ooops... ☹️ message found on ${url}. Stopping scraping.`);
      return [];
    }

    await page
      .waitForSelector('.prod-item', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.prod-item', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h2')?.textContent?.trim() || '';
          const offStockElement = element.querySelector(
            '.grid-image.grid-image--out-of-stock',
          );

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const price =
            element.querySelector('.prod-price')?.textContent?.trim() || '';
          const link =
            element.querySelector('h2 > a')?.getAttribute('href') || '';
          const imgElement = element.querySelector('.prod-item-img-wrap img');

          let img =
            imgElement?.getAttribute('data-src') ||
            imgElement?.getAttribute('src') ||
            '';

          if (img.startsWith('/')) {
            img = `https://www.shopmania.rs${img}`;
          }

          if (img === 'https://s.cdnshm.com/img/site/na.svg') {
            img = ''; // Ignore placeholder image
          }

          return { title, price, link, img };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: baseUrl + product.link,
          thumbnail: product.img,
          photos: product.img,
        });
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
      const category =
        baseUrl.split('?')[0].split('/').filter(Boolean).slice(-2, -1)[0] || '';

      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}${pageNum}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          try {
            products = await scrapePage(page, pageUrl, category);
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
        pageNum++;

        // Add small delay between pages
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      console.log(`Finished scraping ${baseUrl}`);
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
    await insertData(allProducts, 'Shopmania');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
