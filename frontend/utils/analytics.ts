
import ReactGA from "react-ga4";

// Cookie consent state - default to true as analytics cookies are required
let cookieConsentGiven = true;

// Set cookie consent status
export const setCookieConsent = (hasConsent: boolean) => {
  cookieConsentGiven = true; // Always set to true as analytics are required
  
  // Initialize GA if not already done
  ReactGA.initialize("G-XXXXXXXXXX");
  // Create a new session
  ReactGA.set({ anonymizeIp: true });
  
  console.log(`[Analytics] Analytics cookies are enabled (required)`);
};

// Initialize Google Analytics with your tracking ID
export const initGA = () => {
  // Always initialize with full functionality as analytics are required
  cookieConsentGiven = true;
  ReactGA.initialize("G-XXXXXXXXXX");
  
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
  ReactGA.event({
    category: "Search",
    action: "Product Search",
    label: searchTerm,
    value: resultCount,
  });
  
  console.log(`[Analytics] Search tracked: "${searchTerm}" with ${resultCount} results`);
};

// Track product clicks
export const trackProductClick = (productId: string, productName: string, category: string) => {
  ReactGA.event({
    category: "Product",
    action: "Product Click",
    label: productName,
  });
  
  console.log(`[Analytics] Product click tracked: ${productName} (ID: ${productId})`);
};

// Track store link clicks
export const trackStoreClick = (storeName: string, productName: string | null = null) => {
  ReactGA.event({
    category: "Store",
    action: "Store Link Click",
    label: storeName,
  });
  
  console.log(`[Analytics] Store click tracked: ${storeName}${productName ? ` for product ${productName}` : ''}`);
};
