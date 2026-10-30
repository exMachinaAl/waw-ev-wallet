import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {once as eventOnce} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {openDb,transaction,ensurePlayer,wallet,accountId} from '../src/db.mjs';
import {postTransfer,readWallet,readHistory,readReceipt,heldAmount} from '../src/val/ledger.mjs';
import {migrateVal,reconcileVal,hasValSchema} from '../src/val/schema.mjs';
import {playSafety,updateSafety} from '../src/val/play-safety.mjs';
import {reserve} from '../src/val/reserves.mjs';
const cmd=()=>randomUUID(),admin={id:'val-fixture-admin',role:'ADMIN'};
function fixture(file){const db=openDb(file);const a=transaction(db,()=>ensurePlayer(db,'val-alice')),b=transaction(db,()=>ensurePlayer(db,'val-bob'));return {db,a,b};}
function good(db){const report=reconcileVal(db);assert.equal(report.ok,true,JSON.stringify(report.errors));assert.deepEqual(new Set(report.accounts.map(a=>a.kind)),new Set(['PLAYER','TREASURY','FAUCET']));}
function legacy(db){for(const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'val_%'").all())db.exec(`DROP TRIGGER ${t.name}`);for(const table of ['val_openings','val_scope','val_commands','val_play_safety'])db.exec(`DROP TABLE ${table}`);db.prepare('DELETE FROM schema_migrations WHERE version=?').run('val-arcade-1');}
function snapshot(db){return Object.fromEntries(['accounts','transfers','entries','game_sessions','game_actions','treasury_reserves','browser_sessions','outbox'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));}

test('VAL migration refuses mismatched legacy genesis instead of inventing a balancing entry',()=>{
 const {db}=fixture();try{legacy(db);db.exec("UPDATE accounts SET balance=balance+1 WHERE id='wa-faucet'");assert.throws(()=>migrateVal(db),{code:'VAL_RECONCILIATION_REQUIRED'});assert.equal(hasValSchema(db),false)}finally{db.close()}
});

test('VAL dry-run leaves source unchanged; old writers fail closed after explicit fixture cutover',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'val-migrate-test-')),file=path.join(dir,'fixture.sqlite');let db;
 try{({db}=fixture(file));legacy(db);const before=snapshot(db);db.close();db=null;
  assert.throws(()=>openDb(file),{code:'VAL_MIGRATION_REQUIRED'});
  const run=flag=>spawnSync(process.execPath,['--experimental-sqlite','scripts/migrate-val.mjs',file,flag],{encoding:'utf8'});
  const dry=run('--dry-run');assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).reconciliation.ok,true);
  db=new DatabaseSync(file);assert.equal(hasValSchema(db),false);assert.deepEqual(snapshot(db),before);db.close();db=null;
  const apply=run('--apply');assert.equal(apply.status,0,apply.stderr);
  db=new DatabaseSync(file);assert.throws(()=>db.exec("UPDATE accounts SET balance=balance-1 WHERE id='wa-treasury'"),/val_writer_v1/);db.close();db=openDb(file);assert.deepEqual(snapshot(db),before);good(db);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
});

test('VAL transfer retries return the original journal; changed amount/account/reason are rejected',()=>{
 const {db,a,b}=fixture();try{const input={from:accountId(db,a),to:'wa-treasury',amount:100,eventKey:cmd(),reason:'fixture stake'};
  assert.throws(()=>postTransfer(db,input),{code:'VAL_TRANSACTION_REQUIRED'});
  const first=transaction(db,()=>postTransfer(db,input));for(let i=0;i<20;i++)assert.equal(transaction(db,()=>postTransfer(db,input)).transferId,first.transferId);
  for(const change of [{amount:101},{from:accountId(db,b)},{reason:'changed'}])assert.throws(()=>transaction(db,()=>postTransfer(db,{...input,...change})),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(wallet(db,a),400);assert.equal(readReceipt(db,a,first.transferId).amount,'100');assert.throws(()=>readReceipt(db,b,first.transferId),{code:'RECEIPT_NOT_FOUND'});good(db);
 }finally{db.close()}
});

test('VAL integer, overflow, scope and treasury holds reject unsafe spending without partial writes',()=>{
 const {db,a,b}=fixture();try{const debit={from:accountId(db,a),to:'wa-treasury',amount:1,eventKey:cmd(),reason:'fixture'};
  for(const amount of [1.5,NaN,Infinity,0,-1,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>transaction(db,()=>postTransfer(db,{...debit,amount})),{code:'INVALID_AMOUNT'});
  assert.throws(()=>transaction(db,()=>postTransfer(db,{...debit,to:accountId(db,b)})),{code:'POCKET_TRANSFER_FORBIDDEN'});
  assert.throws(()=>transaction(db,()=>postTransfer(db,{...debit,tenant:'other'})),{code:'INVALID_ACCOUNTS'});
  transaction(db,()=>reserve(db,'obligation',799999));assert.equal(heldAmount(db,db.prepare("SELECT * FROM accounts WHERE id='wa-treasury'").get()),799999);
  assert.throws(()=>transaction(db,()=>postTransfer(db,{from:'wa-treasury',to:accountId(db,a),amount:2,eventKey:cmd(),reason:'payout'})),{code:'TREASURY_RESERVED'});
  assert.equal(readWallet(db,a).held,'0');assert.equal(wallet(db,a),500);good(db);
  // Deliberately corrupt a fixture only, to exercise the numeric guard and reconciliation.
  db.prepare("UPDATE accounts SET balance=? WHERE id='wa-treasury'").run(Number.MAX_SAFE_INTEGER);
  assert.throws(()=>transaction(db,()=>postTransfer(db,debit)),{code:'BALANCE_OVERFLOW'});assert.equal(reconcileVal(db).ok,false);
  db.prepare('INSERT INTO treasury_reserves VALUES(?,?,?)').run('too-large','wa-world',Number.MAX_SAFE_INTEGER);assert.throws(()=>heldAmount(db,db.prepare("SELECT * FROM accounts WHERE id='wa-treasury'").get()),{code:'RESERVE_OVERFLOW'});
 }finally{db.close()}
});

test('VAL simultaneous writers serialize two spends and retry one settlement after commit/reopen',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'val-race-test-')),file=path.join(dir,'fixture.sqlite');let db;const workers=[];
 try{let a;({db,a}=fixture(file));const input={from:accountId(db,a),to:'wa-treasury',amount:400,reason:'race stake'};db.close();db=null;
  for(let i=0;i<2;i++){const w=new Worker(new URL('./fixtures/val-spend-worker.mjs',import.meta.url),{workerData:{file,transfer:{...input,eventKey:`race-command-${i}`}}});workers.push(w);await eventOnce(w,'message');}
  const waits=workers.map(w=>eventOnce(w,'message'));workers.forEach(w=>w.postMessage('go'));const results=(await Promise.all(waits)).map(([r])=>r);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'INSUFFICIENT_ACR');
  await Promise.all(workers.map(w=>w.terminate()));db=openDb(file);assert.equal(wallet(db,a),100);const winner=results.findIndex(r=>r.ok);assert.equal(transaction(db,()=>postTransfer(db,{...input,eventKey:`race-command-${winner}`})).transferId,results[winner].result.transferId);good(db);
 }finally{await Promise.all(workers.map(w=>w.terminate()));db?.close();rmSync(dir,{recursive:true,force:true})}
});

test('VAL pagination has stable tie ordering, no duplicates, and enforces receipt/cursor ownership',()=>{
 const {db,a,b}=fixture();try{for(let i=0;i<8;i++)transaction(db,()=>postTransfer(db,{from:accountId(db,a),to:'wa-treasury',amount:1,eventKey:cmd(),reason:'fixture'}));db.exec('UPDATE transfers SET created_ms=100');
  const ids=[];let cursor=null;do{const page=readHistory(db,a,{cursor,limit:2});ids.push(...page.transactions.map(t=>t.id));cursor=page.next_cursor}while(cursor);
  assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);assert.deepEqual(ids,[...ids].sort().reverse());
  assert.throws(()=>readHistory(db,b,{cursor:ids[0]}),{code:'RECEIPT_NOT_FOUND'});assert.throws(()=>readHistory(db,a,{limit:0}),{code:'INVALID_PAGE_SIZE'});good(db);
 }finally{db.close()}
});
