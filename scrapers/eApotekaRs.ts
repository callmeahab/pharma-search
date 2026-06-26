import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://www.eapoteka.rs/sr/svi-proizvodi/'];

// eapoteka.rs listing cards show a truncated <h3> title with a trailing ellipsis
// ("… 150…"), which drops the size/dosage. The product image's `alt` attribute carries
// the FULL untruncated title, so we read it from the listing directly (see the $$eval
// in scrapePage) — no per-product detail-page fetch needed.

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  // Category is always "svi-proizvodi" for this scraper (single base URL)
  const category = 'svi-proizvodi';

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    await page
      .waitForSelector('.product-preview-item', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const products = await page.$$eval('.product-preview-item', (elements) => {
      return elements
        .map((element) => {
          // The listing <h3> is truncated with a trailing ellipsis ("… 150…"), which
          // drops the size/dosage. The product image's `alt` carries the FULL title, so
          // use it whenever the h3 looks truncated — no slow detail-page fetch needed.
          const h3 = element.querySelector('h3')?.textContent?.trim() || '';
          const alt = element.querySelector('img')?.getAttribute('alt')?.trim() || '';
          const title = (h3.endsWith('...') || h3.endsWith('…')) && alt ? alt : h3;
          const offStockElement = element.querySelector('.aaa');

          if (offStockElement) {
            return null;
          }

          // Price structure: <span class="price">2.399<span class="price_decimal">00</span> <span class="price_currency">RSD</span></span>
          // We need only the integer part from .price, ignoring child .price_decimal span.
          const priceEl = element.querySelector('.price');
          let price = '';
          if (priceEl) {
            // Get only the direct text node (before the decimal span), or use data attribute
            const amountEl = priceEl.cloneNode(true) as HTMLElement;
            // Remove child spans to get just the main price digits
            amountEl.querySelectorAll('span').forEach(s => s.remove());
            const rawPrice = amountEl.textContent?.trim() || '';
            // rawPrice is like "2.399" (Serbian thousands separator) -> remove dots
            price = rawPrice.replace(/\./g, '').replace(/[^\d]/g, '');
          }
          // Markup is now `a.link-name > h3`, so the link is the .link-name anchor
          // (the old `h3 > a` matched nothing → every product was dropped).
          const link =
            element.querySelector('a.link-name')?.getAttribute('href') ||
            element.querySelector('a[href]')?.getAttribute('href') ||
            '';
          const imageElement = element.querySelector('.image-wrapper img');
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

    // (Full titles now come from the image `alt` in the $$eval above — no detail fetch.)

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
      let pageNumber = 1;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 2;

      while (consecutiveFailures < maxConsecutiveFailures) {
        const pageUrl = `${baseUrl}${pageNumber}?limit=48`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          console.log(`Attempt ${retryCount + 1}`);
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
          consecutiveFailures++;
          console.log(
            `No products found on page ${pageNumber} (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`,
          );

          if (consecutiveFailures >= maxConsecutiveFailures) {
            console.log(
              `Stopping after ${maxConsecutiveFailures} consecutive empty pages`,
            );
            break;
          }
        } else {
          consecutiveFailures = 0;
          allScrapedProducts = [...allScrapedProducts, ...products];
          // Pagination continues until a page returns no products
          // (consecutiveFailures). The old `.fa.fa-angle-right` next-page check
          // matched nothing in the live markup, so it stopped after page 1 —
          // capturing only ~48 of ~9,800 products.
        }

        pageNumber++;
        if (pageNumber > 400) break; // safety cap
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

// Execute the scraper
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'eApoteka');
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
