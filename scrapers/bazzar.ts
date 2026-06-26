import puppeteer from 'puppeteer-extra';
import { createWorker } from 'tesseract.js';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = ['https://bazzar.rs/c/lepota-i-nega?page='];
const baseUrl = 'https://bazzar.rs';

// A listing title is truncated when the site cut it mid-word and appended an
// ellipsis ("..." / "…"). Those are the only rows we re-fetch from the detail page.
function isTruncatedTitle(title: string): boolean {
  const t = (title || '').trim();
  return t.endsWith('...') || t.endsWith('…');
}

// Read the FULL product title from a Bazzar detail page. og:title carries the
// complete, untruncated name (verified: the listing <h3>, page <title> and the
// CSS-clamped card are truncated, but og:title and the <h1> are not). Falls back
// to <h1>. Returns '' on any failure so the caller keeps the (truncated) listing
// title rather than dropping the product.
async function fetchFullTitle(page: Page, link: string): Promise<string> {
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return await page.evaluate(() => {
      const og = document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
        ?.trim();
      if (og) return og;
      return document.querySelector('h1')?.textContent?.trim() || '';
    });
  } catch (error) {
    console.error(
      `Failed to fetch full title from ${link}: ${(error as Error).message}`,
    );
    return '';
  }
}

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  try {
    // Use a more lenient loading strategy
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for a short time to allow dynamic content to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    // Try to wait for results with a longer timeout
    try {
      await page.waitForSelector('.row[id="results"]', { timeout: 30000 });
    } catch (error) {
      console.log('Results container not found, checking if page is empty...');
      const emptyMessage = await page.$('.alert.alert-info');
      if (emptyMessage) {
        console.log('No products found on page, stopping...');
        return [];
      }
      throw error;
    }

    const products = await page.$$eval(
      '.row[id="results"] .card.card-product',
      (items, baseUrl, category) => {
        return items.map((item) => {
          const title = item.querySelector('h3')?.textContent?.trim() || '';
          const priceText =
            item.querySelector('.lead.mb-1 span')?.textContent?.trim() || '';
          const price = priceText
            .replace(/\s+/g, ' ')
            .replace(' RSD', '')
            .trim();
          const link = item.closest('a')?.getAttribute('href') || '';
          const img =
            item.querySelector('.product-img')?.getAttribute('src') || '';

          return {
            title,
            price,
            link: baseUrl + link,
            thumbnail: img,
            photos: img,
            category,
          };
        });
      },
      baseUrl,
      category,
    );

    // Bazzar's listing card <h3> hard-truncates the title to ~100 chars (cut
    // mid-word, with a literal "..." appended by the site), which drops the
    // second product / size in bundle titles. When a listing title looks
    // truncated, fetch the full, untruncated title from the product detail page
    // (og:title, with <h1> fallback) so grouping/search keep the size & dosage.
    // CRITICAL: re-fetch on SEPARATE pages, not `page` (which is mid-pagination on the
    // listing — navigating it to a detail URL detaches its frame and drops the rest of
    // the catalog). Limited concurrency keeps it quick.
    const truncated = products.filter((p) => isTruncatedTitle(p.title) && p.link);
    const POOL = 6;
    for (let i = 0; i < truncated.length; i += POOL) {
      await Promise.all(
        truncated.slice(i, i + POOL).map(async (product) => {
          const detailPage = await page.browser().newPage();
          try {
            const full = await fetchFullTitle(detailPage, product.link);
            if (full) product.title = full;
          } catch {
            /* keep the truncated listing title on failure */
          } finally {
            await detailPage.close();
          }
        }),
      );
    }

    // Filter duplicates
    const allProducts: Product[] = [];
    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push(product);
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
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security',
    '--window-size=1920,1080',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
  ];

  const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args,
    protocolTimeout: 120000,
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    let allScrapedProducts: Product[] = [];
    let consecutiveEmptyPages = 0;

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      while (true) {
        const pageUrl = `${baseUrl}${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, 'beauty');

        if (products.length === 0) {
          consecutiveEmptyPages++;
          console.log(
            `No products found on page ${pageNumber}, consecutive empty pages: ${consecutiveEmptyPages}`,
          );

          if (consecutiveEmptyPages >= 2) {
            console.log('Stopping scraping after 2 consecutive empty pages');
            break;
          }
        } else {
          consecutiveEmptyPages = 0; // Reset counter if we found products
          allScrapedProducts = [...allScrapedProducts, ...products];
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
async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();
    
    const allProducts = await scrapeMultipleBaseUrls();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Bazzar');
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
