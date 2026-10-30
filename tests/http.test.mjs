import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletApp} from '../src/server.mjs';
import {transaction,ensurePlayer,accountId} from '../src/db.mjs';
import {digest,token,uuid,now} from '../src/util.mjs';
import {postTransfer} from '../src/val/ledger.mjs';
import {reconcileVal} from '../src/val/schema.mjs';

async function fixture(options){const app=createWalletApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
 async function call(method,route,body,cookie='',headers={}){const res=await fetch(origin+route,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};}
 return {app,origin,call};
}
function secondSession(db){return transaction(db,()=>{const player=ensurePlayer(db,'http-second','demo'),secret=token();db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?,?,?,?,?)').run(uuid(),'wa-world',player,digest(secret),now(),now()+3600000,null,'Fixture B');return {player,cookie:'wae_session='+secret}})}

test('HTTP wallet requires auth, derives owner and pocket from session, and exposes no debit/payout API',async()=>{
 const {app,call}=await fixture();try{
  assert.equal((await call('GET','/api/val/v1/wallets')).status,401);
  const login=await call('POST','/api/demo-login',{});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const cookie=login.cookie,me=(await call('GET','/api/me',undefined,cookie)).data,other=secondSession(app.db);
  const snap=await call('GET',`/api/val/v1/snapshot?player_id=${other.player}&tenant_id=other&pocket=world`,undefined,cookie);assert.equal(snap.status,200);assert.deepEqual(snap.data.wallet,{currency:'VAL',pocket:'arcade',app_id:'world-arcade',posted:'500',held:'0',available:'500',legacy_currency:'ACR'});
  const id=snap.data.transactions[0].id;assert.equal((await call('GET',`/api/val/v1/transactions/${id}`,undefined,cookie)).status,200);assert.equal((await call('GET',`/api/val/v1/transactions/${id}`,undefined,other.cookie)).status,404);assert.equal((await call('GET',`/api/val/v1/transactions?cursor=${id}`,undefined,other.cookie)).status,404);
  for(const endpoint of ['payout','debit','transfers','lab/grants','payment-intents'])assert.equal((await call('POST','/api/val/v1/'+endpoint,{player_id:me.id,amount:'1000000',pocket:'world'},cookie)).status,404);
  assert.equal((await call('GET','/api/val/v1/snapshot',undefined,cookie)).data.wallet.available,'500');assert.equal(reconcileVal(app.db).ok,true);
 }finally{await app.close()}
});

test('HTTP refresh snapshot and paginated history reflect server commits; receipt has posted-only net',async()=>{
 const {app,call}=await fixture();try{const cookie=(await call('POST','/api/demo-login',{})).cookie,player=(await call('GET','/api/me',undefined,cookie)).data.id;
  transaction(app.db,()=>{postTransfer(app.db,{from:accountId(app.db,player),to:'wa-treasury',amount:10,eventKey:'action:http-fixture:stake',reason:'test stake'});postTransfer(app.db,{from:'wa-treasury',to:accountId(app.db,player),amount:4,eventKey:'action:http-fixture:payout',reason:'test payout'})});
  const snapshot=(await call('GET','/api/val/v1/snapshot?limit=1',undefined,cookie)).data;assert.equal(snapshot.wallet.available,'494');assert.equal(snapshot.transactions.length,1);assert.ok(snapshot.next_cursor);
  const receipt=(await call('GET','/api/val/v1/transactions/'+snapshot.transactions[0].id,undefined,cookie)).data.receipt;assert.deepEqual(receipt.summary,{stake:'10',payout:'4',net_posted:'-6',basis:'POSTED_ENTRIES_ONLY'});
  const next=(await call('GET','/api/val/v1/transactions?cursor='+snapshot.next_cursor+'&limit=1',undefined,cookie)).data;assert.notEqual(next.transactions[0].id,snapshot.transactions[0].id);
  assert.equal((await call('GET','/api/val/v1/transactions?limit=101',undefined,cookie)).status,400);assert.equal((await call('GET','/api/val/v1/transactions?cursor=bad',undefined,cookie)).status,400);
 }finally{await app.close()}
});

test('HTTP CSRF, logout/revocation, and self-exclusion do not affect another identity',async()=>{
 const {app,call,origin}=await fixture();try{const cookie=(await call('POST','/api/demo-login',{})).cookie,other=secondSession(app.db);
  assert.equal((await call('POST','/api/val/v1/play-safety',{action:'EXCLUDE',days:1},cookie,{Origin:'https://untrusted.invalid'})).status,403);
  const absent=await fetch(origin+'/api/val/v1/play-safety',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(absent.status,403);await absent.text();
  const block=await call('POST','/api/val/v1/play-safety',{action:'EXCLUDE',days:1,player_id:other.player},cookie);assert.equal(block.status,200);assert.ok(block.data.excluded_until>Date.now());assert.equal((await call('GET','/api/val/v1/play-safety',undefined,other.cookie)).data.excluded_until,0);
  assert.equal((await call('POST','/api/val/v1/play-safety',{action:'UNBLOCK'},cookie)).status,400);
  assert.equal((await call('POST','/api/logout',{},cookie)).status,200);assert.equal((await call('GET','/api/val/v1/snapshot',undefined,cookie)).status,401);assert.equal((await call('GET','/api/val/v1/snapshot',undefined,other.cookie)).status,200);
 }finally{await app.close()}
});

test('HTTP connected mode never grants demo credits; forwarded local login is refused',async()=>{
 const connected=await fixture({demo:false});try{assert.equal((await connected.call('POST','/api/demo-login',{})).status,403);assert.equal(connected.app.db.prepare('SELECT COUNT(*) n FROM players').get().n,0)}finally{await connected.app.close()}
 const local=await fixture();try{for(const name of ['x-forwarded-for','x-forwarded-host','forwarded'])assert.equal((await local.call('POST','/api/demo-login',{},'',{[name]:'external'})).status,403);assert.equal(local.app.db.prepare('SELECT COUNT(*) n FROM players').get().n,0)}finally{await local.app.close()}
});
