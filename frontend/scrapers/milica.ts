import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.apotekamilica.rs/category/dodaci-ishrani',
  'https://www.apotekamilica.rs/category/bebe-i-deca',
  'https://www.apotekamilica.rs/category/cajevi-i-biljne-kapi',
  'https://www.apotekamilica.rs/category/dezinfekciona-sredstva-i-repelenti',
  'https://www.apotekamilica.rs/category/kosa-i-koza-glave',
  'https://www.apotekamilica.rs/category/kozmetika-i-nega',
  'https://www.apotekamilica.rs/category/medicinska-pomagala',
  'https://www.apotekamilica.rs/category/minerali-i-vitamini',
  'https://www.apotekamilica.rs/category/zdravlje-muskaraca',
  'https://apotekamilica.rs/category/zdravlje-zena',
  'https://www.apotekamilica.rs/category/oralna-higijena',
];

async function scrapePage(
  page: Page,
  url: string,
  category: string,
): Promise<Product[]> {
  const allProducts: Product[] = [];

  try {
    await Promise.all([
      page.goto(url, { waitUntil: 'domcontentloaded' }),
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
    ]);

    // Check for stop condition
    const stopButton = await page.$('#et-button-922193');
    if (stopButton) {
      console.log(
        `Stopping scraping for ${url} as #et-button-922193 is present.`,
      );
      return [];
    }

    // Function to extract products from current page
    const extractProducts = async () => {
      await page
        .waitForSelector('.custom-product-wrapper', {
          timeout: 5000,
        })
        .catch(() => console.log('No products found on page'));

      return await page.$$eval('.custom-product-wrapper', (elements) => {
        return elements
          .map((element) => {
            const title =
              element
                .querySelector('.custom-product-title')
                ?.textContent?.trim() || '';

            const addToCartButton = element.querySelector('.custom-add-button');
            if (!addToCartButton) {
              console.log(`Out of stock: ${title}`);
              return null;
            }

            let price = '';
            const priceElement = element.querySelector(
              '.custom-product-price .woocommerce-Price-amount',
            );
            if (priceElement) {
              price = priceElement.textContent?.trim() || '';
            }

            const link =
              element
                .querySelector('.custom-product-image-container a')
                ?.getAttribute('href') || '';
            const img =
              element
                .querySelector('.custom-product-image')
                ?.getAttribute('src') || '';

            return { title, price, link, img };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
      });
    };

    // Initial product extraction
    let products = await extractProducts();
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

    console.log(`Initial scrape: ${allProducts.length} products found`);

    // Handle "Load More" button pagination
    while (true) {
      const loadMoreButton = await page.$('#load-more');
      if (!loadMoreButton) {
        console.log(
          'No more "Load More" buttons found, moving to next category',
        );
        break;
      }

      // Click the button and wait for new products to load
      await loadMoreButton.click();
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for products to load

      // Extract new products
      products = await extractProducts();
      const newProductsCount = products.length;

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

      console.log(
        `After load more: ${newProductsCount} new products found, total: ${allProducts.length}`,
      );

      // Add a small delay between clicks
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return allProducts;
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
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
      const categoryName = baseUrl.split('/category/')[1].split('/')[0];
      console.log(`Scraping category: ${categoryName}`);

      let retryCount = 0;
      const maxRetries = 2;
      let products: Product[] = [];

      while (retryCount < maxRetries) {
        try {
          products = await scrapePage(page, baseUrl, categoryName);
          if (products.length > 0) break;
        } catch (error) {
          console.error(`Error on attempt ${retryCount + 1}:`, error);
        }
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (products.length === 0) {
        console.log(
          `No products found for ${baseUrl}, moving to next category...`,
        );
        continue;
      }

      allScrapedProducts = [...allScrapedProducts, ...products];

      // Add small delay between categories
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log(
      `Scraping completed. Total products found: ${allScrapedProducts.length}`,
    );
    return allScrapedProducts;
  } finally {
    await ScraperUtils.cleanup();
    await browser.close();
  }
}

scrapeMultipleBaseUrls().then(async (allProducts) => {
  if (allProducts.length > 0) {
    await insertData(allProducts, 'Milica');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
