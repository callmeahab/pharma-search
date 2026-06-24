import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://supplementshop.rs", "Supplement Shop"), "Supplement Shop")
  .then(() => process.exit(0)).catch((e) => { console.error("Supplement Shop scraper failed:", e); process.exit(1); });
