/** Rehearse the real sync SQL in an isolated, disposable database. */
import { createDbPool } from '../scrapers/helpers/db';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dir,'..');
const dir = path.join(root,'cache/sync-rehearsal'); await mkdir(dir,{recursive:true});
const source = process.env.DATABASE_URL!;
const url = new URL(source); const dbName = `pharma_sync_test_${Date.now()}`;url.pathname='/'+dbName;
const target = url.toString(); const admin=createDbPool({connectionString:source});
const run=(cmd:string,args:string[],options:Record<string,unknown>={})=>{
 const r=spawnSync(cmd,args,{cwd:dir,encoding:'utf8',maxBuffer:8*1024*1024,...options});
 if(r.status!==0)throw new Error(`${cmd} failed: ${r.stderr?.slice(-2000)}`); return r.stdout;
};
try {
 await admin.query(`CREATE DATABASE "${dbName}"`);
 run('pg_dump',[source,'--schema-only','--no-owner','--no-privileges','-f',dir+'/schema.sql']);
 run('psql',[target,'-X','-v','ON_ERROR_STOP=1','-f','schema.sql']);
 const db=createDbPool({connectionString:target});
 try {
  await db.query(`INSERT INTO "User"(id,email) VALUES('sentinel','sync-test@example.invalid');
   INSERT INTO "Watch"(id,"userId","groupKey","displayName","targetPrice") VALUES('sentinel-watch','sentinel','legacy-test-key','Preserved watch',120);
   INSERT INTO "GroupPriceHistory"("groupKey","minPrice","offerCount") VALUES('legacy-test-key',130,1);`);
  run('bash',[root+'/deploy/sync-data.sh'],{env:{...process.env,SYNC_EXPORT_DIR:dir}});
  run('psql',[target,'-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','prepare.sql','-f','data.sql','-f','history.sql','-f','validate.sql']);
  const before=(await db.query('SELECT count(*)::int n FROM "OfferPriceObservation"')).rows[0].n;
  run('psql',[target,'-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','history.sql']);
  const after=(await db.query('SELECT count(*)::int n FROM "OfferPriceObservation"')).rows[0].n;
  if(before!==after)throw new Error('History replay duplicated observations');
  const offers=(await db.query('SELECT count(*)::int n FROM "CatalogOffer"')).rows[0].n;
  await writeFile(dir+'/fail.sql','SELECT 1/0;');
  const failed=spawnSync('psql',[target,'-X','-v','ON_ERROR_STOP=1','--single-transaction','-f','prepare.sql','-f','fail.sql'],{cwd:dir,encoding:'utf8'});
  if(failed.status===0)throw new Error('Forced failure unexpectedly succeeded');
  const restored=(await db.query('SELECT count(*)::int n FROM "CatalogOffer"')).rows[0].n;
  const watch=(await db.query('SELECT "targetPrice",needs_review FROM "Watch" WHERE id=$1',['sentinel-watch'])).rows[0];
  if(offers!==restored||watch.targetPrice!==120||!watch.needs_review)throw new Error('Rollback or saved watch preservation failed');
  console.log(JSON.stringify({passed:true,offers,observations:before,history_replay_idempotent:true,forced_failure_rolled_back:true,accounts_and_targets_preserved:true}));
 } finally {await db.end();}
} finally {await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);await admin.end();}
