import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product, initializeDatabase, closeDatabase } from './database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const baseUrl = 'https://www.ananas.rs';

export async function scrollPage(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

export async function ensureImagesLoaded(page: Page) {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => {
        const dataSrc = img.getAttribute('data-src');
        const srcset = img.getAttribute('data-srcset');
        if (dataSrc) img.src = dataSrc;
        if (srcset) img.srcset = srcset;
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 500));

    const allImagesLoaded = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.every((img) => {
        if (img.src.includes('data:image/gif;base64')) return false;
        return img.complete && img.naturalHeight > 0;
      });
    });

    if (allImagesLoaded) break;
    retries++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export function decodeNextJsImageUrl(src: string) {
  const urlMatch = src.match(/url=(.*?)(&|$)/);
  return urlMatch ? decodeURIComponent(urlMatch[1]) : src;
}

export async function scrapePage(
  page: Page,
  url: string,
  pageScrapedTitles: Set<string>
): Promise<{ products: Product[]; skipped: number; totalElements: number }> {
  const allProducts: Product[] = [];
  const category = url.split('/')[5]?.split('?')[0] || 'unknown';
  let pageSkipped = 0;
  let result: any;

  try {
    await ScraperUtils.goto(page, url, {
      settleMs: 250,
      timeout: 60000,
    });

    await page.waitForSelector('.ais-Hits-item', {
      timeout: 15000,
      visible: true,
    });

    await scrollPage(page);
    await ensureImagesLoaded(page);

    result = await page.evaluate((baseUrl: string) => {
      const allElements = Array.from(
        document.querySelectorAll('.ais-Hits-item'),
      );

      // Skip out-of-stock items (no specific class found in the new HTML)
      const skippedElements = allElements.filter((element) =>
        element.querySelector('.sc-492kdg-11'),
      );

      const keptElements = allElements.filter(
        (element) => !element.querySelector('.sc-492kdg-11'),
      );

      const products = keptElements.map((element) => {
        // Title from h3 tag
        const title = element.querySelector('h3')?.textContent?.trim() || '';

        // Price from span with class sc-1arj7wv-2 (current price, not the old price)
        const priceElement = element.querySelector('.sc-1arj7wv-2');
        const price = priceElement?.textContent?.trim() || '';

        // Link from anchor tag
        const link = element.querySelector('a.sc-v9wo15-0')?.getAttribute('href') || '';

        // Image - get all img tags and find the one with proper srcset
        const imgElements = element.querySelectorAll('img');
        let imgSrc = '';

        for (const imgElement of Array.from(imgElements)) {
          const possibleSources = [
            (() => {
              const ss = imgElement.getAttribute('srcset');
              if (!ss) return undefined;
              // Get the highest quality image from srcset
              const parts = ss.split(',').map(p => p.trim().split(' ')[0]).filter(Boolean);
              return parts[parts.length - 1];
            })(),
            imgElement.getAttribute('src'),
            imgElement.getAttribute('data-src'),
            imgElement.getAttribute('data-lazy'),
          ];

          for (const src of possibleSources) {
            if (src && !src.includes('data:image/gif;base64') && !src.includes('data:image/svg+xml') && !src.includes('/_next/static/media/')) {
              imgSrc = src;
              break;
            }
          }

          if (imgSrc) break;
        }

        return {
          title,
          price,
          link: baseUrl + link,
          img: imgSrc,
        };
      });

      return {
        products: products.filter((p) => p.img && p.title && p.price),
        skipped: skippedElements.length,
        totalFound: allElements.length,
      };
    }, baseUrl);

    if (result?.products?.length) {
      result.products = result.products.map((p: any) => ({
        ...p,
        img: decodeNextJsImageUrl(p.img)
      }));
    }

    pageSkipped = result.skipped;

    let duplicatesSkipped = 0;
    for (const product of result.products) {
      if (!pageScrapedTitles.has(product.title)) {
        const decodedImg = decodeNextJsImageUrl(product.img);

        allProducts.push({
          title: product.title,
          price: product.price,
          category,
          link: product.link,
          thumbnail: decodedImg,
          photos: decodedImg,
        });
        pageScrapedTitles.add(product.title);
      } else {
        duplicatesSkipped++;
      }
    }

    if (duplicatesSkipped > 0) {
      console.log(`🔁 Duplicates skipped: ${duplicatesSkipped}`);
    }

    console.log(
      `🟢 ${url} - Found ${result.totalFound} total elements, ${result.products.length} valid products (${allProducts.length} new, ${duplicatesSkipped} duplicates), Skipped ${pageSkipped} out-of-stock items`,
    );
  } catch (error) {
    console.error(`🔴 ${url} - Error: ${(error as Error).message}`);
  }

  return { products: allProducts, skipped: pageSkipped, totalElements: result?.totalFound || 0 };
}

export async function scrapeAnanasCategoryUrls(categoryUrls: string[]): Promise<{
  products: Product[];
  totalSkipped: number;
}> {
  const browser = await puppeteer.launch({
    headless: ScraperUtils.IS_HEADLESS,
    defaultViewport: null,
    args: ScraperUtils.getBrowserArgs(),
  });

  const page = await browser.newPage();
  await ScraperUtils.configurePage(page);
  let allScrapedProducts: Product[] = [];
  let totalSkipped = 0;

  try {
    for (const categoryUrl of categoryUrls) {
      const categoryScrapedTitles = new Set<string>();
      let pageIndex = 1;
      while (true) {
        const pageUrl = `${categoryUrl}?page=${pageIndex}`;
        console.log(`🌐 Scraping: ${pageUrl}`);

        const { products, skipped, totalElements } = await scrapePage(page, pageUrl, categoryScrapedTitles);
        totalSkipped += skipped;

        if (totalElements === 0) {
          console.log(`⏹️ Reached end of pagination at page ${pageIndex} - no elements found`);
          break;
        }

        console.log(`📄 Page ${pageIndex}: ${totalElements} elements found, ${products.length} new products processed`);

        allScrapedProducts = [...allScrapedProducts, ...products];
        pageIndex++;

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  } catch (error) {
    console.error(`🚨 Critical error: ${(error as Error).message}`);
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }

  return { products: allScrapedProducts, totalSkipped };
}

export async function runAnanasScraper(categoryUrls: string[], scraperName: string) {
  try {
    await initializeDatabase();

    console.log(`🚀 Starting ${scraperName} with ${categoryUrls.length} categories`);
    const { products } = await scrapeAnanasCategoryUrls(categoryUrls);

    if (products.length > 0) {
      await insertData(products, 'Ananas');
      console.log(`✅ ${scraperName}: Successfully stored ${products.length} products`);
    } else {
      console.log(`❌ ${scraperName}: No products found across all categories`);
    }
  } catch (error) {
    console.error(`${scraperName} failed:`, error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}
