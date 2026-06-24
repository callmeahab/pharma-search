import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://vitaminshop.rs", "Vitamin Shop"), "Vitamin Shop")
  .then(() => process.exit(0)).catch((e) => { console.error("Vitamin Shop scraper failed:", e); process.exit(1); });
