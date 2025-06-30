import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.dm.rs/sminka?allCategories.id0=010000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/nega-i-parfemi?allCategories.id0=020000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/kosa?allCategories.id0=110000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/muskarci?additionalDistributionChannels0=SEINZ&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/zdravlje?allCategories.id0=030000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/ishrana?allCategories.id0=040000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/bebe-i-deca?allCategories.id0=050000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/domacinstvo?allCategories.id0=060000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
  'https://www.dm.rs/ljubimci?allCategories.id0=070000&pageSize0=10&sort0=editorial_relevance&currentPage0=',
];

async function scrapePage(page: Page, category: string): Promise<Product[]> {
  try {
    // Add a more lenient timeout and catch specific timeout errors
    await page
      .waitForSelector('#product-tiles [data-dmid="product-tile"]', {
        timeout: 5000,
      })
      .catch(() => {
        // If selector times out, we assume no products are found
        return [];
      });

    // Check if products exist before trying to scrape
    const hasProducts = await page.$(
      '#product-tiles [data-dmid="product-tile"]',
    );
    if (!hasProducts) {
      return [];
    }

    const products = await page.$$eval(
      '#product-tiles [data-dmid="product-tile"]',
      (items, cat) =>
        items.map((item) => ({
          title:
            [
              item
                .querySelector('[data-dmid="product-description"] > span')
                ?.textContent?.trim(),
              item
                .querySelector('[data-dmid="product-description"] > a')
                ?.textContent?.trim(),
            ]
              .filter(Boolean)
              .join(' ') || '',
          price:
            item
              .querySelector('[data-dmid="price-localized"]')
              ?.textContent?.trim() || '',
          link:
            (
              item.querySelector(
                '[data-dmid="product-tile"] > a',
              ) as HTMLAnchorElement
            )?.href || '',
          thumbnail:
            (
              item.querySelector(
                '[data-dmid="product-tile"] > a > img',
              ) as HTMLImageElement
            )?.src || '',
          photos:
            (
              item.querySelector(
                '[data-dmid="product-tile"] > a > img',
              ) as HTMLImageElement
            )?.src || '',
          category: cat,
        })),
      category,
    );

    return products.filter((p) => p.title && !scrapedTitles.has(p.title));
  } catch (error) {
    console.error(`Error scraping ${category} page:`, error);
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
      const category = baseUrl.split('?')[0].split('/').pop() || '';
      let pageNumber = 0;
      let consecutiveEmptyPages = 0;

      while (consecutiveEmptyPages < 2) {
        // Stop after 2 empty pages in a row
        const pageUrl = `${baseUrl}${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        try {
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          const products = await scrapePage(page, category);
          console.log(
            `Scraped ${products.length} products from page ${pageNumber}`,
          );

          if (products.length === 0) {
            consecutiveEmptyPages++;
            console.log(`Empty page found (${consecutiveEmptyPages} in a row)`);
          } else {
            consecutiveEmptyPages = 0;
            allScrapedProducts = [...allScrapedProducts, ...products];
          }

          pageNumber++;
        } catch (error) {
          console.error(`Error on page ${pageNumber}:`, error);
          consecutiveEmptyPages++;
        }
      }

      console.log(`Finished scraping category: ${category}`);
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
    await insertData(allProducts, 'DM');
  } else {
    console.log('No products found.');
  }
});
