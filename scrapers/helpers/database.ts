/**
 * CSV utilities for scrapers
 * Writes scraped product data to CSV files
 */

import * as fs from 'fs';
import * as path from 'path';

export interface Product {
  title: string;
  price: string;
  category: string;
  link: string;
  thumbnail: string;
  photos: string;
}

const OUTPUT_DIR = path.join(process.cwd(), 'output');

/**
 * Escape a value for CSV format
 */
function escapeCSV(value: string): string {
  if (!value) return '';
  // If the value contains comma, newline, or double quote, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Convert a product to a CSV row
 */
function productToCSVRow(product: Product, parsedPrice: number, vendor: string): string {
  return [
    escapeCSV(product.title),
    parsedPrice.toString(),
    escapeCSV(product.category),
    escapeCSV(product.link),
    escapeCSV(product.thumbnail),
    escapeCSV(product.photos),
    escapeCSV(vendor),
    new Date().toISOString(),
  ].join(',');
}

const CSV_HEADER = 'title,price,category,link,thumbnail,photos,vendor,scrapedAt';

/**
 * Parse price string and convert to number
 */
export function parsePrice(priceString: string): number {
  if (!priceString) return 0;

  let p = priceString;
  // Remove currency symbols, spaces and other non-numeric characters except . and ,
  p = p.replace(/[^\d.,]/g, "");

  let price: number;
  // Count dots and commas to better detect format
  const dotCount = (p.match(/\./g) || []).length;
  const commaCount = (p.match(/,/g) || []).length;

  // Helper to count digits after decimal separator
  const digitsAfterDecimal = (str: string, separator: string) => {
    const parts = str.split(separator);
    return parts[1]?.replace(/[^\d]/g, "").length || 0;
  };

  if (
    // European format indicators:
    (commaCount === 1 && digitsAfterDecimal(p, ",") === 2) || // e.g., 33.746,30
    (commaCount === 1 &&
      p.includes(".") &&
      p.indexOf(",") > p.indexOf(".")) || // e.g., 33.746,30
    // Handle cases where dot is used as thousand separator
    (dotCount === 1 &&
      commaCount === 0 &&
      (p.split(".")[1].length === 3 || // e.g., 23.911 or 1.390
        (p.endsWith("000") && p.split(".")[0].length > 0))) || // e.g., 1.000
    // Handle multiple dots as thousand separators
    (dotCount > 1 && commaCount === 0) || // e.g., 1.533.179
    // Handle simple numbers without thousand separators
    (commaCount === 0 && dotCount === 0) // e.g., 100
  ) {
    if (commaCount === 1) {
      // European format with comma: convert to US format
      p = p.replace(/\./g, "").replace(",", ".");
    } else if (dotCount >= 1) {
      // Treat as European format where dot(s) are thousand separator(s)
      p = p.replace(/\./g, "");
    }
    price = parseFloat(p);
  } else if (
    // US format indicators:
    (dotCount === 1 && digitsAfterDecimal(p, ".") === 2) || // e.g., 1,000.00
    (dotCount === 1 && p.indexOf(".") > p.lastIndexOf(",")) || // e.g., 1,123.32
    (commaCount > 0 &&
      dotCount === 1 &&
      p.indexOf(".") > p.indexOf(",")) // e.g., 1,000.00
  ) {
    // US format: remove thousand separators
    p = p.replace(/,/g, "");
    price = parseFloat(p);
  } else {
    // Any other format, try simple comma removal
    p = p.replace(/,/g, "");
    price = parseFloat(p);
  }

  if (isNaN(price)) {
    price = 0; // Default value if parsing fails
  }

  return price;
}

/**
 * Write scraped product data to CSV file
 */
export async function insertData(allProducts: Product[], shopName: string): Promise<void> {
  try {
    // Sanitize shop name for filename
    const safeShopName = shopName.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const csvPath = path.join(OUTPUT_DIR, `${safeShopName}_${date}.csv`);

    // Build CSV content
    const rows: string[] = [CSV_HEADER];
    let successCount = 0;
    let errorCount = 0;

    for (const product of allProducts) {
      try {
        const price = parsePrice(product.price);
        rows.push(productToCSVRow(product, price, shopName));
        successCount++;
      } catch (error) {
        console.error(`Error processing product "${product.title}":`, error);
        errorCount++;
      }
    }

    // Write to file
    fs.writeFileSync(csvPath, rows.join('\n'), 'utf-8');

    console.log(
      `Successfully wrote ${successCount} products to ${csvPath}, ${errorCount} errors.`
    );
    console.log(`Total products for ${shopName}: ${successCount}`);

  } catch (error) {
    console.error("Error writing products to CSV:", error);
    throw error;
  }
}

/**
 * Initialize output directory
 * Call this before using any CSV operations
 */
export async function initializeDatabase(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created output directory: ${OUTPUT_DIR}`);
  }
  console.log('CSV writer initialized');
}

/**
 * Cleanup (no-op for CSV)
 */
export async function closeDatabase(): Promise<void> {
  console.log('CSV writer closed');
}