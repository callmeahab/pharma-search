import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const allScrapers = [
  'ananas1.ts',
  // '4fitness.ts',   // RETIRED 2026-06-22: 4fitness.rs is no longer a shop (now a WordPress blog)
  'adonis.ts',
  'aleksandarMn.ts',
  'alekSuplementi.ts',
  'amgSport.ts',
  // 'apotekamo.ts',  // RETIRED 2026-06-22: apotekamo.rs offline ("under construction")
  'apotekaNet.ts',
  'apotekaNis.ts',
  'apotekaOnline.ts',
  'apotekarOnline.ts',
  'ananas2.ts',
  'apotekaShop.ts',
  'apotekaSunce.ts',
  'apotekaValerijana.ts',
  'apotekaZivanovic.ts',
  'apothecary.ts',
  // 'atpSport.ts',  // RETIRED 2026-06-22: atpsport.rs has no DNS (no A/NS records) — domain dead
  // 'azgard.ts',    // RETIRED 2026-06-22: azgard.rs has no DNS (no A/NS records) — domain dead
  'bazzar.ts',
  'benu.ts',
  'biofarm.ts',
  'dm.ts',
  'drMax.ts',
  'ananas3.ts',
  'eApoteka.ts',
  'eApotekaNet.ts',
  'eApotekaRs.ts',
  'ePlaneta.ts',
  'esensa.ts',
  'exYuFitness.ts',
  // 'explode.ts',    // RETIRED 2026-06-22: explode.rs decommissioned (placeholder page)
  // 'farmasi.ts',  // RETIRED 2026-06-24: file fully commented out; klub.farmasi.rs shop server decommissioned (port 443 filtered) and public farmasi.rs is a JS-only SPA. No viable source.
  'filly.ts',
  'fitLab.ts',
  'fitnessShop.ts',
  'flos.ts',
  'gymBeam.ts',
  'herba.ts',
  'hiper.ts',
  'ananas4.ts',
  'houseOfSupplements.ts',
  'jankovic.ts',
  'jugofarm.ts',
  'krsenkovic.ts',
  'lama.ts',
  'laurus.ts',
  'lily.ts',
  'livada.ts',
  'maelia.ts',
  'maxFarm.ts',
  'maximalium.ts',
  'ananas5.ts',
  'medXapoteka.ts',
  'melisa.ts',
  'milica.ts',
  'mocBilja.ts',
  'natureHub.ts',
  'oazaZdravlja.ts',
  'ogistra.ts',
  'oliva.ts',
  'pansport.ts',
  'profFarm.ts',
  'ananas6.ts',
  'proteinbox.ts',
  'proteini.ts',
  'ringSport.ts',
  'shopmania.ts',
  'sop.ts',
  'spartanSuplementi.ts',
  'srbotrade.ts',
  'supplementShop.ts',
  'supplementStore.ts',
  // 'supplements.ts', // RETIRED 2026-06-22: supplements.rs domain parked / for sale
  'suplementiShop.ts',
  'suplementiSrbija.ts',
  'superior.ts',
  'titaniumSport.ts',
  'vitalikum.ts',
  'vitaminShop.ts',
  'webApoteka.ts',
  'xlSport.ts',
  'xSport.ts',
  'zelenaApoteka.ts',
  'zero.ts',
] as const;

const CONCURRENCY = parsePositiveInt(process.env.SCRAPER_CONCURRENCY, 6);
const MAX_RETRIES = parsePositiveInt(process.env.SCRAPER_RETRIES, 1);
const SCRAPER_TIMEOUT_MS = parsePositiveInt(
  process.env.SCRAPER_TIMEOUT_MS,
  15 * 60 * 1000,
);
const RUN_DB_CLEANUP = process.env.SCRAPER_RUN_DB_CLEANUP === '1';
const RUN_DEDUPE = process.env.SCRAPER_RUN_DEDUPE !== '0';
const SCRAPER_FILTER = process.env.SCRAPER_FILTER?.trim().toLowerCase() || '';
// Exit non-zero (so the scheduler/alerting notices) when this fraction of scrapers fail.
const FAILURE_ALERT_RATIO = parseFloat(process.env.SCRAPER_FAILURE_ALERT_RATIO || '0.1');
const ALERT_WEBHOOK = process.env.SCRAPER_ALERT_WEBHOOK?.trim() || '';

type ScraperStatus = 'ok' | 'empty' | 'error' | 'timeout';

interface ScraperResult {
  scraper: string;
  attempt: number;
  startTime: Date;
  duration: number;
  exitCode: number;
  status: ScraperStatus;
  products: number;
  timedOut: boolean;
}

interface CleanupResult {
  output: string;
  exitCode: number;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Kill the whole process group (negative pid) so a timed-out scraper's Chromium
// children die with it. Falls back to killing just the child if the group send fails.
function killGroup(proc: { pid?: number; kill: (s: NodeJS.Signals) => void }, signal: NodeJS.Signals) {
  try {
    if (proc.pid) process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    try { proc.kill(signal); } catch { /* already gone */ }
  }
}

// Safety net after a run: reap any orphaned headless Chromium left by crashes.
async function killOrphanChrome() {
  await new Promise<void>((resolve) => {
    const p = spawn('pkill', ['-f', 'chrome.*--headless'], { stdio: 'ignore' });
    p.on('error', () => resolve());
    p.on('close', () => resolve());
  });
}

// Best-effort failure alert (Slack-style webhook). No-op if SCRAPER_ALERT_WEBHOOK unset.
async function sendAlert(summary: string, failures: ScraperResult[]) {
  if (!ALERT_WEBHOOK) return;
  const lines = failures
    .map((f) => `• ${f.scraper}: ${f.status}${f.products ? ` (${f.products})` : ''}`)
    .join('\n');
  try {
    await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `🕷️ Scraper run: ${summary}\n${lines}` }),
    });
  } catch (error) {
    console.error('Alert webhook failed:', error);
  }
}

function getSelectedScrapers() {
  if (!SCRAPER_FILTER) {
    return [...allScrapers];
  }

  const filters = SCRAPER_FILTER
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return allScrapers.filter((scraper) =>
    filters.some(
      (filter) =>
        scraper.toLowerCase().includes(filter) ||
        scraper.replace(/\.ts$/, '').toLowerCase() === filter,
    ),
  );
}

function getLogFileName(date = new Date()) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();

  return `${hours}-${minutes}_${day}-${month}-${year}-logs`;
}

function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function extractProductCount(output: string) {
  const patterns = [
    /Successfully processed (\d+) products/i,
    /Successfully wrote (\d+) products/i,
    /Successfully stored (\d+) products/i,
    /Total products for .*: (\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return Number.parseInt(match[1], 10);
    }
  }

  return 0;
}

function runBunScript(
  script: string,
  label: string,
  timeoutMs = SCRAPER_TIMEOUT_MS,
): Promise<CleanupResult & { products: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    // detached:true puts the scraper (and the Chromium it launches) in its own
    // process group so we can kill the WHOLE group on timeout — otherwise only
    // bun dies and Chromium is orphaned (memory leak, runs exceeding the cap).
    const proc = spawn('bun', [`./${script}`], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let output = '';
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const finish = (exitCode: number | null) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      resolve({
        output,
        exitCode: exitCode ?? 1,
        products: extractProductCount(output),
        timedOut,
      });
    };

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        console.error(`⏰ ${label} exceeded ${formatDuration(timeoutMs)}. Stopping...`);
        killGroup(proc, 'SIGTERM');
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            killGroup(proc, 'SIGKILL');
          }
        }, 5000);
      }, timeoutMs);
    }

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stderr.write(chunk);
    });

    proc.on('error', (error) => {
      output += `${error.message}\n`;
      finish(1);
    });

    proc.on('close', (code) => {
      finish(code);
    });
  });
}

async function runScraper(scraper: string, attempt: number): Promise<ScraperResult> {
  const startTime = new Date();
  console.log(`🚀 Starting: ${scraper} (attempt ${attempt}/${MAX_RETRIES + 1})`);
  const result = await runBunScript(scraper, scraper);
  const duration = Date.now() - startTime.getTime();

  // Distinguish the failure modes — they need different handling:
  //   timeout → likely repeats, don't retry; empty → deterministic (broken
  //   selector / block), don't retry; error → may be transient, retry once.
  let status: ScraperStatus;
  if (result.timedOut) status = 'timeout';
  else if (result.exitCode !== 0) status = 'error';
  else if (result.products === 0) status = 'empty';
  else status = 'ok';
  const exitCode = status === 'ok' ? 0 : 1;

  if (status === 'ok') {
    console.log(`✅ Finished: ${scraper} (${result.products} products)`);
  } else {
    console.log(`❌ Failed: ${scraper} (${status})`);
  }

  return {
    scraper,
    attempt,
    startTime,
    duration,
    exitCode,
    status,
    products: result.products,
    timedOut: result.timedOut,
  };
}

async function runQueue(scrapers: string[]) {
  const queue = scrapers.map((scraper) => ({ scraper, attempt: 1 }));
  const running = new Set<Promise<void>>();
  const finalResults = new Map<string, ScraperResult>();

  while (queue.length > 0 || running.size > 0) {
    while (running.size < CONCURRENCY && queue.length > 0) {
      const next = queue.shift()!;
      const runPromise = runScraper(next.scraper, next.attempt).then((result) => {
        running.delete(runPromise);
        finalResults.set(result.scraper, result);

        // Retry only transient process errors. Timeouts repeat and empty results
        // are deterministic (broken selector / block) — retrying them just wastes
        // ~15 min each, so flag them for a code fix instead.
        if (result.status === 'error' && next.attempt <= MAX_RETRIES) {
          queue.push({ scraper: result.scraper, attempt: next.attempt + 1 });
        }
      });

      running.add(runPromise);
    }

    if (running.size > 0) {
      await Promise.race(running);
    }
  }

  return Array.from(finalResults.values());
}

async function writeSummaryLog(logFile: string, results: ScraperResult[], totalRuntime: number) {
  for (const result of results.sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  )) {
    const time = result.startTime.toISOString().replace('T', ' ').slice(0, 19);
    const duration = formatDuration(result.duration).padEnd(12);
    const exit = result.exitCode.toString().padEnd(8);
    const products = result.products.toString().padEnd(12);
    const attempt = `${result.attempt}`.padEnd(8);
    const timeout = result.timedOut ? 'yes' : 'no';

    await appendFile(
      logFile,
      `${time}    ${duration}${exit}${products}${attempt}${timeout.padEnd(8)}${result.scraper}\n`,
    );
  }

  const slowest = [...results]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, Math.min(results.length, 10))
    .map(
      (result) =>
        `${result.scraper}: ${formatDuration(result.duration)} (${result.products} products, attempt ${result.attempt})`,
    );

  const hours = Math.floor(totalRuntime / 3600000);
  const minutes = Math.floor((totalRuntime % 3600000) / 60000);
  const seconds = Math.floor((totalRuntime % 60000) / 1000);

  await appendFile(
    logFile,
    `\nSlowest Scrapers:\n-----------------\n${slowest.join('\n')}\n\nTotal Runtime: ${hours}h ${minutes}m ${seconds}s\n`,
  );
}

async function runPostProcessing(logFile: string) {
  if (!RUN_DB_CLEANUP) {
    console.log('\n⏭️ Skipping database cleanup. Set SCRAPER_RUN_DB_CLEANUP=1 to enable it.');
    await appendFile(
      logFile,
      '\nPost-processing skipped (SCRAPER_RUN_DB_CLEANUP is not enabled)\n',
    );
    return;
  }

  console.log('\n🧹 Running zero-price cleanup...');
  const cleanupResult = await runBunScript(
    'deleteItemsWithoutPrice.ts',
    'deleteItemsWithoutPrice.ts',
    10 * 60 * 1000,
  );

  let summary =
    '\nCleanup Results:\n--------------\n' +
    `Zero-price cleanup exit code: ${cleanupResult.exitCode}\n`;

  const deletedMatch = cleanupResult.output.match(
    /Deleted (\d+) zero-price products from database/,
  );
  if (deletedMatch) {
    summary += `Deleted ${deletedMatch[1]} zero-price products\n`;
  }

  if (RUN_DEDUPE) {
    console.log('\n🔍 Running duplicate products cleanup...');
    const dedupeResult = await runBunScript(
      'deleteDuplicateProducts.ts',
      'deleteDuplicateProducts.ts',
      10 * 60 * 1000,
    );

    summary += `Duplicate cleanup exit code: ${dedupeResult.exitCode}\n`;
    const duplicateMatch = dedupeResult.output.match(/Total products deleted: (\d+)/);
    if (duplicateMatch) {
      summary += `Deleted ${duplicateMatch[1]} duplicate products\n`;
    }
  } else {
    summary += 'Duplicate cleanup skipped (SCRAPER_RUN_DEDUPE=0)\n';
  }

  await appendFile(logFile, summary);
}

async function main() {
  const globalStartTime = Date.now();
  const scrapers = getSelectedScrapers();

  if (scrapers.length === 0) {
    throw new Error(
      `No scrapers matched SCRAPER_FILTER="${process.env.SCRAPER_FILTER || ''}"`,
    );
  }

  console.log(`🔄 Starting scrapers with concurrency: ${CONCURRENCY}`);
  console.log(`📋 Total scrapers to run: ${scrapers.length}`);
  if (SCRAPER_FILTER) {
    console.log(`🎯 Filter: ${SCRAPER_FILTER}`);
  }
  console.log(`⏱️ Timeout per scraper: ${formatDuration(SCRAPER_TIMEOUT_MS)}\n`);

  const logDir = '../scrapers_logs';
  const logFile = path.join(logDir, `${getLogFileName()}.txt`);
  await mkdir(logDir, { recursive: true });
  await writeFile(
    logFile,
    'Time                    Duration    Exit    Products    Attempt TimedOut Scraper\n' +
      '----                    --------    ----    --------    ------- -------- -------\n',
  );

  const startMemory = process.memoryUsage();
  const results = await runQueue(scrapers);
  const totalRuntime = Date.now() - globalStartTime;
  const totalProducts = results
    .filter((result) => result.exitCode === 0)
    .reduce((sum, result) => sum + result.products, 0);
  const failures = results.filter((result) => result.exitCode !== 0);

  await writeSummaryLog(logFile, results, totalRuntime);
  await runPostProcessing(logFile);

  console.log(`\n📦 Total products from successful scrapers: ${totalProducts}`);
  console.log(`❗ Failed scrapers: ${failures.length}/${results.length}`);
  if (failures.length > 0) {
    const byStatus = failures.reduce((m, r) => m.set(r.status, (m.get(r.status) || 0) + 1), new Map<string, number>());
    console.log(`   breakdown: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(', ')}`);
    console.log(
      failures
        .map((result) => `  - ${result.scraper} (${result.status})`)
        .join('\n'),
    );
  }

  // Reap any orphaned headless Chromium from crashes/timeouts.
  await killOrphanChrome();

  // Alert + signal the scheduler when too many scrapers fail (so a silent outage
  // can't go unnoticed for months again).
  const failureRate = results.length > 0 ? failures.length / results.length : 0;
  if (failures.length > 0) {
    const summary = `${results.length - failures.length}/${results.length} ok, ${totalProducts} products, ${failures.length} failed (${(failureRate * 100).toFixed(0)}%)`;
    await sendAlert(summary, failures);
    if (failureRate > FAILURE_ALERT_RATIO) {
      console.error(`\n🚨 Failure rate ${(failureRate * 100).toFixed(0)}% exceeds ${(FAILURE_ALERT_RATIO * 100).toFixed(0)}% — exiting non-zero.`);
      process.exitCode = 1;
    }
  }

  const endMemory = process.memoryUsage();
  console.log('Memory usage (MB):', {
    start: Math.round(startMemory.heapUsed / 1024 / 1024),
    end: Math.round(endMemory.heapUsed / 1024 / 1024),
    diff: Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024),
  });
}

main()
  .then(() => {
    console.log('\n✅ All scrapers completed');
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error('❌ Error running scrapers:', error);
    process.exit(1);
  });
