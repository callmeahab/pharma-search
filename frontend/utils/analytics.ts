
import ReactGA from "react-ga4";
declare global {
  interface Window {
    dataLayer: any[];
  }
}

// Cookie consent state - default to true as analytics cookies are required
let cookieConsentGiven = true;

// Set cookie consent status
export const setCookieConsent = (hasConsent: boolean) => {
  cookieConsentGiven = true; // Always set to true as analytics are required
  
  // Initialize GA if not already done
  ReactGA.initialize("G-WECSBGJW8J");
  // Create a new session
  ReactGA.set({ anonymizeIp: true });
  
  console.log(`[Analytics] Analytics cookies are enabled (required)`);
};

// Initialize Google Analytics with your tracking ID
export const initGA = () => {
  // Always initialize with full functionality as analytics are required
  cookieConsentGiven = true;
  ReactGA.initialize("G-WECSBGJW8J");

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'gtm.start': new Date().getTime(),
    event: 'gtm.js'
  });
  
  // Update local storage to reflect that cookies are accepted
  localStorage.setItem('cookie-consent', 'accepted');
};

// Track page views
export const trackPageView = (path: string) => {
  // Always track as analytics are required
  ReactGA.send({ hitType: "pageview", page: path });
};

// Track search queries
export const trackSearch = (searchTerm: string, resultCount: number) => {
  ReactGA.event('Product Search', {
    category: "Search",
    action: "Product Search",
    searchTerm: searchTerm,
  });
  
  console.log(`[Analytics] Search tracked: "${searchTerm}" with ${resultCount} results`);
};

// Track product clicks
export const trackProductClick = (productId: string, productName: string, category: string) => {
  ReactGA.event('Product Click', {
    category: "Product",
    action: "Product Click",
    product: productName,
  });
  
  console.log(`[Analytics] Product click tracked: ${productName} (ID: ${productId})`);
};

// Track store link clicks
export const trackStoreClick = (storeName: string, targetUrl: string, productName: string | null = null) => {
  ReactGA.event('Store Link Click', {
      category: "Store",
      action: "Store Link Click",
      label: storeName,
      storeUrl: targetUrl,
  });
  
  console.log(`[Analytics] Store click tracked: ${storeName}${productName ? ` for product ${productName}` : ''}`);
};
