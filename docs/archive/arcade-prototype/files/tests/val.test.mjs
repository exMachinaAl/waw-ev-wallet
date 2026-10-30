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
import {createGame,act,getSession} from '../src/games.mjs';
import {reserve} from '../src/stake-policy.mjs';
import {setupRooms,createRoom,joinRoom,roomAction} from '../src/rooms.mjs';
import {setupBlackjackTables,createBlackjackTable,blackjackTableAction} from '../src/blackjack-tables.mjs';
import {initialFusionState,resolveFusionSpin,POT} from '../src/ultimate-fusion.mjs';
import {createRoulette,submitSlip,rouletteAdminAction,rouletteView} from '../src/roulette-rounds.mjs';
import {createLottery,lotteryAdminAction,buyLotteryTicket,lotteryView,lotteryNumber,sweepLottery} from '../src/lottery.mjs';
const cmd=()=>randomUUID(),admin={id:'val-fixture-admin',role:'ADMIN'};
function fixture(file){const db=openDb(file);setupRooms(db);setupBlackjackTables(db);const a=transaction(db,()=>ensurePlayer(db,'val-alice')),b=transaction(db,()=>ensurePlayer(db,'val-bob'));return {db,a,b};}
function good(db){const report=reconcileVal(db);assert.equal(report.ok,true,JSON.stringify(report.errors));assert.deepEqual(new Set(report.accounts.map(a=>a.kind)),new Set(['PLAYER','TREASURY','FAUCET']));}
function legacy(db){for(const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'val_%'").all())db.exec(`DROP TRIGGER ${t.name}`);for(const table of ['val_openings','val_scope','val_commands','val_play_safety'])db.exec(`DROP TABLE ${table}`);db.prepare('DELETE FROM schema_migrations WHERE version=?').run('val-arcade-1');}
function snapshot(db){return Object.fromEntries(['accounts','transfers','entries','game_sessions','game_actions','treasury_reserves','browser_sessions','outbox'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));}

test('VAL migration preserves IDs, amounts, sessions, opening balances and reserves; second migration is a no-op',()=>{
 const {db,a}=fixture();try{
  const s=createGame(db,a,'A1-01',1).session;act(db,a,s.id,{command_id:cmd(),action:'SPIN',expected_version:1,bet:1});
  transaction(db,()=>reserve(db,'fixture-liability',200));legacy(db);const before=snapshot(db);
  assert.equal(migrateVal(db).applied,true);assert.deepEqual(snapshot(db),before);assert.equal(migrateVal(db).applied,false);assert.deepEqual(snapshot(db),before);
  const openings=reconcileVal(db).accounts;assert.equal(openings.find(a=>a.kind==='TREASURY').opening,'800000');assert.equal(openings.find(a=>a.kind==='FAUCET').opening,'2000000');good(db);
  const old=db.prepare('SELECT command_id FROM game_actions LIMIT 1').get();assert.throws(()=>act(db,a,s.id,{command_id:old.command_id,action:'SPIN',expected_version:1,bet:2}),{code:'LEGACY_COMMAND_UNVERIFIABLE'});
 }finally{db.close()}
});

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

test('VAL game command fingerprint, deterministic payout receipt, and rollback of game/ledger/outbox on failure',()=>{
 const {db,a}=fixture();try{
  const s=createGame(db,a,'B1',1).session;
  // Every number wins one straight bet; rules and RNG remain unchanged.
  const bets=Array.from({length:37},(_,i)=>({choice:String(i),stake:1}));
  const c={command_id:cmd(),action:'SPIN',bets,expected_version:1};
  const result=act(db,a,s.id,c);for(let i=0;i<20;i++)assert.deepEqual(act(db,a,s.id,c),result);
  const entries=readHistory(db,a,{limit:100}).transactions;assert.ok(entries.some(t=>t.kind==='STAKE'));assert.ok(entries.some(t=>t.kind==='PAYOUT'));
  assert.throws(()=>act(db,a,s.id,{...c,bets:[{choice:'red',stake:2}]}),{code:'IDEMPOTENCY_CONFLICT'});
  const s2=createGame(db,a,'A1-01',1).session,before=snapshot(db);
  db.exec("CREATE TRIGGER fixture_fail BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.throws(()=>act(db,a,s2.id,{command_id:cmd(),action:'SPIN',bet:1,expected_version:1}),/fixture failure/);assert.deepEqual(snapshot(db),before);good(db);
 }finally{db.close()}
});

test('VAL creation retry prevents a second blackjack initial debit',()=>{
 const {db,a}=fixture();try{const key=cmd(),first=createGame(db,a,'B2',10,key);assert.deepEqual(createGame(db,a,'B2',10,key),first);assert.equal(db.prepare('SELECT COUNT(*) n FROM game_sessions').get().n,1);assert.throws(()=>createGame(db,a,'B2',20,key),{code:'COMMAND_PAYLOAD_MISMATCH'});good(db)}finally{db.close()}
});

test('VAL pagination has stable tie ordering, no duplicates, and enforces receipt/cursor ownership',()=>{
 const {db,a,b}=fixture();try{for(let i=0;i<8;i++)transaction(db,()=>postTransfer(db,{from:accountId(db,a),to:'wa-treasury',amount:1,eventKey:cmd(),reason:'fixture'}));db.exec('UPDATE transfers SET created_ms=100');
  const ids=[];let cursor=null;do{const page=readHistory(db,a,{cursor,limit:2});ids.push(...page.transactions.map(t=>t.id));cursor=page.next_cursor}while(cursor);
  assert.equal(ids.length,9);assert.equal(new Set(ids).size,9);assert.deepEqual(ids,[...ids].sort().reverse());
  assert.throws(()=>readHistory(db,b,{cursor:ids[0]}),{code:'RECEIPT_NOT_FOUND'});assert.throws(()=>readHistory(db,a,{limit:0}),{code:'INVALID_PAGE_SIZE'});good(db);
 }finally{db.close()}
});

test('VAL safety consumes gross stake, rejects resets/new bets, but preserves committed replay and payout',()=>{
 const {db,a}=fixture();try{transaction(db,()=>updateSafety(db,a,{action:'START_SESSION',budget:10}));const s=createGame(db,a,'A1-01',10).session,c={command_id:cmd(),expected_version:1,action:'SPIN',bet:10},first=act(db,a,s.id,c);
  assert.equal(playSafety(db,a).spent,'10');assert.throws(()=>transaction(db,()=>updateSafety(db,a,{action:'START_SESSION',budget:100})),{code:'PLAY_BREAK_REQUIRED'});
  assert.throws(()=>transaction(db,()=>postTransfer(db,{from:accountId(db,a),to:'wa-treasury',amount:1,eventKey:cmd(),reason:'stake'})),{code:'PLAY_BUDGET_REACHED'});
  transaction(db,()=>updateSafety(db,a,{action:'EXCLUDE',days:1}));assert.deepEqual(act(db,a,s.id,c),first);
  assert.throws(()=>createGame(db,a,'B2',1),{code:'SELF_EXCLUDED'});
  transaction(db,()=>postTransfer(db,{from:'wa-treasury',to:accountId(db,a),amount:1,eventKey:cmd(),reason:'committed refund'}));good(db);
 }finally{db.close()}
});

test('VAL multiplayer enforces exclusion on every participant atomically; settled room replays only once',()=>{
 const {db,a,b}=fixture();try{const create={bet:10,command_id:cmd()},r=createRoom(db,a,create).room;assert.throws(()=>createRoom(db,a,{...create,bet:20}),{code:'IDEMPOTENCY_CONFLICT'});
  joinRoom(db,b,r.code,{expected_version:1,command_id:cmd()});roomAction(db,a,r.id,{action:'READY',expected_version:2,command_id:cmd()});roomAction(db,b,r.id,{action:'READY',expected_version:3,command_id:cmd()});
  transaction(db,()=>updateSafety(db,b,{action:'EXCLUDE',days:1}));const before=snapshot(db);assert.throws(()=>roomAction(db,a,r.id,{action:'START',expected_version:4,command_id:cmd()}),{code:'SELF_EXCLUDED'});assert.deepEqual(snapshot(db),before);
  // Advance fixture time, never expose an unblock API.
  db.exec('UPDATE val_play_safety SET excluded_until=0');const c={action:'START',expected_version:4,command_id:cmd()},out=roomAction(db,a,r.id,c);assert.deepEqual(roomAction(db,a,r.id,c),out);assert.throws(()=>roomAction(db,a,r.id,{...c,action:'CANCEL'}),{code:'IDEMPOTENCY_CONFLICT'});good(db);
 }finally{db.close()}
});

test('VAL multiplayer blackjack keeps existing payout obligations after exclusion',()=>{
 const {db,a}=fixture();try{let t=createBlackjackTable(db,a,{bet:1,command_id:cmd()}).table;const action=name=>{t=blackjackTableAction(db,a,t.id,{action:name,expected_version:t.version,command_id:cmd()}).table};action('READY');action('START');transaction(db,()=>updateSafety(db,a,{action:'EXCLUDE',days:1}));while(t.status==='PLAYING')action('STAND');assert.equal(t.status,'FINISHED');assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_reserves').get().n,0);good(db)}finally{db.close()}
});

test('VAL bonus choice preserves sealed payout, reserve and exactly-once ledger',()=>{
 const {db,a}=fixture();try{const s=createGame(db,a,'A1-05',1).session;const grid=Array.from({length:4},()=>['K','Q','J','K','Q','J']);for(let i=0;i<6;i++)grid[0][i]=POT;const state=resolveFusionSpin(initialFusionState(1),grid,1);db.prepare('UPDATE game_sessions SET state_json=? WHERE id=?').run(JSON.stringify(state),s.id);
  const c={command_id:cmd(),expected_version:1,action:'OPEN_POT',choice:2},out=act(db,a,s.id,c);assert.deepEqual(act(db,a,s.id,c),out);assert.equal(wallet(db,a),500+out.session.last_open.payout);good(db);
 }finally{db.close()}
});

test('VAL scheduled roulette refund and lottery payout retain reserve and settle while excluded',()=>{
 const {db,a}=fixture();const old=process.env.LOTTERY_ENABLED;process.env.LOTTERY_ENABLED='true';try{
  const roulette=createRoulette(db,admin,{closes_ms:Date.now()+60000,budget:10000,command_id:cmd()});submitSlip(db,a,roulette.id,{bets:[{choice:'red',stake:10}],command_id:cmd()});
  let l=createLottery(db,admin,{title:'VAL fixture',digits:4,price:10,base_prize:100,max_prize:100,budget:1000,capacity:10,per_player:2,opens_ms:Date.now()-1000,closes_ms:Date.now()+60000,publishes_ms:Date.now()+90000,early_release:true,command_id:cmd()});l=lotteryAdminAction(db,admin,l.id,{action:'OPEN',expected_version:l.version,command_id:cmd()});const seed=db.prepare('SELECT seed FROM draw_commits WHERE round_id=?').get(l.id).seed;buyLotteryTicket(db,a,l.id,{guess:lotteryNumber(seed,l.id,4),command_id:cmd()});
  transaction(db,()=>updateSafety(db,a,{action:'EXCLUDE',days:1}));rouletteAdminAction(db,admin,roulette.id,{action:'CANCEL',expected_version:rouletteView(db,roulette.id).version,command_id:cmd()});
  db.prepare('UPDATE lottery_campaigns SET closes_ms=0,publishes_ms=0 WHERE id=?').run(l.id);sweepLottery(db);const before=snapshot(db);sweepLottery(db);assert.deepEqual(snapshot(db),before);assert.equal(lotteryView(db,l.id).status,'SETTLED');const kinds=readHistory(db,a,{limit:100}).transactions.map(t=>t.kind);assert.ok(kinds.includes('REFUND'));assert.ok(kinds.includes('PAYOUT'));assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_reserves').get().n,0);good(db);
 }finally{if(old===undefined)delete process.env.LOTTERY_ENABLED;else process.env.LOTTERY_ENABLED=old;db.close()}
});
