-- ============================================================================
-- PHARMACEUTICAL SEARCH DATABASE SEED DATA
-- Seeds vendor data for all scrapers
-- ============================================================================

-- Clear existing vendors (optional - remove if you want to preserve data)
-- TRUNCATE TABLE "Vendor" RESTART IDENTITY CASCADE;

-- Insert/Update vendors using UPSERT (INSERT ... ON CONFLICT)
-- This ensures we don't create duplicates and update existing records

INSERT INTO "Vendor" (name, website, "scraperFile", logo, "createdAt", "updatedAt")
VALUES 
    ('4 Fitness', 'https://4fitness.rs', '4fitness.ts', '/logos/4fitness.png', NOW(), NOW()),
    ('Adonis', 'https://www.adonisapoteka.rs', 'adonis.ts', '/logos/adonis.png', NOW(), NOW()),
    ('Alek Suplementi', 'https://aleksuplementi.com', 'alekSuplementi.ts', '/logos/alekSuplementi.webp', NOW(), NOW()),
    ('Aleksandar Mn', 'https://aleksandarmn.com', 'aleksandarMn.ts', '/logos/aleksandarMn.webp', NOW(), NOW()),
    ('AMG Sport', 'https://amgsport.net', 'amgSport.ts', '/logos/amgSport.png', NOW(), NOW()),
    ('Ananas', 'https://ananas.rs', 'ananas.ts', '/logos/ananas.png', NOW(), NOW()),
    ('Apoteka MO', 'https://apotekamo.rs', 'apotekamo.ts', '/logos/apotekamo.png', NOW(), NOW()),
    ('Apoteka Net', 'https://apoteka.net', 'apotekaNet.ts', '/logos/apotekaNet.jpg', NOW(), NOW()),
    ('Apotekarska ustanova Nis', 'https://www.apotekanis.co.rs', 'apotekaNis.ts', '/logos/apotekarskaUstanovaNis.png', NOW(), NOW()),
    ('Apoteka Online', 'https://www.apotekaonline.rs', 'apotekaOnline.ts', '/logos/apotekaOnline.webp', NOW(), NOW()),
    ('Apoteka Shop', 'https://apotekashop.rs', 'apotekaShop.ts', '/logos/apotekaShop.webp', NOW(), NOW()),
    ('Apoteka Sunce', 'https://www.apotekasunce.rs', 'apotekaSunce.ts', '/logos/apotekaSunce.png', NOW(), NOW()),
    ('Apoteka Valerijana', 'https://www.valerijana.rs', 'apotekaValerijana.ts', '/logos/apotekaValerijana.jpg', NOW(), NOW()),
    ('Apoteka Zivanovic', 'https://www.apoteka-zivanovic.rs', 'apotekaZivanovic.ts', '/logos/apotekaZivanovic.png', NOW(), NOW()),
    ('Apotekar Online', 'https://apotekar-online.rs', 'apotekarOnline.ts', '/logos/apotekarOnline.png', NOW(), NOW()),
    ('Apothecary', 'https://apothecary.rs', 'apothecary.ts', '/logos/apothecary.jpg', NOW(), NOW()),
    ('ATP Sport', 'https://www.atpsport.com', 'atpSport.ts', '/logos/atpSport.jpg', NOW(), NOW()),
    ('Azgard', 'https://www.azgardnutrition.rs', 'azgard.ts', '/logos/azgard.png', NOW(), NOW()),
    ('Bazzar', 'https://bazzar.rs', 'bazzar.ts', '/logos/bazzar.png', NOW(), NOW()),
    ('Benu', 'https://www.benu.rs', 'benu.ts', '/logos/benu.png', NOW(), NOW()),
    ('Biofarm', 'https://biofarm.rs', 'biofarm.ts', '/logos/biofarm.jpg', NOW(), NOW()),
    ('DM', 'https://www.dm.rs', 'dm.ts', '/logos/dm.png', NOW(), NOW()),
    ('Dr Max', 'https://www.drmax.rs', 'drMax.ts', '/logos/drMax.png', NOW(), NOW()),
    ('E-Apoteka', 'https://www.e-apoteka.rs', 'eApoteka.ts', '/logos/eApoteka.png', NOW(), NOW()),
    ('eApoteka', 'https://www.eapoteka.rs', 'eApotekaRs.ts', '/logos/eApotekaRs.png', NOW(), NOW()),
    ('eApotekaNet', 'https://eapoteka.net', 'eApotekaNet.ts', '/logos/eApotekaNet.png', NOW(), NOW()),
    ('Esensa', 'https://www.esensa.rs', 'esensa.ts', '/logos/esensa.webp', NOW(), NOW()),
    ('ePlaneta', 'https://eplaneta.rs', 'ePlaneta.ts', '/logos/ePlaneta.png', NOW(), NOW()),
    ('Explode', 'https://explode.rs', 'explode.ts', '/logos/explode.png', NOW(), NOW()),
    ('exYu Fitness', 'https://www.exyu-fitness.rs', 'exYuFitness.ts', '/logos/exYuFitness.webp', NOW(), NOW()),
    ('Farmasi', 'https://klub.farmasi.rs', 'farmasi.ts', '/logos/farmasi.png', NOW(), NOW()),
    ('Filly', 'https://fillyfarm.rs', 'filly.ts', '/logos/filly.jpg', NOW(), NOW()),
    ('FitLab', 'https://fitlab.rs', 'fitLab.ts', '/logos/fitLab.png', NOW(), NOW()),
    ('Fitness Shop', 'https://www.nssport.com/', 'fitnessShop.ts', '/logos/fitnessShop.jpg', NOW(), NOW()),
    ('Flos', 'https://flos.rs', 'flos.ts', '/logos/flos.png', NOW(), NOW()),
    ('Herba', 'https://www.apotekaherba.rs', 'herba.ts', '/logos/herba.webp', NOW(), NOW()),
    ('Gym Beam', 'https://gymbeam.rs', 'gymBeam.ts', '/logos/gymBeam.webp', NOW(), NOW()),
    ('Hiper', 'https://www.hiper.rs', 'hiper.ts', '/logos/hiper.png', NOW(), NOW()),
    ('House Of Supplements', 'https://houseofsupplements.rs', 'houseOfSupplements.ts', '/logos/houseOfSupplements.png', NOW(), NOW()),
    ('Jankovic', 'https://apotekajankovic.rs', 'jankovic.ts', '/logos/jankovic.webp', NOW(), NOW()),
    ('Jugofarm', 'https://jugofarm.com', 'jugofarm.ts', '/logos/jugofarm.webp', NOW(), NOW()),
    ('Krsenkovic', 'https://krsenkovic.rs', 'krsenkovic.ts', '/logos/krsenkovic.png', NOW(), NOW()),
    ('Lama', 'https://www.lama.rs', 'lama.ts', '/logos/lama.png', NOW(), NOW()),
    ('Laurus', 'https://apotekalaurus.rs', 'laurus.ts', '/logos/laurus.png', NOW(), NOW()),
    ('Lily', 'https://www.lily.rs', 'lily.ts', '/logos/lilly.webp', NOW(), NOW()),
    ('Livada', 'https://apotekalivada.rs', 'livada.ts', '/logos/livada.png', NOW(), NOW()),
    ('Maelia', 'https://maelia.rs', 'maelia.ts', '/logos/maelia.png', NOW(), NOW()),
    ('Max Farm', 'https://maxfarm.rs', 'maxFarm.ts', '/logos/maxFarm.jpeg', NOW(), NOW()),
    ('Maximalium', 'https://www.maximalium.rs', 'maximalium.ts', '/logos/maximalium.png', NOW(), NOW()),
    ('Med X Apoteka', 'https://medxapoteka.rs', 'medXapoteka.ts', '/logos/medXapoteka.jpg', NOW(), NOW()),
    ('Melisa', 'https://melisa.rs', 'melisa.ts', '/logos/melisa.png', NOW(), NOW()),
    ('Milica', 'https://apotekamilica.rs', 'milica.ts', '/logos/milica.png', NOW(), NOW()),
    ('Moc Bilja', 'https://www.mocbilja.rs', 'mocBilja.ts', '/logos/mocBilja.png', NOW(), NOW()),
    ('Nature Hub', 'https://www.naturehub.rs', 'natureHub.ts', '/logos/natureHub.png', NOW(), NOW()),
    ('Oaza Zdravlja', 'https://www.oazazdravlja.rs', 'oazaZdravlja.ts', '/logos/oazaZdravlja.png', NOW(), NOW()),
    ('Ogistra', 'https://www.ogistra-nutrition-shop.com', 'ogistra.ts', '/logos/ogistra.jpg', NOW(), NOW()),
    ('Oliva', 'https://www.oliva.rs', 'oliva.ts', '/logos/oliva.png', NOW(), NOW()),
    ('Prof Farm', 'https://apotekaproffarm.com', 'profFarm.ts', '/logos/profFarm.png', NOW(), NOW()),
    ('Pansport', 'https://www.pansport.rs', 'pansport.ts', '/logos/pansport.png', NOW(), NOW()),
    ('Proteinbox', 'https://proteinbox.rs', 'proteinbox.ts', '/logos/proteinbox.png', NOW(), NOW()),
    ('Proteini', 'https://rs.proteini.si', 'proteini.ts', '/logos/proteini.jpg', NOW(), NOW()),
    ('Ring Sport', 'https://www.ringsport.rs', 'ringSport.ts', '/logos/ringSport.png', NOW(), NOW()),
    ('Shopmania', 'https://www.shopmania.rs', 'shopmania.ts', '/logos/shopmania.png', NOW(), NOW()),
    ('Sop', 'https://sop.rs', 'sop.ts', '/logos/sop.png', NOW(), NOW()),
    ('Spartan Suplementi', 'https://suplementi-spartanshop.rs', 'spartanSuplementi.ts', '/logos/spartanSuplementi.png', NOW(), NOW()),
    ('Srbotrade', 'https://srbotrade.rs', 'srbotrade.ts', '/logos/srbotrade.jpg', NOW(), NOW()),
    ('Supplement Shop', 'https://supplementshop.rs', 'supplementShop.ts', '/logos/suplementStore.png', NOW(), NOW()),
    ('Superior', 'https://superior14.rs', 'superior.ts', '/logos/superior.png', NOW(), NOW()),
    ('Suplementi Srbija', 'https://www.suplementisrbija.rs', 'suplementiSrbija.ts', '/logos/suplementiSrbija.png', NOW(), NOW()),
    ('Suplementi Shop', 'https://suplementishop.com', 'suplementiShop.ts', '/logos/suplementiShop.png', NOW(), NOW()),
    ('Supplement Store', 'https://supplementstore.rs', 'supplementStore.ts', '/logos/suplementStore.png', NOW(), NOW()),
    ('Supplements', 'https://supplements.rs', 'supplements.ts', '/logos/supplements.png', NOW(), NOW()),
    ('Titanium Sport', 'https://www.titaniumsport.rs', 'titaniumSport.ts', '/logos/titaniumSport.png', NOW(), NOW()),
    ('Vitalikum', 'https://www.vitalikum.rs', 'vitalikum.ts', '/logos/vitalikum.png', NOW(), NOW()),
    ('Vitamin Shop', 'https://vitaminshop.rs', 'vitaminShop.ts', '/logos/vitaminShop.jpg', NOW(), NOW()),
    ('Web Apoteka', 'https://webapoteka.rs', 'webApoteka.ts', '/logos/webApoteka.png', NOW(), NOW()),
    ('X Sport', 'https://xsport.rs', 'xSport.ts', '/logos/xSport.png', NOW(), NOW()),
    ('XL Sport', 'https://www.xlsport.rs', 'xlSport.ts', '/logos/xlSport.jpg', NOW(), NOW()),
    ('Zelena Apoteka', 'https://prodaja.zelena-apoteka.com', 'zelenaApoteka.ts', '/logos/zelenaApoteka.webp', NOW(), NOW()),
    ('Zero', 'https://apotekazero.rs', 'zero.ts', '/logos/zero.png', NOW(), NOW())
ON CONFLICT (name) 
DO UPDATE SET 
    website = EXCLUDED.website,
    "scraperFile" = EXCLUDED."scraperFile",
    logo = EXCLUDED.logo,
    "updatedAt" = NOW();

-- Add some sample categories (optional)
INSERT INTO "Category" (name, "createdAt", "updatedAt")
VALUES 
    ('Vitamini i minerali', NOW(), NOW()),
    ('Suplementi', NOW(), NOW()),
    ('Probiotici', NOW(), NOW()),
    ('Sportska ishrana', NOW(), NOW()),
    ('Nega', NOW(), NOW()),
    ('Zdravlje', NOW(), NOW()),
    ('Bebe', NOW(), NOW()),
    ('Parfemi', NOW(), NOW()),
    ('Muškarci', NOW(), NOW()),
    ('Žene', NOW(), NOW())
ON CONFLICT (name) 
DO UPDATE SET 
    "updatedAt" = NOW();

-- Add some sample brands (optional)
INSERT INTO "Brand" (name, "createdAt", "updatedAt")
VALUES 
    ('Vitamin D3', NOW(), NOW()),
    ('Vitamin C', NOW(), NOW()),
    ('Calcium', NOW(), NOW()),
    ('Magnesium', NOW(), NOW()),
    ('Omega-3', NOW(), NOW()),
    ('Probiotik', NOW(), NOW()),
    ('Protein', NOW(), NOW()),
    ('BCAA', NOW(), NOW()),
    ('Kreatin', NOW(), NOW()),
    ('Multivitamin', NOW(), NOW())
ON CONFLICT (name) 
DO UPDATE SET 
    "updatedAt" = NOW();

-- Add some sample units (optional)
INSERT INTO "Unit" (name, "createdAt", "updatedAt")
VALUES 
    ('mg', NOW(), NOW()),
    ('mcg', NOW(), NOW()),
    ('iu', NOW(), NOW()),
    ('g', NOW(), NOW()),
    ('ml', NOW(), NOW()),
    ('kapsule', NOW(), NOW()),
    ('tablete', NOW(), NOW()),
    ('kesice', NOW(), NOW()),
    ('ampule', NOW(), NOW()),
    ('kom', NOW(), NOW())
ON CONFLICT (name) 
DO UPDATE SET 
    "updatedAt" = NOW();

-- Update statistics for query planner
ANALYZE "Vendor";
ANALYZE "Category";
ANALYZE "Brand";
ANALYZE "Unit";

-- Display seeding results
DO $$
DECLARE
    vendor_count INTEGER;
    category_count INTEGER;
    brand_count INTEGER;
    unit_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO vendor_count FROM "Vendor";
    SELECT COUNT(*) INTO category_count FROM "Category";
    SELECT COUNT(*) INTO brand_count FROM "Brand";
    SELECT COUNT(*) INTO unit_count FROM "Unit";
    
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'DATABASE SEEDING COMPLETED SUCCESSFULLY';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Seeded data summary:';
    RAISE NOTICE '  Vendors: % records', vendor_count;
    RAISE NOTICE '  Categories: % records', category_count;
    RAISE NOTICE '  Brands: % records', brand_count;
    RAISE NOTICE '  Units: % records', unit_count;
    RAISE NOTICE '';
    RAISE NOTICE 'All vendors have been seeded with:';
    RAISE NOTICE '  - Website URLs for scraping';
    RAISE NOTICE '  - Scraper file names for automation';
    RAISE NOTICE '  - Logo paths for frontend display';
    RAISE NOTICE '  - Automatic timestamps';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run scrapers to populate products';
    RAISE NOTICE '  2. Run preprocessing for enhanced search';
    RAISE NOTICE '  3. Setup ML models for better grouping';
    RAISE NOTICE '============================================================================';
END $$;