import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://gymbeam.rs/sportska-ishrana',
  'https://gymbeam.rs/zdrava-hrana',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  baseUrl: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Extract category from baseUrl
    const category =
      baseUrl.split('/').pop()?.split('-').slice(0, -1).join('-') || '';

    // Update selector to match new HTML structure
    await page.waitForSelector('[data-testid="link"]', {
      visible: true,
      timeout: 20000,
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll('[data-testid="link"]');
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          const outOfStock =
            element.querySelector('.currently-not-available') !== null;
          if (outOfStock) {
            return null;
          }

          const name = element
            .querySelector('[data-test="recommended-products-title"]')
            ?.textContent?.trim();
          const rsdPriceElement = element
            .querySelector('.text-grey-300.text-sm.font-normal')
            ?.textContent?.trim();
          const rsdPrice = rsdPriceElement
            ? parseFloat(rsdPriceElement.replace(/[^\d.]/g, ''))
            : 0;
          const link = element.getAttribute('href');
          const imageUrl = element.querySelector('img')?.getAttribute('src');

          if (!name || !rsdPrice || !link || !imageUrl) {
            return null;
          }

          return {
            title: name,
            price: rsdPrice.toString(),
            link,
            thumbnail: imageUrl,
            photos: imageUrl,
            category: categoryArg,
          };
        })
        .filter(
          (product): product is NonNullable<typeof product> => product !== null,
        );
    }, category);

    return products;
  } catch (error) {
    console.error(`Error scraping page ${url}:`, error);
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
      console.log(`Scraping category: ${baseUrl}`);

      // Navigate to the base URL
      await page.goto(baseUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Handle cookie consent if present
      try {
        const cookieButton = await page.waitForSelector(
          '#CybotCookiebotDialogBodyButtonDecline',
          {
            visible: true,
            timeout: 5000,
          },
        );
        if (cookieButton) {
          console.log('Handling cookie consent...');
          await cookieButton.click();
          await ScraperUtils.delay(1000); // Wait for dialog to close
        }
      } catch (error) {
        console.log('No cookie consent dialog found');
      }

      // Wait for initial products to load
      await page.waitForSelector('[data-testid="link"]', {
        visible: true,
        timeout: 20000,
      });

      let previousProductCount = 0;
      while (true) {
        // Get current products
        const currentProducts = await page.evaluate(
          (categoryArg) => {
            const productElements = document.querySelectorAll(
              '[data-testid="link"]',
            );
            return Array.from(productElements)
              .map((element) => {
                // Check if product is out of stock
                const outOfStock =
                  element.querySelector('.currently-not-available') !== null;
                if (outOfStock) {
                  return null;
                }

                const name = element
                  .querySelector('[data-test="recommended-products-title"]')
                  ?.textContent?.trim();
                const rsdPriceElement = element
                  .querySelector(
                    '.text-sm.font-bold.text-secondary > .text-grey-300',
                  )
                  ?.textContent?.trim();
                const rsdPrice = rsdPriceElement
                  ? parseFloat(rsdPriceElement.replace(/[^\d.]/g, ''))
                  : 0;
                const link = element.getAttribute('href');
                const imageUrl = element
                  .querySelector('img')
                  ?.getAttribute('src');

                if (!name || !rsdPrice || !link || !imageUrl) {
                  return null;
                }

                return {
                  title: name,
                  price: rsdPrice.toString(),
                  link,
                  thumbnail: imageUrl,
                  photos: imageUrl,
                  category: categoryArg,
                };
              })
              .filter(
                (product): product is NonNullable<typeof product> =>
                  product !== null,
              );
          },
          baseUrl.split('/').pop()?.split('-').slice(0, -1).join('-') || '',
        );

        // Only add new products
        const newProducts = currentProducts.slice(previousProductCount);
        allScrapedProducts = [...allScrapedProducts, ...newProducts];
        previousProductCount = currentProducts.length;

        // Check for and click "Load More" button
        const loadMoreButton = await page.$(
          'button[title="Prikaži više proizvoda"]',
        );
        if (!loadMoreButton) {
          console.log('No more products to load');
          break;
        }

        // Click the button and wait for new products to load
        await loadMoreButton.click();
        await ScraperUtils.delay(2000); // Wait for animation/loading

        // Wait for new products to appear
        try {
          await page.waitForFunction(
            (previousCount) => {
              const currentCount = document.querySelectorAll(
                '[data-testid="link"]',
              ).length;
              return currentCount > previousCount;
            },
            { timeout: 10000 },
            previousProductCount,
          );
        } catch (error) {
          console.log('No new products loaded after clicking "Load More"');
          break;
        }
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
    await insertData(allProducts, 'Gym Beam');
  } else {
    console.log('No products found.');
  }
});
