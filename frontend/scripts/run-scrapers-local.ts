#!/usr/bin/env bun

import { Worker } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'child_process';
import path from 'path';

const scrapers = [
  '4fitness.ts',
  'adonis.ts',
  'aleksandarMn.ts',
  'alekSuplementi.ts',
  'amgSport.ts',
  'ananas.ts',
  'apotekamo.ts',
  'apotekaNet.ts',
  'apotekaNis.ts',
  'apotekaOnline.ts',
  'apotekarOnline.ts',
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

const CONCURRENCY = 6;

interface ScraperResult {
  scraper: string;
  startTime: Date;
  duration: number;
  exitCode: number;
  products: number;
}

async function runScraper(
  scraper: string,
): Promise<{ exitCode: number; products: number }> {
  console.log(`🚀 Starting: ${scraper}`);
  return new Promise((resolve) => {
    const worker = new Worker(
      `
      import { parentPort, workerData } from 'worker_threads';
      import { spawn } from 'child_process';

      const { scraper } = workerData;
      const proc = spawn('bun', ['scrapers/' + scraper], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let productCount = 0;
      let fullOutput = '';
      let hasError = false;
      let hasSuccessfulScrape = false;
      let retryCount = 0;
      const MAX_RETRIES = 3;

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        fullOutput += chunk;
        
        if (chunk.includes('Successfully processed')) {
          const match = fullOutput.match(/Successfully processed (\\d+) products/);
          if (match) {
            productCount = parseInt(match[1], 10);
            hasSuccessfulScrape = true;
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const errorMsg = data.toString();
        // Check for database-related errors
        const isDatabaseError = errorMsg.includes('P2002') || // Unique constraint violation
                              errorMsg.includes('P2025') || // Record not found
                              errorMsg.includes('P2014') || // Foreign key constraint
                              errorMsg.includes('P2003');  // Foreign key constraint

        // Only mark as error if it's not a pagination error AND we haven't successfully scraped any products
        if (!errorMsg.includes('No products found on page') && 
            !errorMsg.includes('Waiting for selector') && 
            !errorMsg.includes('Successfully processed') && 
            !hasSuccessfulScrape) {
          hasError = true;
          console.error('Error in ' + scraper + ': ', errorMsg);

          // If it's a database error and we haven't exceeded retries, wait and continue
          if (isDatabaseError && retryCount < MAX_RETRIES) {
            retryCount++;
            console.log('Database error detected, waiting before retry (attempt ' + retryCount + '/' + MAX_RETRIES + ')...');
            setTimeout(() => {
              console.log('Continuing after database error...');
            }, 2000);
          }
        }
      });

      proc.on('error', (err) => {
        if (!hasSuccessfulScrape) {
          hasError = true;
          console.error('Failed to start ' + scraper + ': ', err);
        }
      });

      proc.on('close', async (code) => {
        const finalMatch = fullOutput.match(/Successfully processed (\\d+) products/);
        if (finalMatch) {
          productCount = parseInt(finalMatch[1], 10);
        }
        
        // Consider it successful if we found products, even if there were pagination errors
        const effectiveExitCode = (hasError && !hasSuccessfulScrape) || productCount === 0 ? 1 : 0;
        
        parentPort.postMessage({ 
          exitCode: effectiveExitCode,
          products: productCount 
        });
      });
    `,
      {
        eval: true,
        workerData: { scraper },
      },
    );

    worker.on('message', (result) => {
      if (result.exitCode === 0) {
        console.log(`✅ Finished: ${scraper} (${result.products} products)`);
      } else {
        console.log(`❌ Failed: ${scraper} (exit code: ${result.exitCode})`);
      }
      worker.terminate();
      resolve(result);
    });
  });
}

// Timestamp functions
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

async function exportDatabaseToSQL(): Promise<string> {
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
  const exportFile = `../exports/scraped-data-${timestamp}.sql`;
  
  // Create exports directory
  await mkdir('../exports', { recursive: true });
  
  console.log('📦 Exporting database to SQL...');
  
  return new Promise((resolve, reject) => {
    const exportProc = spawn('pg_dump', [
      process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pharmagician',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--exclude-table=_prisma_migrations',
      '--file=' + exportFile
    ]);

    let errorOutput = '';
    
    exportProc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    exportProc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Database exported to: ${exportFile}`);
        resolve(exportFile);
      } else {
        console.error('❌ Database export failed:', errorOutput);
        reject(new Error(`Database export failed with code ${code}: ${errorOutput}`));
      }
    });

    exportProc.on('error', (error) => {
      reject(error);
    });
  });
}

async function runCleanupScripts(): Promise<void> {
  console.log('\n🧹 Running cleanup scripts...');
  
  const cleanupScripts = [
    'scripts/deleteItemsWithoutPrice.ts',
    'scripts/deleteDuplicateProducts.ts'
  ];
  
  for (const script of cleanupScripts) {
    console.log(`🧹 Running ${script}...`);
    
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', [script], { stdio: 'inherit' });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Cleanup script ${script} failed with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }
}

async function main() {
  const globalStartTime = Date.now();
  console.log(`🔄 Starting local scrapers with concurrency: ${CONCURRENCY}`);
  console.log(`📋 Total scrapers to run: ${scrapers.length}\n`);
  const startMemory = process.memoryUsage();
  let totalProducts = 0;

  const logDir = '../scrapers_logs';
  const logFile = path.join(logDir, `${getLogFileName()}.txt`);

  await mkdir(logDir, { recursive: true });
  await writeFile(
    logFile,
    'Time                    Duration    Exit    Products    Scraper\n' +
      '----                    --------    ----    --------    -------\n',
  );

  const queue = [...scrapers];
  const running = new Set();
  const results: ScraperResult[] = [];
  const failedScrapers: string[] = [];

  while (queue.length > 0 || running.size > 0) {
    // Fill up to CONCURRENCY
    while (running.size < CONCURRENCY && queue.length > 0) {
      const scraper = queue.shift()!;
      const startTime = new Date();

      const promise = runScraper(scraper).then((result) => {
        running.delete(promise);
        const duration = Date.now() - startTime.getTime();
        results.push({ scraper, startTime, duration, ...result });

        // Add failed scrapers to retry queue
        if (result.exitCode !== 0) {
          failedScrapers.push(scraper);
        } else {
          totalProducts += result.products;
        }
      });

      running.add(promise);
    }

    // Wait for one to complete
    if (running.size > 0) {
      await Promise.race(running);
    }
  }

  // Retry failed scrapers sequentially
  if (failedScrapers.length > 0) {
    console.log(
      `\n🔄 Retrying ${failedScrapers.length} failed scrapers in sequential mode...`,
    );

    for (const scraper of failedScrapers) {
      console.log(`\n🔄 Retrying: ${scraper}`);
      const startTime = new Date();
      const result = await runScraper(scraper);
      const duration = Date.now() - startTime.getTime();

      // Update or add new result
      const existingIndex = results.findIndex((r) => r.scraper === scraper);
      const retryResult = { scraper, startTime, duration, ...result };

      if (existingIndex !== -1) {
        results[existingIndex] = retryResult;
      } else {
        results.push(retryResult);
      }

      if (result.exitCode === 0) {
        totalProducts += result.products;
      }
    }
  }

  // Write results with padded columns
  for (const result of results.sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime(),
  )) {
    const time = result.startTime.toISOString().replace('T', ' ').slice(0, 19);
    const duration = formatDuration(result.duration).padEnd(12);
    const exit = result.exitCode.toString().padEnd(8);
    const products = result.products.toString().padEnd(12);

    await writeFile(
      logFile,
      `${time}    ${duration}${exit}${products}${result.scraper}\n`,
      { flag: 'a' },
    );
  }

  console.log(`\n📊 Total Products Scraped: ${totalProducts}`);

  // Run cleanup scripts
  await runCleanupScripts();

  // Export database to SQL
  try {
    const exportFile = await exportDatabaseToSQL();
    console.log(`\n📁 SQL export ready: ${exportFile}`);
    
    // Add export info to log
    await writeFile(
      logFile,
      `\nSQL Export: ${exportFile}\n`,
      { flag: 'a' },
    );
  } catch (error) {
    console.error('❌ Failed to export database:', error);
  }

  // Calculate runtime
  const totalRuntime = Date.now() - globalStartTime;
  const hours = Math.floor(totalRuntime / 3600000);
  const minutes = Math.floor((totalRuntime % 3600000) / 60000);
  const seconds = Math.floor((totalRuntime % 60000) / 1000);

  const runtimeStr = `${hours}h ${minutes}m ${seconds}s`;

  // Add to log file
  await writeFile(logFile, `\nTotal Runtime: ${runtimeStr}\n`, { flag: 'a' });

  // Log to console
  console.log(`\n⏱️ Total Runtime: ${runtimeStr}`);

  // Memory usage logging
  const endMemory = process.memoryUsage();
  console.log('Memory usage (MB):', {
    start: Math.round(startMemory.heapUsed / 1024 / 1024),
    end: Math.round(endMemory.heapUsed / 1024 / 1024),
    diff: Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024),
  });

  console.log(`\n🎉 Scraping completed! SQL export ready for upload to server.`);
}

main().catch(console.error);