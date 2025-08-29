import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/bubrezi/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/debelo-crevo/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/donji-disajni-putevi/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/gornji-disajni-putevi/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/gusteraca/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/jetra/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/kostani-misicni-sistem/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/koza-i-kosa/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/mokracni-kanali-i-besika/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/nervni-sistem/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/pluca/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/reproduktivni-sistemi/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/slezina-i-imuni-sistem/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/srce/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/stitna-zlezda/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/tanko-crevo/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/vaskularni-sistem/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/zeludac/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-po-nameni/zucna-kesa/',
  'https://www.mocbilja.rs/kategorija-proizvoda/filter-cajevi/',
  'https://www.mocbilja.rs/kategorija-proizvoda/biljne-kapi-tinkture/',
  'https://www.mocbilja.rs/kategorija-proizvoda/cajne-mesavine/',
  'https://www.mocbilja.rs/kategorija-proizvoda/jednokomponentni/',
  'https://www.mocbilja.rs/kategorija-proizvoda/fitopreparati/',
  'https://www.mocbilja.rs/kategorija-proizvoda/kozmeticki-preparati/',
  'https://www.mocbilja.rs/kategorija-proizvoda/preparati-na-bazi-pcelinjih-proizvoda/',
  'https://www.mocbilja.rs/kategorija-proizvoda/samo-u-nasim-apotekama/',
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
      .waitForSelector('.product', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product', (elements) => {
      return elements
        .map((element) => {
          const title = element.querySelector('h2')?.textContent?.trim() || '';
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            console.log(`Product out of stock: ${title}`);
            return null;
          }
          let price = '';
          const priceElement = element.querySelector('.price');
          const newPriceElement = priceElement?.querySelector(
            'ins .woocommerce-Price-amount',
          );

          if (newPriceElement) {
            price = newPriceElement.textContent?.trim() || '';
          } else {
            price =
              priceElement
                ?.querySelector('.woocommerce-Price-amount')
                ?.textContent?.trim() || '';
          }

          const link = element.querySelector('a')?.getAttribute('href') || '';
          const imageElement = element.querySelector('img');

          let img =
            imageElement?.getAttribute('data-src') ||
            imageElement?.getAttribute('src') ||
            '';

          if (img.startsWith('data:image')) {
            img = imageElement?.getAttribute('data-original') || img;
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

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.next.page-numbers');
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
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
      const sanitizedUrl = baseUrl.replace(/\/+$/, '');
      const urlWithoutPage = sanitizedUrl.split('/page/')[0];
      const category = urlWithoutPage.split('/').pop() || 'unknown-category';
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}page/${pageNum}`;
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

async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Moc Bilja');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await closeDatabase();
  }
}

// Run the scraper
main();
