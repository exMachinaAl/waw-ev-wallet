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
import {createGame,act,getSession} from '../.local/arcade/src/games.mjs';
import {reserve} from '../.local/arcade/src/stake-policy.mjs';
import {setupRooms,createRoom,joinRoom,roomAction} from '../.local/arcade/src/rooms.mjs';
import {setupBlackjackTables,createBlackjackTable,blackjackTableAction} from '../.local/arcade/src/blackjack-tables.mjs';
import {initialFusionState,resolveFusionSpin,POT,SYMBOLS} from '../.local/arcade/src/ultimate-fusion.mjs';
import {createRoulette,submitSlip,rouletteAdminAction,rouletteView} from '../.local/arcade/src/roulette-rounds.mjs';
import {createLottery,lotteryAdminAction,buyLotteryTicket,lotteryView,lotteryNumber,sweepLottery} from '../.local/arcade/src/lottery.mjs';
import {createApp as createArcade} from '../.local/arcade/src/server.mjs';
import {createWorldArcadeAdapter} from '../.local/arcade/integrations/wa-world/adapter.mjs';
import {createWalletApp,connectArcadeDatabase} from '../src/server.mjs';
import {digest,token,uuid,now} from '../src/util.mjs';
const cmd=()=>randomUUID(),admin={id:'val-fixture-admin',role:'ADMIN'};
function fixture(file){const db=openDb(file);setupRooms(db);setupBlackjackTables(db);const a=transaction(db,()=>ensurePlayer(db,'val-alice')),b=transaction(db,()=>ensurePlayer(db,'val-bob'));return {db,a,b};}
function good(db){const report=reconcileVal(db);assert.equal(report.ok,true,JSON.stringify(report.errors));assert.deepEqual(new Set(report.accounts.map(a=>a.kind)),new Set(['PLAYER','TREASURY','FAUCET']));}
function legacy(db){for(const t of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'val_%'").all())db.exec(`DROP TRIGGER ${t.name}`);for(const table of ['val_openings','val_scope','val_commands','val_play_safety'])db.exec(`DROP TABLE ${table}`);db.prepare('DELETE FROM schema_migrations WHERE version=?').run('val-arcade-1');}
function snapshot(db){return Object.fromEntries(['accounts','transfers','entries','game_sessions','game_actions','treasury_reserves','browser_sessions','outbox'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));}

test('Independent HTTP apps share one file ledger; wallet exclusion blocks WA without cancelling replay',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'val-two-apps-')),file=path.join(directory,'fixture.sqlite'),key='val-two-apps-service-fixture-key-12345';let arcade,walletApp;
 try{
  arcade=createArcade({database:file,demo:true,serviceKey:key});await new Promise(r=>arcade.server.listen(0,'127.0.0.1',r));const arcadeUrl=`http://127.0.0.1:${arcade.server.address().port}`;
  const subject='val-channel-fixture@s.whatsapp.net',player=transaction(arcade.db,()=>ensurePlayer(arcade.db,subject)),secret=token();arcade.db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?,?,?,?,?)').run(uuid(),'wa-world',player,digest(secret),now(),now()+3600000,null,'Two app fixture');
  walletApp=createWalletApp({db:connectArcadeDatabase(file),demo:false,arcadeUrl});await new Promise(r=>walletApp.server.listen(0,'127.0.0.1',r));const walletUrl=`http://127.0.0.1:${walletApp.server.address().port}`;
  const cookie='wae_session='+secret,adapter=createWorldArcadeAdapter({apiUrl:arcadeUrl,serviceKey:key}),send=(text,id)=>adapter.handle({senderJid:subject,text,isGroup:false,messageId:'val-two-apps-'+id});
  const created=await send('.wae slot 1','create');assert.match(created,/A1-01/);assert.equal(await send('.wae slot 1','create'),created);assert.equal(arcade.db.prepare('SELECT COUNT(*) n FROM game_sessions').get().n,1);
  const played=await send('.wae spin classic','spin');assert.match(played,/A1-01/);const result=await fetch(walletUrl+'/api/val/v1/snapshot',{headers:{Cookie:cookie}});assert.equal(result.status,200);const snap=await result.json();assert.equal(snap.wallet.available,String(wallet(arcade.db,player)));assert.ok(snap.transactions.some(t=>t.kind==='STAKE'));
  const before=snapshot(arcade.db),block=await fetch(walletUrl+'/api/val/v1/play-safety',{method:'POST',headers:{Origin:walletUrl,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'EXCLUDE',days:1})});assert.equal(block.status,200);await block.json();
  assert.equal(await send('.wae spin classic','spin'),played);assert.match(await send('.wae spin classic','blocked'),/SELF_EXCLUDED/);assert.deepEqual(snapshot(arcade.db),before);good(arcade.db);good(walletApp.db);
 }finally{await walletApp?.close();await arcade?.close();rmSync(directory,{recursive:true,force:true})}
});

test('VAL migration preserves IDs, amounts, sessions, opening balances and reserves; second migration is a no-op',()=>{
 const {db,a}=fixture();try{
  const s=createGame(db,a,'A1-01',1).session;act(db,a,s.id,{command_id:cmd(),action:'SPIN',expected_version:1,bet:1});
  transaction(db,()=>reserve(db,'fixture-liability',200));legacy(db);const before=snapshot(db);
  assert.equal(migrateVal(db).applied,true);assert.deepEqual(snapshot(db),before);assert.equal(migrateVal(db).applied,false);assert.deepEqual(snapshot(db),before);
  const openings=reconcileVal(db).accounts;assert.equal(openings.find(a=>a.kind==='TREASURY').opening,'800000');assert.equal(openings.find(a=>a.kind==='FAUCET').opening,'2000000');good(db);
  const old=db.prepare('SELECT command_id FROM game_actions LIMIT 1').get();assert.throws(()=>act(db,a,s.id,{command_id:old.command_id,action:'SPIN',expected_version:1,bet:2}),{code:'LEGACY_COMMAND_UNVERIFIABLE'});
 }finally{db.close()}
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
 const {db,a}=fixture();try{const s=createGame(db,a,'A1-05',1).session;const grid=Array.from({length:4},()=>Array(6).fill(SYMBOLS[0]));for(let i=0;i<6;i++)grid[0][i]=POT;const state=resolveFusionSpin(initialFusionState(1),grid,1);db.prepare('UPDATE game_sessions SET state_json=? WHERE id=?').run(JSON.stringify(state),s.id);
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
