import type { ListingConfig } from './listingScraper';

export const eApotekaListing: ListingConfig = {
  urls: ['https://www.eapoteka.rs/sr/svi-proizvodi/1?limit=48'],
  card: '.product-preview-item', title: 'h3', link: 'a.link-name', image: '.image-wrapper img',
  prices: [{ selector: '.price' }], eapotekaDecimals: true,
  category: 'svi-proizvodi',
  pagination: '.pagination a[href]', empty: '.no-products, .no-results',
  pageNumber: url => Number(new URL(url).pathname.match(/svi-proizvodi\/(\d+)/)?.[1] || 1),
};

export const fitnessShopListing: ListingConfig = {
  urls: ['fitnes','suplementi','sportovi','venum-i-ringhorns'].map(category => `https://www.nssport.com/${category}/0/0/0-0?page=1`),
  card: '.shop-product-card', title: 'h2', link: 'a.img-link', image: '.img-link img',
  prices: [{ selector: '.product-price' }], unavailable: '.out-of-stock',
  pagination: '.pagination a[href]', empty: '.no-products, .no-results',
  pageNumber: url => Number(new URL(url).searchParams.get('page') || 1),
};

export const hiperListing: ListingConfig = {
  urls: ['sport-i-fitness','higijena-i-kozmetika','apoteka'].map(category => `https://www.hiper.rs/${category}/?p=1`),
  card: '.product-item-info', title: '.product-name-full-name', brand: '.product-name-brand-name', link: 'a.product-item-link', image: 'img.product-image-photo',
  prices: [
    { selector: '.special-price [data-price-amount]', attribute: 'data-price-amount' },
    { selector: '.special-price .price' },
    { selector: '.price-final_price [data-price-type=""]', attribute: 'data-price-amount' },
    { selector: '.price-box > .price' },
  ],
  unavailable: '.grid-image--out-of-stock',
  pagination: 'link[rel="next"], .pages a[href]', empty: '.message.info.empty',
  pageNumber: url => Number(new URL(url).searchParams.get('p') || 1),
};

export const exYuListing: ListingConfig = {
  urls: ['https://www.exyu-fitness.rs/suplementi/','https://www.exyu-fitness.rs/fitness-oprema/'],
  card: '.ut2-gl__body', title: '.ut2-gl__name', link: 'a.product_icon_lnk', image: '.product_icon_lnk img',
  prices: [{ selector: '.ty-price' }], unavailable: '.ty-qty-out-of-stock',
  pagination: '.ty-pagination a[href]', empty: '.ty-no-items',
  categoryLinks: '.ut2-subcategories a[href]',
  prepareCategory: value => { const url=new URL(value); url.searchParams.set('items_per_page','128'); return url.href; },
  pageNumber: url => Number(new URL(url).pathname.match(/\/page-(\d+)\//)?.[1] || new URL(url).searchParams.get('page') || 1),
};
