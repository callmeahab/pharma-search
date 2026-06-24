import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://suplementishop.com", "Suplementi Shop"), "Suplementi Shop")
  .then(() => process.exit(0)).catch((e) => { console.error("Suplementi Shop scraper failed:", e); process.exit(1); });
