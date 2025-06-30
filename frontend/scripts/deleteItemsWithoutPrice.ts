import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function deleteZeroPriceProducts() {
  let dbDeleted = 0;

  try {
    // First delete from Prisma
    const prismaResult = await prisma.product.deleteMany({
      where: { price: 0 },
    });
    dbDeleted = prismaResult.count;
    console.log(`Deleted ${dbDeleted} zero-price products from database`);

    while (true) {
      const searchResult = await prisma.product.findMany({
        where: { price: 0 },
      });

      if (searchResult.length === 0) break;

      const documentIds = searchResult.map((hit) => hit.id);
      const task = await prisma.product.deleteMany({
        where: { id: { in: documentIds } },
      });

      if (searchResult.length < 100) break;
    }

    // Summary log
    console.log("\nCleanup Summary:");
    console.log("----------------");
    console.log(`Database records deleted: ${dbDeleted}`);
  } catch (error) {
    console.error("Error during deletion:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Execute the cleanup
deleteZeroPriceProducts()
  .then(() => console.log("Cleanup completed successfully"))
  .catch((error) => console.error("Cleanup failed:", error));
