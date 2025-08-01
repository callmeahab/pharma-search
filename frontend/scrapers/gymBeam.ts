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
  'https://gymbeam.rs/proteini',
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

    // Wait for product links to appear
    await page.waitForSelector('[data-testid="link"][id^="product_item_"]', {
      visible: true,
      timeout: 20000,
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    // Scroll to bottom to trigger lazy loading
    await page.evaluate(async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 2000));
    });

    await ScraperUtils.delay(2000);

    if (await page.$('.captcha-container')) {
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const extracted = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll('[data-testid="link"][id^="product_item_"]');
      return Array.from(productElements).map((element) => {
        // Out of stock check
        const outOfStock = element.querySelector('.currently-not-available') !== null;
        // Name
        const name = element
          .querySelector('[data-test="recommended-products-title"] .line-clamp-2')
          ?.textContent?.trim();
        // RSD Price
        const spanTexts = Array.from(element.querySelectorAll('span')).map(s => s.textContent);
        // Extract RSD price from spanTexts
        const rsdPriceText = spanTexts.find(t => t && /≈\([\d.,]+ RSD\)/.test(t));
        let rsdPrice = 0;
        if (rsdPriceText) {
          const match = rsdPriceText.match(/≈\(([\d.,]+) RSD\)/);
          if (match) {
            const priceText = match[1];
            let normalized = priceText;

// Remove currency symbols and trim
            normalized = normalized.replace(/[^\d.,]/g, '').trim();

            if (normalized.includes(',') && normalized.includes('.')) {
              // Assume comma is thousand separator, dot is decimal
              normalized = normalized.split('.')[0].replace(/,/g, '');
            } else if (normalized.includes(',') && !normalized.includes('.')) {
              // Assume comma is decimal separator
              normalized = normalized.split(',')[0].replace(/\./g, '');
            } else if (normalized.includes('.')) {
              // Assume dot is decimal separator
              normalized = normalized.split('.')[0].replace(/,/g, '');
            } else {
              // No decimal, just remove any stray separators
              normalized = normalized.replace(/[^\d]/g, '');
            }

            rsdPrice = parseInt(normalized, 10);

          }
        }
        // Link and image
        const link = element.getAttribute('href');
        const imageUrl = element.querySelector('img')?.getAttribute('src');
        return {
          outOfStock,
          name,
          rsdPrice,
          link,
          imageUrl
        };
      });
    }, category);
    const products = extracted
      .filter(p => !p.outOfStock && p.name && p.rsdPrice && p.link && p.imageUrl)
      .map(p => ({
        title: p.name!,
        price: p.rsdPrice.toString(),
        link: p.link!,
        thumbnail: p.imageUrl!,
        photos: p.imageUrl!,
        category,
      }));
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

      // Wait for product links to appear
      await page.waitForSelector('[data-testid="link"][id^="product_item_"]', {
        visible: true,
        timeout: 20000,
      });
      await new Promise(resolve => setTimeout(resolve, 5000));
      // Scroll to bottom to trigger lazy loading
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(resolve => setTimeout(resolve, 2000));
      });

      let previousProductCount = 0;
      while (true) {
        // Get current products
        const products = await page.evaluate((categoryArg) => {
          const productElements = document.querySelectorAll('[data-testid="link"][id^="product_item_"]');
          return Array.from(productElements).map((element) => {
            // Out of stock check
            const outOfStock = element.querySelector('.currently-not-available') !== null;
            // Name
            const name = element
              .querySelector('[data-test="recommended-products-title"] .line-clamp-2')
              ?.textContent?.trim();
            // RSD Price
            const spanTexts = Array.from(element.querySelectorAll('span')).map(s => s.textContent);
            // Extract RSD price from spanTexts
            const rsdPriceText = spanTexts.find(t => t && /≈\([\d.,]+ RSD\)/.test(t));
            let rsdPrice = 0;
            if (rsdPriceText) {
              const match = rsdPriceText.match(/≈\(([\d.,]+) RSD\)/);
              if (match) {
                const priceText = match[1];
                let normalized = priceText;

// Remove currency symbols and trim
                normalized = normalized.replace(/[^\d.,]/g, '').trim();

                if (normalized.includes(',') && normalized.includes('.')) {
                  // Assume comma is thousand separator, dot is decimal
                  normalized = normalized.split('.')[0].replace(/,/g, '');
                } else if (normalized.includes(',') && !normalized.includes('.')) {
                  // Assume comma is decimal separator
                  normalized = normalized.split(',')[0].replace(/\./g, '');
                } else if (normalized.includes('.')) {
                  // Assume dot is decimal separator
                  normalized = normalized.split('.')[0].replace(/,/g, '');
                } else {
                  // No decimal, just remove any stray separators
                  normalized = normalized.replace(/[^\d]/g, '');
                }

                rsdPrice = parseInt(normalized, 10);
              }
            }
            // Link and image
            const link = element.getAttribute('href');
            const imageUrl = element.querySelector('img')?.getAttribute('src');
            return {
              outOfStock,
              name,
              rsdPrice,
              link,
              imageUrl
            };
          });
        }, baseUrl.split('/').pop()?.split('-').slice(0, -1).join('-') || '');
        // Now filter and map to products
        const currentProducts = products
          .filter(p => !p.outOfStock && p.name && p.rsdPrice && p.link && p.imageUrl)
          .map(p => ({
            title: p.name!,
            price: p.rsdPrice.toString(),
            link: p.link!,
            thumbnail: p.imageUrl!,
            photos: p.imageUrl!,
            category: baseUrl.split('/').pop()?.split('-').slice(0, -1).join('-') || '',
          }));
        // Only add new products
        const newProducts = currentProducts.slice(previousProductCount);
        allScrapedProducts = [...allScrapedProducts, ...newProducts];
        previousProductCount = currentProducts.length;

        // Check for and click "Load More" button
        const loadMoreButton = await page.$('button[title="Prikaži više proizvoda"]');
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
                '[data-testid="link"][id^="product_item_"]',
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
      console.log('Total products found for this category:', allScrapedProducts.length);
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
