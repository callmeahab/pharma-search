import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://www.titaniumsport.rs", "Titanium Sport"), "Titanium Sport")
  .then(() => process.exit(0)).catch((e) => { console.error("Titanium Sport scraper failed:", e); process.exit(1); });
