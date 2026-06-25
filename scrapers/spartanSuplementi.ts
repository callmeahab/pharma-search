import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://suplementi-spartanshop.rs", "Spartan Suplementi"), "Spartan Suplementi")
  .then(() => process.exit(0)).catch((e) => { console.error("Spartan Suplementi scraper failed:", e); process.exit(1); });
