import { apiClient } from './api-client';

// Use API client to communicate with DuckDB backend
const prisma = apiClient;

export interface Product {
  title: string;
  price: string;
  category: string;
  link: string;
  thumbnail: string;
  photos: string;
}

export async function insertData(allProducts: Product[], shopName: string) {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: {
        name: shopName,
      },
    });

    if (!vendor) {
      throw new Error(`Vendor "${shopName}" not found`);
    }

    let successCount = 0;
    let errorCount = 0;

    // Process products in smaller batches to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
      const batch = allProducts.slice(i, i + BATCH_SIZE);

      for (const product of batch) {
        try {
          let p = product.price;
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

          // First check for any duplicate products
          const duplicateProducts = await prisma.product.findMany({
            where: {
              title: product.title,
              vendorId: vendor.id,
            },
            orderBy: {
              createdAt: "desc",
            },
          });

          if (duplicateProducts.length > 1) {
            // Keep only the most recent product, delete others
            const [keepProduct, ...deleteProducts] = duplicateProducts;
            await prisma.product.deleteMany({
              where: {
                id: {
                  in: deleteProducts.map((p) => p.id),
                },
              },
            });
            console.log(
              `Deleted ${deleteProducts.length} duplicate products for "${product.title}"`
            );
          }

          // Now proceed with update or create
          if (duplicateProducts.length > 0) {
            // Update the most recent product
            await prisma.product.update({
              where: {
                id: duplicateProducts[0].id,
              },
              data: {
                price,
                category: product.category,
                link: product.link,
                thumbnail: product.thumbnail,
                photos: product.photos,
              },
            });
          } else {
            // Create new product
            await prisma.product.create({
              data: {
                title: product.title,
                price,
                category: product.category,
                link: product.link,
                thumbnail: product.thumbnail,
                photos: product.photos,
                vendorId: vendor.id,
              },
            });
          }

          successCount++;
        } catch (error) {
          console.error(`Error processing product "${product.title}":`, error);
          errorCount++;
        }
      }

      // Add a small delay between batches to prevent overwhelming the database
      if (i + BATCH_SIZE < allProducts.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `Successfully processed ${successCount} products, ${errorCount} errors.`
    );

    const products = await prisma.product.findMany({
      where: {
        vendorId: vendor.id,
      },
    });

    console.log("Successfully indexed all products");
  } catch (error) {
    console.error("Error inserting products into database:", error);
  } finally {
    // Don't disconnect the shared client
    // await prisma.$disconnect();
  }
}
