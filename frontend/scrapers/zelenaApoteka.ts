import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

// Set to keep track of scraped titles
const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://prodaja.zelena-apoteka.com/catalog/ajur-veda-21125/p',
  'https://prodaja.zelena-apoteka.com/catalog/aromaterapija-21506/p',
  'https://prodaja.zelena-apoteka.com/catalog/bahove-cvetne-kapi-22022/p',
  'https://prodaja.zelena-apoteka.com/catalog/bolnicki-program-30967/p',
  'https://prodaja.zelena-apoteka.com/catalog/carape-za-vene-30961/p',
  'https://prodaja.zelena-apoteka.com/catalog/dodaci-ishrani-19598/p',
  'https://prodaja.zelena-apoteka.com/catalog/homeopatija-25376/p',
  'https://prodaja.zelena-apoteka.com/catalog/medicinska-kozmetika-20087/p',
  'https://prodaja.zelena-apoteka.com/catalog/obolela-i-ostecena-koza-31116/p',
  'https://prodaja.zelena-apoteka.com/catalog/preparati-protiv-insekata-31016/p',
  'https://prodaja.zelena-apoteka.com/catalog/preparati-za-higijenu-31124/p',
  'https://prodaja.zelena-apoteka.com/catalog/prirodna-kozmetika-20057/p',
  'https://prodaja.zelena-apoteka.com/catalog/program-za-bebe-30951/p',
  'https://prodaja.zelena-apoteka.com/catalog/zdrava-hrana-31158/p',
  'https://prodaja.zelena-apoteka.com/catalog/kratak-rok-31161/p',
  'https://prodaja.zelena-apoteka.com/catalog/razno-31159/p',
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

    // Check for empty message
    const emptyMessage = await page.$('.message.info.empty');
    if (emptyMessage) {
      console.log(`No more products available on ${url}`);
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
          const title =
            element.querySelector('.prod-title')?.textContent?.trim() || '';
          const offStockElement = element.querySelector(
            '.prod-price-on-request',
          );

          if (offStockElement) {
            console.log(`Out of stock: ${title}`);
            return null;
          }

          const price =
            element.querySelector('.prod-price')?.textContent?.trim() || '';
          const link =
            element.querySelector('.prod-item > a')?.getAttribute('href') || '';
          const imgElement = element.querySelector('.prod-item > a > img');

          let img =
            imgElement?.getAttribute('data-src') ||
            imgElement?.getAttribute('src') ||
            '';

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
      let category =
        baseUrl.split('?')[0].split('/').filter(Boolean).slice(-2, -1)[0] || '';
      category = category.replace(/-\d+$/, '');

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
    await insertData(allProducts, 'Zelena Apoteka');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
