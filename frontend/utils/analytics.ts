import ReactGA from "react-ga4";
declare global {
  interface Window {
    dataLayer: any[];
  }
}

// Cookie consent state - default to true as analytics cookies are required
let cookieConsentGiven = true;

// Helper function to get readable timestamp in dd.MM.yyyy, HH:mm:ss format
const getReadableTimestamp = () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); // getMonth() is 0-indexed
  const year = now.getFullYear();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${day}.${month}.${year}, ${hours}:${minutes}:${seconds}`;
};

// Set cookie consent status
export const setCookieConsent = (hasConsent: boolean) => {
  cookieConsentGiven = true; // Always set to true as analytics are required

  // Initialize GA if not already done
  ReactGA.initialize("G-WECSBGJW8J");
  // Create a new session
  ReactGA.set({ anonymizeIp: true });

  // Push timestamp to dataLayer
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'cookie_consent_updated',
    timestamp: getReadableTimestamp(),
    consent_status: 'accepted'
  });

  console.log(`[Analytics] Analytics cookies are enabled (required)`);
};

// Initialize Google Analytics with your tracking ID
export const initGA = () => {
  // Always initialize with full functionality as analytics are required
  cookieConsentGiven = true;
  ReactGA.initialize("G-WECSBGJW8J");

  window.dataLayer = window.dataLayer || [];
  const timestamp = getReadableTimestamp();

  window.dataLayer.push({
    'gtm.start': new Date().getTime(),
    event: 'gtm.js',
    timestamp: timestamp
  });

  // Also push initialization event
  window.dataLayer.push({
    event: 'analytics_initialized',
    timestamp: timestamp,
    ga_tracking_id: 'G-WECSBGJW8J'
  });

  // Update local storage to reflect that cookies are accepted
  localStorage.setItem('cookie-consent', 'accepted');
};

// Track page views
export const trackPageView = (path: string) => {
  const timestamp = getReadableTimestamp();

  // GA4 tracking
  ReactGA.send({ hitType: "pageview", page: path });

  // GTM dataLayer push with timestamp
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'page_view',
    page_path: path,
    timestamp: timestamp
  });

  console.log(`[Analytics] Page view tracked: ${path} at ${timestamp}`);
};

// Track search queries
export const trackSearch = (searchTerm: string, resultCount: number) => {
  const timestamp = getReadableTimestamp();

  // GA4 event
  ReactGA.event('Product Search', {
    category: "Search",
    action: "Product Search",
    searchTerm: searchTerm,
  });

  // GTM dataLayer push with timestamp
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'search',
    search_term: searchTerm,
    search_results_count: resultCount,
    timestamp: timestamp,
    event_category: 'Search',
    event_action: 'Product Search'
  });

  console.log(`[Analytics] Search tracked: "${searchTerm}" with ${resultCount} results at ${timestamp}`);
};

// Track product clicks
export const trackProductClick = (productId: string, productName: string, category: string) => {
  const timestamp = getReadableTimestamp();

  // GA4 event
  ReactGA.event('Product Click', {
    category: "Product",
    action: "Product Click",
    product: productName,
  });

  // GTM dataLayer push with timestamp
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'product_click',
    product_id: productId,
    product_name: productName,
    product_category: category,
    timestamp: timestamp,
    event_category: 'Product',
    event_action: 'Product Click'
  });

  console.log(`[Analytics] Product click tracked: ${productName} (ID: ${productId}) at ${timestamp}`);
};

// Track store link clicks
export const trackStoreClick = (storeName: string, targetUrl: string, productName: string | null = null) => {
  const timestamp = getReadableTimestamp();

  // GA4 event
  ReactGA.event('Store Link Click', {
    category: "Store",
    action: "Store Link Click",
    label: storeName,
    storeUrl: targetUrl,
  });

  // GTM dataLayer push with timestamp
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'store_click',
    store_name: storeName,
    store_url: targetUrl,
    product_name: productName || null,
    timestamp: timestamp,
    event_category: 'Store',
    event_action: 'Store Link Click'
  });

  console.log(`[Analytics] Store click tracked: ${storeName}${productName ? ` for product ${productName}` : ''} at ${timestamp}`);
};