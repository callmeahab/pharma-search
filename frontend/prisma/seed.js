import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding vendors...");
  // Get all scraper files from the scrapers directory
  const scrapersDir = path.join(__dirname, "../scrapers");
  const scraperFiles = fs
    .readdirSync(scrapersDir)
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"));

  // Map vendor information based on scraper files
  let vendors = [
    {
      name: "4 Fitness",
      website: "https://4fitness.rs",
      scraperFile: "4fitness.ts",
      logo: "/logos/4fitness.png",
    },
    {
      name: "Adonis",
      website: "https://www.adonisapoteka.rs",
      scraperFile: "adonis.ts",
      logo: "/logos/adonis.png",
    },
    {
      name: "Alek Suplementi",
      website: "https://aleksuplementi.com",
      scraperFile: "alekSuplementi.ts",
      logo: "/logos/alekSuplementi.webp",
    },
    {
      name: "Aleksandar Mn",
      website: "https://aleksandarmn.com",
      scraperFile: "aleksandarMn.ts",
      logo: "/logos/aleksandarMn.webp",
    },
    {
      name: "AMG Sport",
      website: "https://amgsport.net",
      scraperFile: "amgSport.ts",
      logo: "/logos/amgSport.png",
    },
    {
      name: "Ananas",
      website: "https://ananas.rs",
      scraperFile: "ananas.ts",
      logo: "/logos/ananas.png",
    },
    {
      name: "Apoteka MO",
      website: "https://apotekamo.rs",
      scraperFile: "apotekamo.ts",
      logo: "/logos/apotekamo.png",
    },
    {
      name: "Apoteka Net",
      website: "https://apoteka.net",
      scraperFile: "apotekaNet.ts",
      logo: "/logos/apotekaNet.jpg",
    },
    {
      name: "Apotekarska ustanova Nis",
      website: "https://www.apotekanis.co.rs",
      scraperFile: "apotekaNis.ts",
      logo: "/logos/apotekarskaUstanovaNis.png",
    },
    {
      name: "Apoteka Online",
      website: "https://www.apotekaonline.rs",
      scraperFile: "apotekaOnline.ts",
      logo: "/logos/apotekaOnline.webp",
    },
    {
      name: "Apoteka Shop",
      website: "https://apotekashop.rs",
      scraperFile: "apotekaShop.ts",
      logo: "/logos/apotekaShop.webp",
    },
    {
      name: "Apoteka Sunce",
      website: "https://www.apotekasunce.rs",
      scraperFile: "apotekaSunce.ts",
      logo: "/logos/apotekaSunce.png",
    },
    {
      name: "Apoteka Valerijana",
      website: "https://www.valerijana.rs",
      scraperFile: "apotekaValerijana.ts",
      logo: "/logos/apotekaValerijana.jpg",
    },
    {
      name: "Apoteka Zivanovic",
      website: "https://www.apoteka-zivanovic.rs",
      scraperFile: "apotekaZivanovic.ts",
      logo: "/logos/apotekaZivanovic.png",
    },
    {
      name: "Apotekar Online",
      website: "https://apotekar-online.rs",
      scraperFile: "apotekarOnline.ts",
      logo: "/logos/apotekarOnline.png",
    },
    {
      name: "Apothecary",
      website: "https://apothecary.rs",
      scraperFile: "apothecary.ts",
      logo: "/logos/apothecary.jpg",
    },
    {
      name: "ATP Sport",
      website: "https://www.atpsport.com",
      scraperFile: "atpSport.ts",
      logo: "/logos/atpSport.jpg",
    },
    {
      name: "Azgard",
      website: "https://www.azgardnutrition.rs",
      scraperFile: "azgard.ts",
      logo: "/logos/azgard.png",
    },
    {
      name: "Bazzar",
      website: "https://bazzar.rs",
      scraperFile: "bazzar.ts",
      logo: "/logos/bazzar.png",
    },
    {
      name: "Benu",
      website: "https://www.benu.rs",
      scraperFile: "benu.ts",
      logo: "/logos/benu.png",
    },
    {
      name: "Biofarm",
      website: "https://biofarm.rs",
      scraperFile: "biofarm.ts",
      logo: "/logos/biofarm.jpg",
    },
    {
      name: "DM",
      website: "https://www.dm.rs",
      scraperFile: "dm.ts",
      logo: "/logos/dm.png",
    },
    {
      name: "Dr Max",
      website: "https://www.drmax.rs",
      scraperFile: "drMax.ts",
      logo: "/logos/drMax.png",
    },
    {
      name: "E-Apoteka",
      website: "https://www.e-apoteka.rs",
      scraperFile: "eApoteka.ts",
      logo: "/logos/eApoteka.png",
    },
    {
      name: "eApoteka",
      website: "https://www.eapoteka.rs",
      scraperFile: "eApotekaRs.ts",
      logo: "/logos/eApotekaRs.png",
    },
    {
      name: "eApotekaNet",
      website: "https://eapoteka.net",
      scraperFile: "eApotekaNet.ts",
      logo: "/logos/eApotekaNet.png",
    },
    {
      name: "Esensa",
      website: "https://www.esensa.rs",
      scraperFile: "esensa.ts",
      logo: "/logos/esensa.webp",
    },
    {
      name: "ePlaneta",
      website: "https://eplaneta.rs",
      scraperFile: "ePlaneta.ts",
      logo: "/logos/ePlaneta.png",
    },
    {
      name: "Explode",
      website: "https://explode.rs",
      scraperFile: "explode.ts",
      logo: "/logos/explode.png",
    },
    {
      name: "exYu Fitness",
      website: "https://www.exyu-fitness.rs",
      scraperFile: "exYuFitness.ts",
      logo: "/logos/exYuFitness.webp",
    },
    {
      name: "Farmasi",
      website: "https://klub.farmasi.rs",
      scraperFile: "farmasi.ts",
      logo: "/logos/farmasi.png",
    },
    {
      name: "Filly",
      website: "https://fillyfarm.rs",
      scraperFile: "filly.ts",
      logo: "/logos/filly.jpg",
    },
    {
      name: "FitLab",
      website: "https://fitlab.rs",
      scraperFile: "fitLab.ts",
      logo: "/logos/fitLab.png",
    },
    {
      name: "Fitness Shop",
      website: "https://www.nssport.com/",
      scraperFile: "fitnessShop.ts",
      logo: "/logos/fitnessShop.jpg",
    },
    {
      name: "Flos",
      website: "https://flos.rs",
      scraperFile: "flos.ts",
      logo: "/logos/flos.png",
    },
    {
      name: "Herba",
      website: "https://www.apotekaherba.rs",
      scraperFile: "herba.ts",
      logo: "/logos/herba.webp",
    },
    {
      name: "Gym Beam",
      website: "https://gymbeam.rs",
      scraperFile: "gymBeam.ts",
      logo: "/logos/gymBeam.webp",
    },
    {
      name: "Hiper",
      website: "https://www.hiper.rs",
      scraperFile: "hiper.ts",
      logo: "/logos/hiper.png",
    },
    {
      name: "House Of Supplements",
      website: "https://houseofsupplements.rs",
      scraperFile: "houseOfSupplements.ts",
      logo: "/logos/houseOfSupplements.png",
    },
    {
      name: "Jankovic",
      website: "https://apotekajankovic.rs",
      scraperFile: "jankovic.ts",
      logo: "/logos/jankovic.webp",
    },
    {
      name: "Jugofarm",
      website: "https://jugofarm.com",
      scraperFile: "jugofarm.ts",
      logo: "/logos/jugofarm.webp",
    },
    {
      name: "Krsenkovic",
      website: "https://krsenkovic.rs",
      scraperFile: "krsenkovic.ts",
      logo: "/logos/krsenkovic.png",
    },
    {
      name: "Lama",
      website: "https://www.lama.rs",
      scraperFile: "lama.ts",
      logo: "/logos/lama.png",
    },
    {
      name: "Laurus",
      website: "https://apotekalaurus.rs",
      scraperFile: "laurus.ts",
      logo: "/logos/laurus.png",
    },
    {
      name: "Lily",
      website: "https://www.lily.rs",
      scraperFile: "lily.ts",
      logo: "/logos/lilly.webp",
    },
    {
      name: "Livada",
      website: "https://apotekalivada.rs",
      scraperFile: "livada.ts",
      logo: "/logos/livada.png",
    },
    {
      name: "Maelia",
      website: "https://maelia.rs",
      scraperFile: "maelia.ts",
      logo: "/logos/maelia.png",
    },
    {
      name: "Max Farm",
      website: "https://maxfarm.rs",
      scraperFile: "maxFarm.ts",
      logo: "/logos/maxFarm.jpeg",
    },
    {
      name: "Maximalium",
      website: "https://www.maximalium.rs",
      scraperFile: "maximalium.ts",
      logo: "/logos/maximalium.png",
    },
    {
      name: "Med X Apoteka",
      website: "https://medxapoteka.rs",
      scraperFile: "medXapoteka.ts",
      logo: "/logos/medXapoteka.jpg",
    },
    {
      name: "Melisa",
      website: "https://melisa.rs",
      scraperFile: "melisa.ts",
      logo: "/logos/melisa.png",
    },
    {
      name: "Milica",
      website: "https://apotekamilica.rs",
      scraperFile: "milica.ts",
      logo: "/logos/milica.png",
    },
    {
      name: "Moc Bilja",
      website: "https://www.mocbilja.rs",
      scraperFile: "mocBilja.ts",
      logo: "/logos/mocBilja.png",
    },
    {
      name: "Nature Hub",
      website: "https://www.naturehub.rs",
      scraperFile: "natureHub.ts",
      logo: "/logos/natureHub.png",
    },
    {
      name: "Oaza Zdravlja",
      website: "https://www.oazazdravlja.rs",
      scraperFile: "oazaZdravlja.ts",
      logo: "/logos/oazaZdravlja.png",
    },
    {
      name: "Ogistra",
      website: "https://www.ogistra-nutrition-shop.com",
      scraperFile: "ogistra.ts",
      logo: "/logos/ogistra.jpg",
    },
    {
      name: "Oliva",
      website: "https://www.oliva.rs",
      scraperFile: "oliva.ts",
      logo: "/logos/oliva.png",
    },
    {
      name: "Prof Farm",
      website: "https://apotekaproffarm.com",
      scraperFile: "profFarm.ts",
      logo: "/logos/profFarm.png",
    },
    {
      name: "Pansport",
      website: "https://www.pansport.rs",
      scraperFile: "pansport.ts",
      logo: "/logos/pansport.png",
    },
    {
      name: "Proteinbox",
      website: "https://proteinbox.rs",
      scraperFile: "proteinbox.ts",
      logo: "/logos/proteinbox.png",
    },
    {
      name: "Proteini",
      website: "https://rs.proteini.si",
      scraperFile: "proteini.ts",
      logo: "/logos/proteini.jpg",
    },
    {
      name: "Ring Sport",
      website: "https://www.ringsport.rs",
      scraperFile: "ringSport.ts",
      logo: "/logos/ringSport.png",
    },
    {
      name: "Shopmania",
      website: "https://www.shopmania.rs",
      scraperFile: "shopmania.ts",
      logo: "/logos/shopmania.png",
    },
    {
      name: "Sop",
      website: "https://sop.rs",
      scraperFile: "sop.ts",
      logo: "/logos/sop.png",
    },
    {
      name: "Spartan Suplementi",
      website: "https://suplementi-spartanshop.rs",
      scraperFile: "spartanSuplementi.ts",
      logo: "/logos/spartanSuplementi.png",
    },
    {
      name: "Srbotrade",
      website: "https://srbotrade.rs",
      scraperFile: "srbotrade.ts",
      logo: "/logos/srbotrade.jpg",
    },
    {
      name: "Supplement Shop",
      website: "https://supplementshop.rs",
      scraperFile: "supplementShop.ts",
      logo: "/logos/suplementStore.png",
    },
    {
      name: "Superior",
      website: "https://superior14.rs",
      scraperFile: "superior.ts",
      logo: "/logos/superior.png",
    },
    {
      name: "Suplementi Srbija",
      website: "https://www.suplementisrbija.rs",
      scraperFile: "suplementiSrbija.ts",
      logo: "/logos/suplementiSrbija.png",
    },
    {
      name: "Suplementi Shop",
      website: "https://suplementishop.com",
      scraperFile: "suplementiShop.ts",
      logo: "/logos/suplementiShop.png",
    },
    {
      name: "Supplement Store",
      website: "https://supplementstore.rs",
      scraperFile: "supplementStore.ts",
      logo: "/logos/suplementStore.png",
    },
    {
      name: "Supplements",
      website: "https://supplements.rs",
      scraperFile: "supplements.ts",
      logo: "/logos/supplements.png",
    },
    {
      name: "Titanium Sport",
      website: "https://www.titaniumsport.rs",
      scraperFile: "titaniumSport.ts",
      logo: "/logos/titaniumSport.png",
    },
    {
      name: "Vitalikum",
      website: "https://www.vitalikum.rs",
      scraperFile: "vitalikum.ts",
      logo: "/logos/vitalikum.png",
    },
    {
      name: "Vitamin Shop",
      website: "https://vitaminshop.rs",
      scraperFile: "vitaminShop.ts",
      logo: "/logos/vitaminShop.jpg",
    },
    {
      name: "Web Apoteka",
      website: "https://webapoteka.rs",
      scraperFile: "webApoteka.ts",
      logo: "/logos/webApoteka.png",
    },
    {
      name: "X Sport",
      website: "https://xsport.rs",
      scraperFile: "xSport.ts",
      logo: "/logos/xSport.png",
    },
    {
      name: "XL Sport",
      website: "https://www.xlsport.rs",
      scraperFile: "xlSport.ts",
      logo: "/logos/xlSport.jpg",
    },
    {
      name: "Zelena Apoteka",
      website: "https://prodaja.zelena-apoteka.com",
      scraperFile: "zelenaApoteka.ts",
      logo: "/logos/zelenaApoteka.webp",
    },
    {
      name: "Zero",
      website: "https://apotekazero.rs",
      scraperFile: "zero.ts",
      logo: "/logos/zero.png",
    },
  ];

  console.log("Seeding vendors...");

  const insertedVendors = await prisma.vendor.findMany();

  for (const vendor of vendors) {
    // Only seed vendors that have an existing scraper file
    if (scraperFiles.includes(vendor.scraperFile)) {
      const existingVendor = insertedVendors.find(
        (v) => v.name === vendor.name
      );

      if (existingVendor) {
        await prisma.vendor.update({
          where: { id: existingVendor.id },
          data: vendor,
        });
        console.log(`Updated vendor: ${vendor.name}`);
      } else {
        await prisma.vendor.create({
          data: vendor,
        });
        console.log(`Created vendor: ${vendor.name}`);
      }
    } else {
      console.log(`Skipping ${vendor.name} - scraper file not found`);
    }
  }

  console.log("Seeding completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
