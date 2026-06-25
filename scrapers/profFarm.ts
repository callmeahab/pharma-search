import { runApiScraper, scrapeWooStore } from "./helpers/apiScrapers";
runApiScraper(() => scrapeWooStore("https://apotekaproffarm.com", "Prof Farm"), "Prof Farm")
  .then(() => process.exit(0)).catch((e) => { console.error("Prof Farm scraper failed:", e); process.exit(1); });
