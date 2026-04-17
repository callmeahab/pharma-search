import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const allScrapers = [
  'ananas1.ts',
  '4fitness.ts',
  'adonis.ts',
  'aleksandarMn.ts',
  'alekSuplementi.ts',
  'amgSport.ts',
  'apotekamo.ts',
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
  'atpSport.ts',
  'azgard.ts',
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
  'explode.ts',
  'farmasi.ts',
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
  'supplements.ts',
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

interface ScraperResult {
  scraper: string;
  attempt: number;
  startTime: Date;
  duration: number;
  exitCode: number;
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
    const proc = spawn('bun', [`./${script}`], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
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
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (proc.exitCode === null && proc.signalCode === null) {
            proc.kill('SIGKILL');
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
  const exitCode =
    result.timedOut || result.exitCode !== 0 || result.products === 0 ? 1 : 0;

  if (exitCode === 0) {
    console.log(`✅ Finished: ${scraper} (${result.products} products)`);
  } else {
    console.log(
      `❌ Failed: ${scraper} (${result.timedOut ? 'timed out' : `exit code ${result.exitCode}`})`,
    );
  }

  return {
    scraper,
    attempt,
    startTime,
    duration,
    exitCode,
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

        if (result.exitCode !== 0 && next.attempt <= MAX_RETRIES) {
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
  console.log(`❗ Failed scrapers: ${failures.length}`);
  if (failures.length > 0) {
    console.log(
      failures
        .map((result) => `  - ${result.scraper} (attempt ${result.attempt})`)
        .join('\n'),
    );
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
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error running scrapers:', error);
    process.exit(1);
  });
