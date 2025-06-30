
import { Product } from "@/types/product";
import { toast } from "@/components/ui/use-toast";

// This would typically be a server-side function or a cron job
// For this example, we'll simulate it with a function that could be called periodically
export const checkPriceChanges = (previousPrices: Record<string, number>, currentProducts: Product[]) => {
  const notifications = [];

  for (const product of currentProducts) {
    const lowestPrice = Math.min(...product.prices.map(p => p.price));
    const previousLowestPrice = previousPrices[product.id];
    
    if (previousLowestPrice && lowestPrice < previousLowestPrice) {
      const priceDrop = previousLowestPrice - lowestPrice;
      const percentDrop = (priceDrop / previousLowestPrice) * 100;
      
      notifications.push({
        productId: product.id,
        productName: product.name,
        previousPrice: previousLowestPrice,
        currentPrice: lowestPrice,
        priceDrop,
        percentDrop
      });
    }
  }

  return notifications;
};

// Function to save current lowest prices to localStorage
export const saveCurrentPrices = (products: Product[]) => {
  const currentPrices: Record<string, number> = {};
  
  for (const product of products) {
    currentPrices[product.id] = Math.min(...product.prices.map(p => p.price));
  }
  
  localStorage.setItem('previousPrices', JSON.stringify(currentPrices));
};

// Function to show notifications for price drops
export const showPriceDropNotifications = (notifications: any[]) => {
  for (const notification of notifications) {
    toast({
      title: "Snižena cena!",
      description: `${notification.productName} je sada ${notification.currentPrice.toFixed(2)}$ (${notification.percentDrop.toFixed(1)}% popusta)!`,
      variant: "default",
      className: "bg-green-50 dark:bg-green-900 border-green-200 dark:border-green-800"
    });
  }
};

// Simulate price checking on app load
export const initPriceChecking = (wishlistProducts: Product[], allProducts: Product[]) => {
  // Only check prices for products in the wishlist
  if (wishlistProducts.length === 0) return;
  
  try {
    const storedPrices = localStorage.getItem('previousPrices');
    if (storedPrices) {
      const previousPrices = JSON.parse(storedPrices);
      const relevantProducts = allProducts.filter(p => 
        wishlistProducts.some(wp => wp.id === p.id)
      );
      
      const notifications = checkPriceChanges(previousPrices, relevantProducts);
      if (notifications.length > 0) {
        showPriceDropNotifications(notifications);
      }
    }
    
    // Always update stored prices
    saveCurrentPrices(allProducts);
  } catch (error) {
    console.error('Error checking prices:', error);
  }
};
