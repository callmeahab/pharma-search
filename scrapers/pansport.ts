// import puppeteer from 'puppeteer-extra';
// import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
// import { Page } from 'puppeteer';
// import { ScraperUtils } from './helpers/ScraperUtils';
//
// // Configure stealth plugin
// puppeteer.use(StealthPlugin());
//
// const scrapedTitles = new Set<string>();
// const baseUrls = [
//   'https://www.pansport.rs/amino-kiseline',
//   'https://www.pansport.rs/antioksidanti',
//   'https://www.pansport.rs/biljni-ekstrakti',
//   'https://www.pansport.rs/esencijalne-masne-kiseline',
//   'https://www.pansport.rs/kreatin',
//   'https://www.pansport.rs/minerali',
//   'https://www.pansport.rs/oporavak-i-regeneracija',
//   'https://www.pansport.rs/ostalo',
//   'https://www.pansport.rs/povecanje-performansi',
//   'https://www.pansport.rs/povecanje-telesne-tezine-misicne-mase',
//   'https://www.pansport.rs/povecanje-testosterona-i-hormona-rasta',
//   'https://www.pansport.rs/prelivi-i-namazi',
//   'https://www.pansport.rs/proteini',
//   'https://www.pansport.rs/proteinske-cokoladice',
//   'https://www.pansport.rs/regulisanje-probave',
//   'https://www.pansport.rs/sagorevaci-masti',
//   'https://www.pansport.rs/sportska-oprema',
//   'https://www.pansport.rs/transportni-sistemi-i-no-reaktori',
//   'https://www.pansport.rs/vitamini',
//   'https://www.pansport.rs/vitaminsko-mineralni-kompleksi',
//   'https://www.pansport.rs/zamene-za-obrok',
//   'https://www.pansport.rs/zastita-zglobova',
//   'https://www.pansport.rs/zenski-kutak',
// ];
//
// // Function to scrape a single page for products
// async function scrapePage(
//   page: Page,
//   url: string,
//   category: string,
// ): Promise<Product[]> {
//   try {
//     await page.goto(url, {
//       waitUntil: 'networkidle0',
//       timeout: 30000,
//     });
//
//     // Handle human verification button if present (SafeLine WAF)
//     try {
//       await page.waitForSelector('#sl-box', { timeout: 5000 });
//       // Wait for challenge script to fully load
//       await ScraperUtils.delay(2000);
//
//       const buttonClicked = await page.evaluate(() => {
//         const button = document.querySelector('#sl-box #sl-check') as HTMLButtonElement;
//         if (button && window.getComputedStyle(button).display !== 'none') {
//           button.click();
//           return true;
//         }
//         return false;
//       });
//
//       if (buttonClicked) {
//         console.log('Human verification detected, clicked Confirm button...');
//         await ScraperUtils.delay(5000);
//         // Wait for page to reload after verification
//         await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {});
//       }
//     } catch (e) {
//       // No verification needed or already passed, continue
//     }
//
//     // Wait for products to be visible
//     await page.waitForSelector('.product-teaser-holder', {
//       visible: true,
//       timeout: 20000,
//     });
//
//     // Add a small delay to ensure dynamic content loads
//     await ScraperUtils.delay(2000);
//
//     // Check for CAPTCHA
//     if (await page.$('.captcha-container')) {
//       console.log('CAPTCHA detected, attempting solve...');
//       const solved = await ScraperUtils.solveImageCaptcha(page);
//       if (!solved) throw new Error('CAPTCHA solve failed');
//     }
//
//     // Check if product wrappers exist
//     try {
//       await page.waitForSelector('.product-teaser-holder', { timeout: 10000 });
//     } catch (error) {
//       console.log('No products found on page');
//       return [];
//     }
//
//     const products = await page.$$eval(
//       '.product-teaser-holder',
//       (elements, categoryArg) => {
//         return elements.map((element) => {
//           const titleElement = element.querySelector('h4');
//           const title = titleElement?.textContent?.trim() || '';
//
//           const price =
//             element.querySelector('.price-amount')?.textContent?.trim() || '';
//           const linkElement = element.querySelector(
//             '.teaser-image > a',
//           ) as HTMLAnchorElement;
//           const link = linkElement?.href || '';
//
//           const imgElement = element.querySelector(
//             '.teaser-image > a img',
//           ) as HTMLImageElement;
//           const img = imgElement?.src || '';
//
//           return {
//             title,
//             price,
//             link,
//             thumbnail: img,
//             photos: img,
//             category: categoryArg,
//           };
//         });
//       },
//       category,
//     );
//
//     return products.filter((product) => product.title);
//   } catch (error) {
//     console.error(
//       `Error scraping ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`,
//     );
//     return [];
//   }
// }
//
// // Main scraping function with pagination
// async function scrapeMultipleBaseUrls(): Promise<Product[]> {
// const browser = await puppeteer.launch({
//     headless: true,
//     defaultViewport: null,
//     args: [
//       ...ScraperUtils.getBrowserArgs(),
//       '--disable-blink-features=AutomationControlled',
//       '--disable-dev-shm-usage',
//       '--disable-infobars',
//       '--window-size=1920,1080',
//       '--start-maximized',
//     ],
//     ignoreDefaultArgs: ['--enable-automation'],
//   });
//
//   try {
//     const page = await browser.newPage();
//     await ScraperUtils.configurePage(page);
//
//     // Remove webdriver property and other automation indicators
//     await page.evaluateOnNewDocument(() => {
//       // Remove webdriver property
//       Object.defineProperty(navigator, 'webdriver', {
//         get: () => undefined,
//       });
//
//       // Mock plugins
//       Object.defineProperty(navigator, 'plugins', {
//         get: () => [1, 2, 3, 4, 5],
//       });
//
//       // Mock languages
//       Object.defineProperty(navigator, 'languages', {
//         get: () => ['en-US', 'en'],
//       });
//
//       // Remove automation-related properties
//       delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
//       delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
//       delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
//     });
//
//     let allScrapedProducts: Product[] = [];
//
//     for (const baseUrl of baseUrls) {
//       const category = baseUrl.split('/').pop() || 'unknown';
//       const pageUrl = `${baseUrl}?items_per_page=All`;
//       console.log(`Scraping: ${pageUrl}`);
//
//       const products = await scrapePage(page, pageUrl, category);
//       if (products.length === 0) {
//         console.log(`No products found for ${category}`);
//         continue;
//       }
//
//       allScrapedProducts = [...allScrapedProducts, ...products];
//     }
//
//     return allScrapedProducts;
//   } finally {
//     await ScraperUtils.cleanup();
//     await browser.close();
//   }
// }
//
// // Execute the scraper
// async function main() {
//   try {
//     // Initialize database connection
//     await initializeDatabase();
//
//     const allProducts = await scrapeMultipleBaseUrls();
//
//
//   if (allProducts.length > 0) {
//     await insertData(allProducts, 'Pansport');
//   } else {
//     console.log('No products found.');
//   }
//   } catch (error) {
//     console.error('Scraper failed:', error);
//     process.exit(1);
//   } finally {
//     // Close database connection
//     await closeDatabase();
//   }
// }
//
// // Run the scraper
// main();
