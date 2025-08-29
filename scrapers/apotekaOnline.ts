import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product , initializeDatabase, closeDatabase } from './helpers/database';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

// Configure stealth plugin
puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://www.apoteka-online.rs/catalog/mame-i-bebe-novogodisnja-ponuda-125',
  'https://www.apoteka-online.rs/catalog/zdravlje-novogodisnja-ponuda-124',
  'https://www.apoteka-online.rs/catalog/nega-lica-tela-i-kose-novogodisnja-ponuda-123',
  'https://www.apoteka-online.rs/catalog/promo-paketi-novogodisnja-ponuda-126',
  'https://www.apoteka-online.rs/catalog/dermo-kozmetika-33',
  'https://www.apoteka-online.rs/catalog/nega-lica-69',
  'https://www.apoteka-online.rs/catalog/ublazite-znake-starenja-30',
  'https://www.apoteka-online.rs/catalog/ciscenje-lica-74',
  'https://www.apoteka-online.rs/catalog/suva-i-izuzetno-suva-koza-31',
  'https://www.apoteka-online.rs/catalog/nega-usana-76',
  'https://www.apoteka-online.rs/catalog/masna-problematicna-i-mesovita-koza-32',
  'https://www.apoteka-online.rs/catalog/hidratacija-77',
  'https://www.apoteka-online.rs/catalog/hiperpigmentacije-50',
  'https://www.apoteka-online.rs/catalog/maske-za-lice-64',
  'https://www.apoteka-online.rs/catalog/nega-podrucja-oko-ociju-75',
  'https://www.apoteka-online.rs/catalog/crvenilo-koze-rozacea-preosetljiva-koza-59',
  'https://www.apoteka-online.rs/catalog/ostecena-iritirana-koza-i-oziljci-40',
  'https://www.apoteka-online.rs/catalog/dekorativna-kozmetika-4',
  'https://www.apoteka-online.rs/catalog/nega-tela-70',
  'https://www.apoteka-online.rs/catalog/celulit-strije-zatezanje-koze-49',
  'https://www.apoteka-online.rs/catalog/nega-koze-71',
  'https://www.apoteka-online.rs/catalog/licna-higijena-73',
  'https://www.apoteka-online.rs/catalog/nega-intimnog-podrucja-72',
  'https://www.apoteka-online.rs/catalog/brijanje-i-depilacija-34',
  'https://www.apoteka-online.rs/catalog/dezodoransi-i-antiperspiranti-25',
  'https://www.apoteka-online.rs/catalog/sredstva-protiv-komaraca-52',
  'https://www.apoteka-online.rs/catalog/zastita-od-sunca-24',
  'https://www.apoteka-online.rs/catalog/kozmetika-za-najmlade-38',
  'https://www.apoteka-online.rs/catalog/nega-kose-i-temena-glave-11',
  'https://www.apoteka-online.rs/catalog/nega-ruku-i-stopala-3',
  'https://www.apoteka-online.rs/catalog/imunitet-14',
  'https://www.apoteka-online.rs/catalog/vitamini-i-minerali-18',
  'https://www.apoteka-online.rs/catalog/vitamin-d-91',
  'https://www.apoteka-online.rs/catalog/vitamini-b-grupe-94',
  'https://www.apoteka-online.rs/catalog/gvozde-93',
  'https://www.apoteka-online.rs/catalog/magnezijum-92',
  'https://www.apoteka-online.rs/catalog/vitamin-c-79',
  'https://www.apoteka-online.rs/catalog/vitamini-za-oci-78',
  'https://www.apoteka-online.rs/catalog/bebe-i-deca-19',
  'https://www.apoteka-online.rs/catalog/mleko-za-bebe-35',
  'https://www.apoteka-online.rs/catalog/kasice-sokovi-i-cajevi-za-bebe-60',
  'https://www.apoteka-online.rs/catalog/kasice-4m-102',
  'https://www.apoteka-online.rs/catalog/kasice-5m-107',
  'https://www.apoteka-online.rs/catalog/kasice-6m-103',
  'https://www.apoteka-online.rs/catalog/kasice-8m-106',
  'https://www.apoteka-online.rs/catalog/kasice-12m-104',
  'https://www.apoteka-online.rs/catalog/cajevi-za-bebe-105',
  'https://www.apoteka-online.rs/catalog/sokovi-za-bebe-101',
  'https://www.apoteka-online.rs/catalog/instant-kasice-100',
  'https://www.apoteka-online.rs/catalog/pomocna-lekovita-sredstva-36',
  'https://www.apoteka-online.rs/catalog/pelene-39',
  'https://www.apoteka-online.rs/catalog/podmetaci-81',
  'https://www.apoteka-online.rs/catalog/vlazne-maramice-37',
  'https://www.apoteka-online.rs/catalog/oprema-za-bebe-46',
  'https://www.apoteka-online.rs/catalog/flasice-i-cucle-za-bebe-68',
  'https://www.apoteka-online.rs/catalog/varalice-za-bebe-67',
  'https://www.apoteka-online.rs/catalog/trudnoca-i-dojenje-22',
  'https://www.apoteka-online.rs/catalog/kosa-nokti-koza-10',
  'https://www.apoteka-online.rs/catalog/zdravlje-srca-i-krvnih-sudova-8',
  'https://www.apoteka-online.rs/catalog/zdravlje-zene-9',
  'https://www.apoteka-online.rs/catalog/intimna-higijena-88',
  'https://www.apoteka-online.rs/catalog/menstrualni-donji-ves-116',
  'https://www.apoteka-online.rs/catalog/loona-menstrualne-gace-117',
  'https://www.apoteka-online.rs/catalog/tamponi-90',
  'https://www.apoteka-online.rs/catalog/ulosci-dnevni-i-menstrualni-89',
  'https://www.apoteka-online.rs/catalog/popusti-i-akcije-113',
  'https://www.apoteka-online.rs/catalog/dopuni-korpu-do-besplatne-isporuke-87',
  'https://www.apoteka-online.rs/catalog/hemofarm-promo-cene-84',
  'https://www.apoteka-online.rs/catalog/mame-i-bebe-popusti-i-akcije-110',
  'https://www.apoteka-online.rs/catalog/vitamini-i-suplementi-popusti-i-akcije-111',
  'https://www.apoteka-online.rs/catalog/kratak-rok-do-isteka-zaliha-82',
  'https://www.apoteka-online.rs/catalog/nega-koze-popusti-i-akcije-109',
  'https://www.apoteka-online.rs/catalog/mame-bebe-i-deca-115',
  'https://www.apoteka-online.rs/catalog/dijetetski-suplementi-114',
  'https://www.apoteka-online.rs/catalog/flasteri-80',
  'https://www.apoteka-online.rs/catalog/promo-paketi-do-isteka-zaliha-66',
  'https://www.apoteka-online.rs/catalog/promo-pakovanja-85',
  'https://www.apoteka-online.rs/catalog/zdravlje-muskarca-potencija-prostata-20',
  'https://www.apoteka-online.rs/catalog/zdrav-zivot-62',
  'https://www.apoteka-online.rs/catalog/zdravi-napici-63',
  'https://www.apoteka-online.rs/catalog/cajevi-i-biljne-kapi-86',
  'https://www.apoteka-online.rs/catalog/hrana-za-posebne-namene-108',
  'https://www.apoteka-online.rs/catalog/za-sportiste-99',
  'https://www.apoteka-online.rs/catalog/uho-grlo-nos-12',
  'https://www.apoteka-online.rs/catalog/kasalj-promuklost-i-bolno-grlo-43',
  'https://www.apoteka-online.rs/catalog/zdravlje-i-higijena-nosne-sluznice-44',
  'https://www.apoteka-online.rs/catalog/higijena-usiju-45',
  'https://www.apoteka-online.rs/catalog/zdravlje-mokracnih-kanala-28',
  'https://www.apoteka-online.rs/catalog/varenje-i-metabolizam-16',
  'https://www.apoteka-online.rs/catalog/probiotici-58',
  'https://www.apoteka-online.rs/catalog/mrsavljenje-17',
  'https://www.apoteka-online.rs/catalog/kosti-misici-i-zglobovi-21',
  'https://www.apoteka-online.rs/catalog/pamcenje-koncentracija-bol-29',
  'https://www.apoteka-online.rs/catalog/krvotok-15',
  'https://www.apoteka-online.rs/catalog/povrede-i-mestenje-56',
  'https://www.apoteka-online.rs/catalog/pojava-krvavog-urina-i-problemi-sa-bubrezima-57',
];

async function scrapePage(page: Page, url: string): Promise<Product[]> {
  const allProducts: Product[] = [];
  const categoryWithSuffix = url.split('/').slice(-2, -1)[0];
  const category = categoryWithSuffix.replace(/-\d+$/, '');

  try {
    try {
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    } catch (navigationError: unknown) {
      if (navigationError instanceof Error) {
        console.log(`Navigation error for ${url}: ${navigationError.message}`);
      }
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (!page.isClosed()) {
      await page
        .waitForSelector('.product.product--grid', {
          timeout: 10000,
        })
        .catch(() => console.log('No products found on page'));

      const products = await page.$$eval(
        '.product.product--grid',
        (elements) => {
          return elements
            .map((element) => {
              const title =
                element.querySelector('.product__name')?.textContent?.trim() ||
                '';
              const offStockElement = element.querySelector(
                '.grid-image.grid-image--out-of-stock',
              );

              if (offStockElement) {
                return null;
              }

              const price =
                element
                  .querySelector('.product__info.product__info--price-gross')
                  ?.textContent?.trim() || '';
              const link =
                element
                  .querySelector('.grid-image__link')
                  ?.getAttribute('href') || '';
              const img =
                element
                  .querySelector('.grid-image__image-wrapper > img')
                  ?.getAttribute('data-src') || '';

              return { title, price, link, img };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);
        },
      );

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

      return allProducts;
    } else {
      console.log('Page was closed unexpectedly');
      return [];
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error scraping ${url}: ${error.message}`);
      if (
        error.message.includes('detached') ||
        error.message.includes('Target closed')
      ) {
        throw new Error('PAGE_NEEDS_RESET');
      }
    }
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
    let page = await browser.newPage();
    let allScrapedProducts: Product[] = [];

    for (const baseUrl of baseUrls) {
      let pageNumber = 1;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 2;

      while (consecutiveFailures < maxConsecutiveFailures) {
        const pageUrl = `${baseUrl}/p${pageNumber}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          console.log(`Attempt ${retryCount + 1}`);
          try {
            products = await scrapePage(page, pageUrl);
            if (products.length > 0) break;
          } catch (error: unknown) {
            if (error instanceof Error) {
              console.error(`Error on attempt ${retryCount + 1}:`, error);
              if (error.message === 'PAGE_NEEDS_RESET') {
                await page.close().catch(() => {});
                page = await browser.newPage();
                console.log('Created new page instance');
              }
            }
          }
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }

        if (products.length === 0) {
          consecutiveFailures++;
          console.log(
            `No products found on page ${pageNumber} (${consecutiveFailures}/${maxConsecutiveFailures} consecutive failures)`,
          );

          if (consecutiveFailures >= maxConsecutiveFailures) {
            console.log(
              `Stopping after ${maxConsecutiveFailures} consecutive empty pages`,
            );
            break;
          }
        } else {
          consecutiveFailures = 0;
          allScrapedProducts = [...allScrapedProducts, ...products];
        }

        pageNumber++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
    await insertData(allProducts, 'Apoteka Online');
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
