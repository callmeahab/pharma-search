import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://rs.proteini.si/proteini',
  'https://rs.proteini.si/aminokiseline',
  'https://rs.proteini.si/mrsavljenje',
  'https://rs.proteini.si/outlet-ponuda',
  'https://rs.proteini.si/bez-grize-savesti',
  'https://rs.proteini.si/kreatin',
  'https://rs.proteini.si/pre-workout',
  'https://rs.proteini.si/energija',
  'https://rs.proteini.si/gaineri',
  'https://rs.proteini.si/zdravlje-i-dobar-osecaj',
  'https://rs.proteini.si/posni-proizvodi',
  'https://rs.proteini.si/hormonski-stimulansi',
  'https://rs.proteini.si/oprema-za-vezbanje',
  'https://rs.proteini.si/dodaci',
  'https://rs.proteini.si/borilacka-oprema',
];
const baseUrl = 'https://rs.proteini.si';

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const category = url.split('/').pop() || '';

  try {
    // Wait for products to be visible
    await page
      .waitForSelector('.product-card', { timeout: 10000 })
      .catch(() => console.log('Retrying product detection...'));

    // Wait for images to load
    await page
      .waitForFunction(
        () => {
          const images = document.querySelectorAll('.product-card img');
          return Array.from(images).every(
            (img) => (img as HTMLImageElement).complete,
          );
        },
        { timeout: 10000 },
      )
      .catch(() => {});

    const products = await page.$$eval('.product-card', (elements) => {
      return elements.map((element) => {
        const title = element.querySelector('h4')?.textContent?.trim() || '';
        const priceElement = element.querySelector('.price');
        const price = priceElement?.textContent?.trim() || '';
        const link =
          element
            .querySelector('.product-card-image > a')
            ?.getAttribute('href') || '';
        const img =
          element
            .querySelector('.product-card-image img')
            ?.getAttribute('src') || '';

        return { title, price, link, img };
      });
    });

    if (products.length > 0) {
      for (const product of products) {
        if (!scrapedTitles.has(product.title)) {
          allProducts.push({
            title: product.title,
            price: product.price,
            category: category,
            link: `${baseUrl}${product.link}`,
            thumbnail: `${baseUrl}${product.img}`,
            photos: `${baseUrl}${product.img}`,
          });
          scrapedTitles.add(product.title);
        }
      }
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping page: ${(error as Error).message}`);
    return [];
  }
}

async function hasNextPage(page: Page, nextValue: number): Promise<boolean> {
  try {
    const nextButton = await page.$(
      `.jet-filters-pagination__item[data-value="${nextValue}"]`,
    );
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
  }
}

async function scrapeMultiplePages(): Promise<Product[]> {
const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  try {
    const page = await browser.newPage();
    await ScraperUtils.configurePage(page);
    let allScrapedProducts: Product[] = [];

    for (const url of baseUrls) {
      console.log(`Scraping ${url}`);

      // Initial page load with retry
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          success = true;
        } catch (error) {
          console.log(
            `Attempt ${retryCount + 1} to load page failed: ${error}`,
          );
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      if (!success) {
        console.log(`Failed to load ${url} after ${maxRetries} attempts`);
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      let loadMoreAttempts = 0;
      const maxLoadMoreAttempts = 10; // Prevent infinite loops

      while (loadMoreAttempts < maxLoadMoreAttempts) {
        // Get current products
        const products = await scrapePage(page, url);
        if (products.length > 0) {
          allScrapedProducts = [...allScrapedProducts, ...products];
          console.log(
            `Found ${products.length} products. Total: ${allScrapedProducts.length}`,
          );
        }

        try {
          // Check if button exists and is visible
          const buttonExists = await page.evaluate(() => {
            const button = document.querySelector(
              '[data-list="load_products"]',
            );
            return button && window.getComputedStyle(button).display !== 'none';
          });

          if (!buttonExists) {
            console.log('No more products to load');
            break;
          }

          // Click using multiple methods to ensure it works
          await Promise.any([
            // Method 1: Direct click
            page.click('[data-list="load_products"]'),
            // Method 2: JavaScript click
            page.evaluate(() => {
              const button = document.querySelector(
                '[data-list="load_products"]',
              );
              if (button) (button as HTMLElement).click();
            }),
            // Method 3: Dispatch click event
            page.evaluate(() => {
              const button = document.querySelector(
                '[data-list="load_products"]',
              );
              if (button) {
                button.dispatchEvent(
                  new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                  }),
                );
              }
            }),
          ]).catch(() => {
            throw new Error('Failed to click button');
          });

          console.log('Clicked load more button, waiting for new products...');
          await new Promise((resolve) => setTimeout(resolve, 3000));
          loadMoreAttempts++;
        } catch (error) {
          console.log('No more products to load');
          break;
        }
      }
    }

    console.log(`Total unique products found: ${allScrapedProducts.length}`);
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
    
    const allProducts = await scrapeMultiplePages();
    

  if (allProducts.length > 0) {
    await insertData(allProducts, 'Proteini');
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
