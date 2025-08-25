import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { insertData, Product } from './helpers/utils';
import { Page } from 'puppeteer';
import { ScraperUtils } from './helpers/ScraperUtils';

puppeteer.use(StealthPlugin());

const scrapedTitles = new Set<string>();
const baseUrls = [
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/praskovi/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/tablete-i-kapsule/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/nazalni-sprejevi/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/oralni-sprejevi/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/pastile-i-oriblete/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/prehlada/kasalj/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/omega-3/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/polifenoli/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/alkilgliceroli/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/vitamini-i-minerali/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/antioksidansi/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/bioflavonoidi/',
  'https://medxapoteka.rs/product-category/prehlada-imunitet/imunitet/aminokiseline/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/specijalna-hrana/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/probiotici/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/varenje/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/nadutost/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/zatvor/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/dijareja/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/stomak/hemoroidi/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/bolovi/kosti/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/bolovi/misici/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/jetra/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/kardioprotektori/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/visok-holesterol/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/mozdana-cirkulacija/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/vene/',
  'https://medxapoteka.rs/product-category/stomak-bol-cirkulacija/cirkulacija/periferna-cirkulacija/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/a-derma/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/avene/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/couvrance/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/ducray/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/klorane/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/noreva/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/ziaja-med/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/bioderma/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/nega-lica/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/nega-tela/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/nega-kose/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/pranje-tela/',
  'https://medxapoteka.rs/product-category/nega-i-lepota/parfemi-i-dezodoransi/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/suncanje/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/alergija/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/putna-apoteka/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/komarci/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/znojenje-koze/',
  'https://medxapoteka.rs/product-category/sezonski-proizvodi/cajevi/',
  'https://medxapoteka.rs/product-category/mama-bebe/baby-kozmetika/',
  'https://medxapoteka.rs/product-category/mama-bebe/bebine-tegobe/',
  'https://medxapoteka.rs/product-category/mama-bebe/hrana-za-bebe/',
  'https://medxapoteka.rs/product-category/mama-bebe/previjanje-beba/',
  'https://medxapoteka.rs/product-category/mama-bebe/oprema-za-bebe/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/osteoporoza/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/prostata/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/mrsavljenje/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/detoksikacija/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/anemija/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/dijabetes/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/urinarna-infekcija/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/biljna-ulja-i-tinkture/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/inkontinecija/',
  'https://medxapoteka.rs/product-category/zdravlje/zdravlje-muskaraca-i-zena/zenski-prirodni-hormoni/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/impotencija/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/povecanje-plodnosti/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/prezervativi-i-lubrikanti/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/utvrdjivanje-trudnoce-i-ovulacije/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/vitamini-za-trudnice/',
  'https://medxapoteka.rs/product-category/zdravlje/seksualno-zdravlje/zenska-intimna-nega/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/koenzim-q10/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/kostano-misicni-sistem/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/d3-vitamin/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/b-kompleks/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/cink/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/kalcijum/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/kompleksi/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/magnezijum/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/multivitamini/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/selen/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/vitamin-c/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/vitaminiminerli/vitamin-e/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/neuroprotektori/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/anksioznost/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/koncentracija/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/nervni-sistem/spavanje/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/uho/buka/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/uho/infekcija-uha/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/uho/masnoca/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/svrab-zdravlje-kose/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/opadanje/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/perut/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-kose/vaske/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/vitamin-i-minerali/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/vestacke-suze/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/proizvodi-za-sociva/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-oka/infekcija-oka/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/znojenje-nogu/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/suva-stopala/',
  'https://medxapoteka.rs/product-category/specijalni-suplementi/zdravlje-stopala/bradavice-i-kurje-oko/',
  'https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/pulsni-oksimetar/',
  'https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/meraci-krvnog-pritiska/',
  'https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/inhalator/',
  'https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/merenje-glukoze-u-krvi/',
  'https://medxapoteka.rs/product-category/zastita/medicinski-uredjaji/toplomeri/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/medicinski-potrosni-materijal/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/zastitne-maske/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/pomagala/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/antiseptici/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/gaze-i-komprese/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/flasteri/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/rukavice/',
  'https://medxapoteka.rs/product-category/zastita/prva-pomoc/zavoji/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/hrkanje/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/proteze/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/paste/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/cetkice/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/rastvori/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/konac/',
  'https://medxapoteka.rs/product-category/zastita/oralno-zdravlje/oralna-infekcija/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/povrede-koze-i-rane/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/rehidratacija-zdravlje-koze/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/svrab/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/osip/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/ekcem/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/akne/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/oziljci/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/fleke/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/boginje/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/bradavice/',
  'https://medxapoteka.rs/product-category/zastita/zdravlje-koze/ujedi-insekata/',
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

    // Wait for initial products to load
    await page
      .waitForSelector('ul > .product', {
        timeout: 5000,
      })
      .catch(() => console.log('No products found on page'));

    // Scroll sequentially to load all products
    let previousHeight = 0;
    while (true) {
      const currentHeight = await page.evaluate(
        () => document.body.scrollHeight as number,
      );
      if (currentHeight === previousHeight) {
        break;
      }

      // Scroll in smaller increments (300px) for smoother loading
      for (let i = previousHeight; i < currentHeight; i += 300) {
        await page.evaluate(`window.scrollTo(0, ${i})`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Final scroll to bottom and wait for potential new content
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      previousHeight = currentHeight;
    }

    // Scroll back to top
    await page.evaluate('window.scrollTo(0, 0)');
    await new Promise((resolve) => setTimeout(resolve, 500));

    const products = await page.$$eval('ul > .product', (elements) => {
      return elements
        .map((element) => {
          const title =
            element
              .querySelector('h2')
              ?.textContent?.trim()
              .replace(',', '.') || '';
          const offStockElement = element.querySelector('.stock.out-of-stock');

          if (offStockElement) {
            console.log(`Product out of stock: ${title}`);
            return null;
          }

          let price = '';
          const priceElement = element.querySelector('.price');
          const newPriceElement = priceElement?.querySelector(
            'ins .woocommerce-Price-amount',
          );

          if (newPriceElement) {
            price = newPriceElement.textContent?.trim() || '';
          } else {
            price =
              priceElement
                ?.querySelector('.woocommerce-Price-amount')
                ?.textContent?.trim() || '';
          }

          const link = element.querySelector('a')?.getAttribute('href') || '';
          const img = element.querySelector('img')?.getAttribute('src') || '';

          return { title, price, link, img };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    });

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
  } catch (error) {
    console.error(`Error scraping ${url}: ${(error as Error).message}`);
    return [];
  }
}

async function hasNextPage(page: Page): Promise<boolean> {
  try {
    const nextButton = await page.$('.next.page-numbers');
    return nextButton !== null;
  } catch (error) {
    console.error(`Error checking for next page: ${error}`);
    return false;
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
      const sanitizedUrl = baseUrl.replace(/\/+$/, '');
      const urlParts = sanitizedUrl.split('/');
      const productCategoryIndex = urlParts.indexOf('product-category');
      const category =
        productCategoryIndex !== -1
          ? urlParts[productCategoryIndex + 1]
          : 'unknown-category';
      let pageNum = 1;

      while (true) {
        const pageUrl = `${baseUrl}page/${pageNum}`;
        console.log(`Scraping page: ${pageUrl}`);

        let retryCount = 0;
        const maxRetries = 2;
        let products: Product[] = [];

        while (retryCount < maxRetries) {
          try {
            products = await scrapePage(page, pageUrl, category);
            if (products.length > 0) break;
          } catch (error) {
            console.error(`Error on attempt ${retryCount + 1}:`, error);
          }
          retryCount++;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (products.length === 0) {
          console.log(
            `No products found on page ${pageNum} of ${sanitizedUrl}, stopping...`,
          );
          break;
        }

        allScrapedProducts = [...allScrapedProducts, ...products];

        const nextPageExists = await hasNextPage(page);
        if (!nextPageExists) {
          console.log(`No next page found for ${sanitizedUrl}, stopping...`);
          break;
        }

        pageNum++;

        // Add small delay between pages
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
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
    await insertData(allProducts, 'Med X Apoteka');
    console.log(`Successfully stored ${allProducts.length} products`);
  } else {
    console.log('No products found.');
  }
});
