import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://www.vitalikum.rs/amino-kiseline',
  'https://www.vitalikum.rs/antioksidanti',
  'https://www.vitalikum.rs/biljni-ekstrakti',
  'https://www.vitalikum.rs/esencijalne-masne-kiseline',
  'https://www.vitalikum.rs/kreatin',
  'https://www.vitalikum.rs/minerali',
  'https://www.vitalikum.rs/oporavak-i-regeneracija',
  'https://www.vitalikum.rs/ostalo',
  'https://www.vitalikum.rs/povecanje-performansi',
  'https://www.vitalikum.rs/povecanje-telesne-tezine-misicne-mase',
  'https://www.vitalikum.rs/povecanje-testosterona-i-hormona-rasta',
  'https://www.vitalikum.rs/proteini',
  'https://www.vitalikum.rs/proteinske-cokoladice',
  'https://www.vitalikum.rs/sagorevaci-masti',
  'https://www.vitalikum.rs/sportska-oprema',
  'https://www.vitalikum.rs/transportni-sistemi-i-no-reaktori',
  'https://www.vitalikum.rs/vitamini',
  'https://www.vitalikum.rs/vitaminsko-mineralni-kompleksi',
  'https://www.vitalikum.rs/zamene-za-obrok-i-proteinski-napici',
  'https://www.vitalikum.rs/zastita-zglobova',
  'https://www.vitalikum.rs/zenski-kutak',
];

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

    // Extract category from URL - remove pagination parameter if present
    const categoryFromUrl = url.split('/').pop()?.split('?')[0] || category;

    // Wait for products to be visible
    await page.waitForSelector('.product-teaser', {
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
      await page.waitForSelector('.product-teaser', { timeout: 10000 });
    } catch (error) {
      console.log('No products found on page');
      return [];
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll('.product-teaser');
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          if (element.querySelector('input[value="Nema na lageru"]')) {
            return null;
          }

          const titleElement = element.querySelector('.node__title a');
          const title = titleElement?.textContent?.trim() || '';

          // Get price from the table cell with class price-amount
          const priceElement = element.querySelector('.price-amount');
          const price = priceElement?.textContent?.trim() || '';

          const linkElement = element.querySelector('.node__title a');
          const link = linkElement?.getAttribute('href') || '';

          const imgElement = element.querySelector('.teaser-image img');
          const img = imgElement?.getAttribute('src') || '';

          return {
            title,
            price,
            link: link.startsWith('http')
              ? link
              : `https://www.vitalikum.rs${link}`,
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
      // Extract category from URL by taking the last segment
      const category = baseUrl.split('/').pop() || '';

      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}?page=${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, category);
        if (products.length === 0) {
          console.log(`No products found on page ${pageNumber}, stopping...`);
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];
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
    await insertData(allProducts, 'Vitalikum');
  } else {
    console.log('No products found.');
  }
});
