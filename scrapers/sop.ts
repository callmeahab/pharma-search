import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://sop.rs", "Sop"), "Sop")
  .then(() => process.exit(0)).catch((e) => { console.error("Sop scraper failed:", e); process.exit(1); });
