import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classifyScraperResult, getSelectedScrapers, runBunScript, runScraper } from '../run-scrapers-worker';

test('worker preserves explicit blocked/unavailable states and rejects browser crashes', () => {
  const result={output:'',exitCode:0,products:10,timedOut:false};
  expect(classifyScraperResult({...result,output:'SCRAPER_FAILURE {"status":"unavailable"}'})).toBe('unavailable');
  expect(classifyScraperResult({...result,output:'SCRAPER_FAILURE {"status":"blocked"}'})).toBe('blocked');
  expect(classifyScraperResult({...result,output:'Attempted to use detached Frame'})).toBe('incomplete');
});
test('an explicit scraper filename does not match another store with a similar name',()=>{
  expect(getSelectedScrapers('apotekaNet.ts')).toEqual(['apotekaNet.ts']);
  expect(getSelectedScrapers('ananas')).toHaveLength(6);
});

test('worker publishes complete CSVs and retains the previous snapshot after a crash or truncated output', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'scraper-snapshot-test-'));
  const output=path.join(root,'output');
  const fixture=path.join(root,'fixture.ts');
  const previous=process.env.SCRAPER_OUTPUT_DIR;
  process.env.SCRAPER_OUTPUT_DIR=output;
  const helper=JSON.stringify(path.join(import.meta.dir,'database.ts'));
  async function script(price: number, extra='') {
    await writeFile(fixture,`import {initializeDatabase,insertData,closeDatabase} from ${helper};
      await initializeDatabase(); ${extra.includes('processed')?extra:''}
      await insertData([{title:'Vitamin, C\\n1000mg',price:'${price}',category:'vitamins',link:'https://example.com/c',thumbnail:'',photos:''}],'Test');
      ${extra.includes('processed')?'':extra} await closeDatabase();`);
  }
  try {
    await script(100);
    expect((await runScraper(fixture,1)).status).toBe('ok');
    const filename=(await readdir(output)).find(file=>file.endsWith('.csv'))!;
    const initial=await readFile(path.join(output,filename),'utf8');
    expect(initial).toContain(',100,');
    await script(200,`console.error('Navigating frame was detached');`);
    expect((await runScraper(fixture,1)).status).toBe('incomplete');
    expect(await readFile(path.join(output,filename),'utf8')).toBe(initial);
    await script(300,`console.log('Successfully processed 2 products');`);
    expect((await runScraper(fixture,1)).status).toBe('incomplete');
    expect(await readFile(path.join(output,filename),'utf8')).toBe(initial);
  } finally {
    if(previous===undefined) delete process.env.SCRAPER_OUTPUT_DIR; else process.env.SCRAPER_OUTPUT_DIR=previous;
    await rm(root,{recursive:true,force:true});
  }
});

test('worker closes inherited pipes when an exited scraper leaves a child behind', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'scraper-process-test-'));
  const fixture=path.join(root,'fixture.ts');
  await writeFile(fixture,`import {spawn} from 'node:child_process';
    const child=spawn('bun',['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
    console.log('CHILD_PID='+child.pid); process.exit(0);`);
  try {
    const result=await runBunScript(fixture,'process fixture',1000);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    const pid=Number(result.output.match(/CHILD_PID=(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(()=>process.kill(pid,0)).toThrow();
  } finally { await rm(root,{recursive:true,force:true}); }
});
