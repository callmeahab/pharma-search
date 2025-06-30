import { PrismaClient } from "@prisma/client";
import type { Product, Vendor } from "@prisma/client";

const prisma = new PrismaClient();

type ProductWithVendor = Product & {
  vendor: Pick<Vendor, "name">;
};

async function deleteDuplicateProducts() {
  try {
    // Get all products with their vendor information
    const products = (await prisma.product.findMany({
      include: {
        vendor: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc", // Most recent first
      },
    })) as ProductWithVendor[];

    // Create a map to store duplicate counts and track which ones to keep
    const duplicateMap = new Map<string, ProductWithVendor[]>();

    // Group products by title, vendor name, and price
    products.forEach((product: ProductWithVendor) => {
      const key = `${product.title}|${product.vendor.name}|${product.price}`;
      const existing = duplicateMap.get(key) || [];
      existing.push(product);
      duplicateMap.set(key, existing);
    });

    // Filter out non-duplicates
    const duplicates = Array.from(duplicateMap.entries()).filter(
      ([_, products]) => products.length > 1
    );

    console.log("\nDuplicate Products Report:");
    console.log("========================\n");

    let totalDeleted = 0;
    let totalGroups = 0;

    // Process each group of duplicates
    for (const [key, products] of duplicates) {
      const [title, vendor, price] = key.split("|");
      const keepProduct = products[0]; // Keep the most recent one
      const deleteProducts = products.slice(1); // Delete the rest

      console.log(`\nProcessing duplicates for:`);
      console.log(`Product: ${title}`);
      console.log(`Vendor: ${vendor}`);
      console.log(`Price: ${price}`);
      console.log(`Total duplicates: ${products.length}`);
      console.log(`Keeping product ID: ${keepProduct.id}`);
      console.log(`Deleting ${deleteProducts.length} duplicates...`);

      // Delete from database
      const deleteResult = await prisma.product.deleteMany({
        where: {
          id: {
            in: deleteProducts.map((p) => p.id),
          },
        },
      });

      totalDeleted += deleteResult.count;
      totalGroups++;

      console.log(`Successfully deleted ${deleteResult.count} duplicates\n`);
    }

    console.log("\nDeletion Summary:");
    console.log("================");
    console.log(`Total duplicate groups processed: ${totalGroups}`);
    console.log(`Total products deleted: ${totalDeleted}`);
  } catch (error) {
    console.error("Error deleting duplicate products:", error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
deleteDuplicateProducts();
