import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrls = [
  'https://proteinbox.rs/c/proteini',
  'https://proteinbox.rs/c/proteini/whey-protein',
  'https://proteinbox.rs/c/proteini/isolate-protein',
  'https://proteinbox.rs/c/aminokiseline',
  'https://proteinbox.rs/c/aminokiseline/arginin',
  'https://proteinbox.rs/c/aminokiseline/bcaa',
  'https://proteinbox.rs/c/aminokiseline/glutamin',
  'https://proteinbox.rs/c/kreatin',
  'https://proteinbox.rs/c/kreatin/kreatin-monohidrat',
  'https://proteinbox.rs/c/vitamini',
  'https://proteinbox.rs/c/minerali',
  'https://proteinbox.rs/c/minerali/magnezijum',
  'https://proteinbox.rs/c/fitnes-oprema',
  'https://proteinbox.rs/c/gejneri',
  'https://proteinbox.rs/c/zastita-zglobova-tetiva-i-ligamenata',
  'https://proteinbox.rs/c/pre-workout',
  'https://proteinbox.rs/c/sagorevaci-masti',
  'https://proteinbox.rs/c/tribulus',
];

// Function to scrape a single page for products
async function scrapePage(
  page: Page,
  url: string,
  baseUrl: string,
): Promise<Product[]> {
  try {
    await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Extract category from baseUrl
    const category =
      baseUrl.split('/c/')[1]?.split('/')[0] ||
      baseUrl.split('proteinbox.rs/')[1]?.split('/')[0] ||
      '';

    // Update selector to match new HTML structure
    await page.waitForSelector('.products.elementor-grid li.product', {
      visible: true,
      timeout: 20000,
    });

    // Scroll and wait longer for images
    await ScraperUtils.autoScroll(page);
    await ScraperUtils.delay(5000); // Increased delay to 5 seconds

    // Additional wait for lazy-loaded images
    await page
      .waitForFunction(
        () => {
          const images = document.querySelectorAll(
            '.attachment-woocommerce_thumbnail',
          );
          return Array.from(images).every(
            (img) =>
              img.getAttribute('src')?.includes('wp-content/uploads') ||
              img.getAttribute('data-lazy-src')?.includes('wp-content/uploads'),
          );
        },
        { timeout: 10000 },
      )
      .catch(() => console.log('Timeout waiting for images to load'));

    if (await page.$('.captcha-container')) {
      console.log('CAPTCHA detected, attempting solve...');
      const solved = await ScraperUtils.solveImageCaptcha(page);
      if (!solved) throw new Error('CAPTCHA solve failed');
    }

    const products = await page.evaluate((categoryArg) => {
      const productElements = document.querySelectorAll(
        '.products.elementor-grid li.product',
      );
      return Array.from(productElements)
        .map((element) => {
          // Check if product is out of stock
          if (element.querySelector('.out-of-stock-text')) {
            return null;
          }

          const titleElement = element.querySelector(
            '.woocommerce-loop-product__title',
          );
          const title = titleElement?.textContent?.trim() || '';

          let price = '';
          const priceElement = element.querySelector('.price');

          if (priceElement) {
            // Check for discount price first
            const discountPrice = priceElement.querySelector(
              'ins .woocommerce-Price-amount',
            );
            const regularPrice = priceElement.querySelector(
              'del .woocommerce-Price-amount, .price > .woocommerce-Price-amount:only-child',
            );

            // Use discount price if available, otherwise use regular price
            const priceToUse = discountPrice || regularPrice;
            price =
              priceToUse?.textContent?.trim().replace('RSD', '').trim() || '';
          }

          const linkElement = element.querySelector(
            '.woocommerce-LoopProduct-link',
          );
          const link = linkElement?.getAttribute('href') || '';

          const imgElement = element.querySelector(
            '.attachment-woocommerce_thumbnail',
          );
          let img = '';

          if (imgElement) {
            // Helper function to validate image URL
            const isValidImageUrl = (url: string | null) => {
              return (
                url &&
                url.includes('wp-content/uploads') &&
                !url.startsWith('data:image') &&
                !url.includes('svg')
              );
            };

            // Try data-lazy-src first as it's usually the full resolution image
            const lazySrc = imgElement.getAttribute('data-lazy-src');
            if (isValidImageUrl(lazySrc)) {
              img = lazySrc!;
            } else {
              // Try srcset next
              const srcset = imgElement.getAttribute('srcset');
              if (srcset) {
                const srcsetUrls = srcset
                  .split(',')
                  .map((s) => s.trim().split(' ')[0])
                  .filter(isValidImageUrl);
                if (srcsetUrls.length > 0) {
                  img = srcsetUrls[0];
                }
              }

              // Fallback to src
              if (!img) {
                const src = imgElement.getAttribute('src');
                if (isValidImageUrl(src)) {
                  img = src!;
                }
              }
            }
          }

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
            Boolean(product.price) &&
            Boolean(product.thumbnail) &&
            product.thumbnail.includes('wp-content/uploads'), // Extra validation
        );
    }, category);

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
      while (true) {
        const pageUrl =
          pageNumber === 1 ? `${baseUrl}` : `${baseUrl}/page/${pageNumber}`;

        console.log(`Scraping page: ${pageUrl}`);

        const products = await scrapePage(page, pageUrl, baseUrl);

        // Check if there are any products and if next page exists
        const hasNextPage = await page.evaluate(() => {
          return Boolean(document.querySelector('.next.page-numbers'));
        });

        if (products.length === 0 || !hasNextPage) {
          console.log(
            `Reached last page (${pageNumber}) for category ${baseUrl.split('/').pop()?.split('?')[0] || ''}`,
          );
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
    await insertData(allProducts, 'Proteinbox');
  } else {
    console.log('No products found.');
  }
});
