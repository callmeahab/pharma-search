import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://maelia.rs/sr/catalog/suplementi-1483?page=',
  'https://maelia.rs/sr/catalog/ostalo-1481?page=',
  'https://maelia.rs/sr/catalog/pankreasni-hormoni-708?page=',
  'https://maelia.rs/sr/catalog/obu-a-1480?page=',
  'https://maelia.rs/sr/catalog/kozmetika-1478?page=',
  'https://maelia.rs/sr/catalog/medicinska-oprema-i-1479?page=',
  'https://maelia.rs/sr/catalog/pankreasni-hormoni-708?page=',
];
const baseLink = 'https://maelia.rs';

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
      .waitForSelector('.c-card-item-default', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.c-card-item-default', (elements) => {
      return elements
        .map((element) => {
          const title =
            element.querySelector('.card-item-name')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            console.log(`Product out of stock: ${title}`);
            return null;
          }

          const priceText =
            element.querySelector('.card-item-price')?.textContent?.trim() ||
            '';
          const price = priceText
            .replace(/Od\s*/, '')
            .replace(/\s+/g, ' ')
            .replace(' RSD', '')
            .trim();

          // Only remove last digit if it's a zero
          const formattedPrice =
            price.includes('.') &&
            price.split('.')[1].length === 3 &&
            price.endsWith('0')
              ? price.slice(0, -1)
              : price;

          const link =
            element.querySelector('.card-item-img')?.getAttribute('href') || '';
          const imageElement = element.querySelector('.card-item-img > img');

          let img =
            imageElement?.getAttribute('data-src') ||
            imageElement?.getAttribute('src') ||
            '';

          if (img.startsWith('data:image')) {
            img = imageElement?.getAttribute('data-original') || img;
          }

          return { title, formattedPrice, link, img };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    });

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.formattedPrice,
          category,
          link: baseLink + product.link,
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
      const category =
        baseUrl
          .split('/catalog/')[1]
          ?.split('-')
          .slice(0, -1)
          .join('-')
          .trim() || '';
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
    await insertData(allProducts, 'Maelia');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
