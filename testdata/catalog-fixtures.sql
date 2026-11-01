-- Synthetic public catalog for CI only. No accounts, emails or vendor traffic.
INSERT INTO "Vendor"(id,name) VALUES ('fixture-a','Fixture A'),('fixture-b','Fixture B');
INSERT INTO "Product"(id,"vendorId",title,price,link,thumbnail,photos,"extractedBrand","canonicalCategory","priceScrapedAt") VALUES
 ('fixture-z1','fixture-a','Solgar Cink 22mg 30 tableta',1600,'https://example.invalid/z1','','','Solgar','Supplements & Vitamins',now()),
 ('fixture-z2','fixture-b','Solgar Cink 22mg 30 tableta',1800,'https://example.invalid/z2','','','Solgar','Supplements & Vitamins',now()),
 ('fixture-m1','fixture-a','Solgar Magnezijum citrat 200mg 60 tableta',1300,'https://example.invalid/m1','','','Solgar','Supplements & Vitamins',now()),
 ('fixture-m2','fixture-a','Solgar Magnezijum bisglicinat 200mg 60 tableta',1900,'https://example.invalid/m2','','','Solgar','Supplements & Vitamins',now()),
 ('fixture-m3','fixture-a','Solgar Magnezijum oksid 200mg 60 tableta',1200,'https://example.invalid/m3','','','Solgar','Supplements & Vitamins',now()),
 ('fixture-f1','fixture-a','Fervex Phyto 20 pastila',650,'https://example.invalid/f1','','','Fervex','OTC Medicines',now()),
 ('fixture-p4','fixture-a','Pampers Premium Care 4 20 pelena 9-14kg',800,'https://example.invalid/p4','','','Pampers','Baby & Mom',now()),
 ('fixture-p2','fixture-a','Pampers Premium Care veličina 2 46 kom 4kg-8kg',999,'https://example.invalid/p2','','','Pampers','Baby & Mom',now());
