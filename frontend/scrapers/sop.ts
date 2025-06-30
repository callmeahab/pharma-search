import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://sop.rs/kategorija/amino-kiseline',
  'https://sop.rs/kategorija/bcaa',
  'https://sop.rs/kategorija/gainer',
  'https://sop.rs/kategorija/glutamin',
  'https://sop.rs/kategorija/kreatin',
  'https://sop.rs/kategorija/no-reaktori',
  'https://sop.rs/kategorija/pojacivaci-hormona',
  'https://sop.rs/kategorija/protein',
  'https://sop.rs/kategorija/minerali',
  'https://sop.rs/kategorija/preworkout',
  'https://sop.rs/kategorija/sagorevaci',
  'https://sop.rs/kategorija/vitamini',
  'https://sop.rs/kategorija/kofein',
  'https://sop.rs/kategorija/cistaci-organizma',
  'https://sop.rs/kategorija/arginin',
  'https://sop.rs/kategorija/dijetetski-suplement',
  'https://sop.rs/kategorija/pica-za-oporavak-i-hidrataciju',
  'https://sop.rs/kategorija/opste-poboljsanje',
  'https://sop.rs/kategorija/preparati-za-poboljsanje-memorije',
  'https://sop.rs/kategorija/cregaatine',
  'https://sop.rs/kategorija/preparati-za-zastitu-zglobova',
  'https://sop.rs/kategorija/prevencija-dijabetesa',
  'https://sop.rs/kategorija/smrznuto-voce',
  'https://sop.rs/kategorija/ulje-za-pripremu-jela',
  'https://sop.rs/kategorija/ugljeni-hidrati',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<[Product[], boolean]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const categoryFromUrl =
      url.split('/kategorija/')[1]?.split('/')[0] || category;

    // Update selector to match new HTML structure
    await page.waitForSelector('.porto-tb-item.product', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    try {
      await page.waitForSelector('.porto-tb-item.product', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [[], false];
    }

    // Check if next page exists
    const hasNextPage = await page.evaluate(() => {
      return !!document.querySelector('.next.page-numbers');
    });

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll(
        '.porto-tb-item.product',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          if (element.querySelector('.stock.out-of-stock')) {
            return null;
          }

          const titleElement = element.querySelector('.post-title a');
          const title = titleElement?.textContent?.trim() || '';

          // Get the discounted price if it exists, otherwise get the regular price
          const priceContainer = element.querySelector('.price');
          let price = '';

          if (priceContainer) {
            // Check for discounted price first (ins element)
            const discountedPrice = priceContainer.querySelector(
              'ins .woocommerce-Price-amount',
            );
            if (discountedPrice) {
              price =
                discountedPrice.textContent?.replace('RSD', '').trim() || '';
            } else {
              // If no discount, get the regular price
              const regularPrice = priceContainer.querySelector(
                '.woocommerce-Price-amount',
              );
              price =
                regularPrice?.textContent?.replace('RSD', '').trim() || '';
            }
          }

          const linkElement = element.querySelector('.post-title a');
          const link = linkElement?.getAttribute('href') || '';

          const imgElement = element.querySelector('.img-responsive');
          const img = imgElement?.getAttribute('src') || '';

          return {
            title,
            price,
            link,
            thumbnail: img,
            photos: img,
            category: categoryArg,
          };
        })
        .filter(
          (product): product is NonNullable<typeof product> =>
            product !== null &&
            Boolean(product.title) &&
            Boolean(product.price),
        );
    }, categoryFromUrl);

    return [products, hasNextPage];
  } catch (error) {
    console.error(
      `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return [[], false];
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
      const category = baseUrl.split('/').pop() || '';

      let pageNumber = 1;
      let hasNextPage = true; // Initial value to enter the loop

      while (hasNextPage) {
        const pageUrl =
          pageNumber === 1
            ? `${baseUrl}?count=36`
            : `${baseUrl}/page/${pageNumber}?count=36`;

        console.log(`Scraping page: ${pageUrl}`);

        const [products, nextPageExists] = await scrapePage(
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

        if (!hasNextPage) {
          console.log(`No more pages found for category ${category}`);
          break;
        }

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
    await insertData(allProducts, 'Sop');
  } else {
    console.log('No products found.');
  }
});
