import { existsSync } from 'node:fs';

// Where to find a real, working Chrome/Chromium. Puppeteer's bundled
// "Chrome for Testing" fails to launch in some sandboxed/locked-down environments
// (dlopen errors), so we prefer a system Chrome install.
//
// Resolution order:
//   1. PUPPETEER_EXECUTABLE_PATH (explicit override — wins)
//   2. a system Chrome/Chromium at a well-known OS path
//   3. undefined -> puppeteer falls back to its bundled browser
const SYSTEM_CHROME_CANDIDATES = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/** Resolve the Chrome executable to use, or undefined to use puppeteer's bundled one. */
export function resolveChromeExecutable(): string | undefined {
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (explicit) return explicit;
  for (const candidate of SYSTEM_CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
