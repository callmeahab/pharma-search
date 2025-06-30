import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrl = 'https://benu.rs';
const baseUrls = [
  'https://benu.rs/livsane-1612525398',
  'https://benu.rs/dijetetski-suplementi',
  'https://benu.rs/dermokozmetika',
  'https://benu.rs/mame-bebe-i-deca',
  'https://benu.rs/higijena-nega-i-kozmetika',
  'https://benu.rs/medicinska-oprema-i-materijali',
  'https://benu.rs/zdrava-hrana-cajevi-i-biljni-preparati',
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
      .waitForSelector('.product-box', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-box', (elements) => {
      return elements
        .map((element) => {
          const title =
            element.querySelector('.product-box__name')?.textContent?.trim() ||
            '';
          const offStockElement = element.querySelector(
            '.product-box__availability.u-lh-n.u-c-red',
          );

          if (offStockElement) {
            return null;
          }

          const priceElement = element.querySelector('.product-box__price');
          let price =
            priceElement?.querySelector('strong')?.textContent?.trim() || '';

          const link =
            element.querySelector('.product-box__link')?.getAttribute('href') ||
            '';
          const img =
            element
              .querySelector('.product-box__image img')
              ?.getAttribute('src') || '';

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

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.legacy-ajax.next');
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
      const category = baseUrl.split('/').pop()?.split('?')[0] || '';
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}?page=${pageNum}`;
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

        const nextPageExists = await hasNextPage(page);
        if (!nextPageExists) {
          console.log(`No next page found for ${pageUrl}, stopping...`);
          break;
        }

        pageNum++;
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Benu');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
