import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.shop.apotekalaurus.rs/kozmetika-i-nega',
  'https://www.shop.apotekalaurus.rs/dijetetika',
  'https://www.shop.apotekalaurus.rs/dekorativa',
  'https://www.shop.apotekalaurus.rs/higijena',
  'https://www.shop.apotekalaurus.rs/mama-i-beba',
  'https://www.shop.apotekalaurus.rs/igracke',
  'https://www.shop.apotekalaurus.rs/lokalna-primena',
  'https://www.shop.apotekalaurus.rs/rasprodaja-kratak-rok-1',
  'https://www.shop.apotekalaurus.rs/medicinski-aparati-i-oprema/sanitetski-materijal',
  'https://www.shop.apotekalaurus.rs/medicinski-aparati-i-oprema/pelene-ulosci',
  'https://www.shop.apotekalaurus.rs/medicinski-aparati-i-oprema/pomagala',
  'https://www.shop.apotekalaurus.rs/medicinski-aparati-i-oprema/rastvori-za-sociva',
  'https://www.shop.apotekalaurus.rs/medicinski-aparati-i-oprema/sanitetski-materijal',
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

    await page
      .waitForSelector('.product-thumb', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-thumb', (elements) => {
      return elements
        .map((element) => {
          const title =
            element.querySelector('.name')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.out-of-stock');

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const price =
            element.querySelector('.price-normal')?.textContent?.trim() || '';
          const link =
            element.querySelector('.name a')?.getAttribute('href') || '';
          const img = element.querySelector('a img')?.getAttribute('src') || '';

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
          link: product.link,
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
      const path = baseUrl.replace(/^https?:\/\/[^/]+\//, '');
      const category = path.split('/').slice(0, 1)[0];
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}/page-${pageNum}?limit=100`;
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
    await insertData(allProducts, 'Laurus');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
