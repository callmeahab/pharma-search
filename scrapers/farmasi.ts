import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product, initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://farmasi.rs/farmasi/product-list/outlet?cid=defc8d32-3fe2-f011-8519-02f716a02c8f',
  'https://farmasi.rs/farmasi/product-list/posebne-ponude?cid=ceb9a65a-c7b3-f011-8519-02f716a02c8f',
  'https://farmasi.rs/farmasi/product-list/noviteti?cid=369b5c56-0cf6-eb11-8337-000d3a71539d',
  'https://farmasi.rs/farmasi/product-list/makeup?cid=2bf65b5e-60d3-eb11-a315-005056010963',
  'https://farmasi.rs/farmasi/product-list/nega-ko%C5%BEe?cid=5aecb19a-63d3-eb11-a315-005056010963',
  'https://farmasi.rs/farmasi/product-list/nutriplus?cid=36f6d965-66d3-eb11-a315-005056010963',
  'https://farmasi.rs/farmasi/product-list/nega-kose?cid=020e6efe-64d3-eb11-a315-005056010963',
  'https://farmasi.rs/farmasi/product-list/gelovi-i-kreme-za-masa%C5%BEu?cid=68f41ce0-c6b3-f011-8519-02f716a02c8f',
  'https://farmasi.rs/farmasi/product-list/doma%C4%87instvo?cid=ecd6c31d-01d1-f011-8519-02f716a02c8f',
  'https://farmasi.rs/farmasi/product-list/mu%C5%A1karci?cid=cf171d76-66d3-eb11-a315-005056010963',
  'https://farmasi.rs/farmasi/product-list/licna-nega?cid=2b99ca57-65d3-eb11-a315-005056010963',
];

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await ScraperUtils.delay(3000);

    // Scroll to load all products (SPA infinite scroll)
    let previousHeight = 0;
    let scrollAttempts = 0;
    while (scrollAttempts < 100) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);
      if (currentHeight === previousHeight) break;
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await ScraperUtils.delay(2000);
      previousHeight = currentHeight;
      scrollAttempts++;
    }

    // Try to find product cards - check what selectors work
    const products = await page.evaluate((cat) => {
      const elements = document.querySelectorAll('[class*="styles_card__"]');

      return Array.from(elements).map((element) => {
        const titleEl = element.querySelector('[data-testid="productName"]');
        const title = titleEl?.textContent?.trim() || '';

        const priceEl = element.querySelector('[data-testid="priceText"]');
        const price = priceEl?.getAttribute('data-value') || priceEl?.textContent?.trim() || '';

        const codeEl = element.querySelector('[data-testid="productCode"]');
        const code = codeEl?.getAttribute('data-value') || '';
        const link = code ? `https://farmasi.rs/farmasi/product/${code}` : '';

        const imgEl = element.querySelector('[data-testid="productImage"]') as HTMLImageElement | null;
        const img = imgEl?.getAttribute('src') || '';

        return { title, price, link, img, category: cat };
      }).filter(p => p.title && p.title.length > 0);
    }, category);

    for (const product of products) {
      if (!scrapedTitles.has(product.title)) {
        allProducts.push({
          title: product.title,
          price: product.price,
          category: product.category,
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
      const category = decodeURIComponent(baseUrl.split('/product-list/')[1]?.split('?')[0] || '');
      console.log(`Scraping category: ${category}`);

      const products = await scrapePage(page, baseUrl, category);
      console.log(`Found ${products.length} products in ${category}`);

      if (products.length > 0) {
        allScrapedProducts = [...allScrapedProducts, ...products];
      }

      await ScraperUtils.delay(3000);
    }

    console.log(`Scraping completed. Total products found: ${allScrapedProducts.length}`);
    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

async function main() {
  try {
    await initializeDatabase();
    const allProducts = await scrapeMultipleBaseUrls();

    if (allProducts.length > 0) {
      await insertData(allProducts, 'Farmasi');
      console.log(`Successfully stored ${allProducts.length} products`);
    } else {
      console.log('No products found.');
    }
  } catch (error) {
    console.error('Scraper failed:', error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

main();
