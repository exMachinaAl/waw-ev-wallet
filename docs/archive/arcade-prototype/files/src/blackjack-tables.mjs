import {bindCommand} from './val/commands.mjs';
import {postTransfer as transfer} from './val/ledger.mjs';
import {policy,checkStake,reserve,releaseReserve,tenantFor} from './stake-policy.mjs';
/** WAE v0.12: persistent 2-4 player blackjack tables, shared dealer and deck.
 * ACR only. All card draws and settlement occur on the server within one SQLite transaction.
 */
import {randomInt} from 'node:crypto';
import {uuid,now,json,parse,assert,fail} from './util.mjs';
import {transaction,accountId,wallet} from './db.mjs';

const LETTERS='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OPEN_MS=2*60*60*1000;
export const TURN_MS=90*1000;
const idCheck=id=>assert(typeof id==='string'&&/^[A-Za-z0-9:_-]{12,100}$/.test(id),400,'INVALID_COMMAND_ID');
const code=()=>Array.from({length:7},()=>LETTERS[randomInt(LETTERS.length)]).join('');
export function blackjackScore(cards){let total=0,aces=0;for(const card of cards){const rank=card.slice(0,-1);if(rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(rank)?10:Number(rank);}while(total>21&&aces){total-=10;aces--;}return total;}
const natural=cards=>cards.length===2&&blackjackScore(cards)===21;
function shuffledDeck(){const deck=[];for(const suit of ['♣','♥','♦','♠'])for(const rank of ['2','3','4','5','6','7','8','9','10','J','Q','K','A'])deck.push(rank+suit);for(let i=deck.length-1;i>0;i--){const j=randomInt(i+1);[deck[i],deck[j]]=[deck[j],deck[i]];}return deck;}

export function setupBlackjackTables(db){db.exec(`
 CREATE TABLE IF NOT EXISTS bj_tables(
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
  host_id TEXT NOT NULL REFERENCES players(id), bet INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN('OPEN','PLAYING','FINISHED','CANCELLED')),
  version INTEGER NOT NULL, state_json TEXT NOT NULL, created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL
 );
 CREATE TABLE IF NOT EXISTS bj_members(
  table_id TEXT NOT NULL REFERENCES bj_tables(id),
  player_id TEXT NOT NULL REFERENCES players(id), seat INTEGER NOT NULL CHECK(seat BETWEEN 1 AND 4),
  ready INTEGER NOT NULL DEFAULT 0, joined_ms INTEGER NOT NULL,
  PRIMARY KEY(table_id,player_id), UNIQUE(table_id,seat)
 );
 CREATE TABLE IF NOT EXISTS bj_commands(
  tenant_id TEXT NOT NULL,player_id TEXT NOT NULL,command_id TEXT NOT NULL,
  table_id TEXT NOT NULL,response_json TEXT NOT NULL,
  PRIMARY KEY(tenant_id,player_id,command_id)
 );
 CREATE INDEX IF NOT EXISTS bj_table_status ON bj_tables(tenant_id,status,created_ms);
 CREATE INDEX IF NOT EXISTS bj_members_player ON bj_members(player_id,table_id);
 `);}
const members=(db,tableId)=>db.prepare('SELECT * FROM bj_members WHERE table_id=? ORDER BY seat').all(tableId);
const lookup=(db,ref)=>db.prepare('SELECT * FROM bj_tables WHERE tenant_id=? AND (id=? OR code=?)').get('wa-world',ref,ref);
function table(db,ref,playerId,memberRequired=true){const t=lookup(db,ref);assert(t,404,'TABLE_NOT_FOUND');if(memberRequired)assert(members(db,t.id).some(m=>m.player_id===playerId),403,'TABLE_ACCESS_DENIED');return t;}
function open(t){assert(t.status==='OPEN',409,'TABLE_NOT_OPEN');assert(t.expires_ms>now(),409,'TABLE_EXPIRED');}
const version=(t,n)=>{assert(Number.isSafeInteger(n),400,'VERSION_REQUIRED');assert(t.version===n,409,'TABLE_STATE_STALE');};
function view(db,t,viewer){
 const m=members(db,t.id);const st=parse(t.state_json),seat=m.find(x=>x.player_id===viewer)?.seat??null;
 const hands=(st.hands??[]).map(h=>({seat:h.seat,cards:t.status==='FINISHED'||h.seat===seat?h.cards:[],
  card_count:h.cards.length,total:t.status==='FINISHED'||h.seat===seat?blackjackScore(h.cards):null,
  done:h.done,outcome:t.status==='FINISHED'?h.outcome:null,payout:t.status==='FINISHED'?h.payout:null}));
 return {id:t.id,code:t.code,game_code:'B2-MP',bet:t.bet,status:t.status==='OPEN'&&t.expires_ms<=now()?'EXPIRED':t.status,
  version:t.version,capacity:4,player_count:m.length,is_member:seat!==null,is_host:t.host_id===viewer,my_seat:seat,
  members:m.map(x=>({seat:x.seat,is_me:x.player_id===viewer,ready:!!x.ready})),
  phase:st.phase,turn_seat:st.turn_seat??null,turn_deadline_ms:st.turn_deadline_ms??null,
  dealer:st.dealer?(t.status==='FINISHED'?st.dealer:[st.dealer[0],'🂠']):[],
  dealer_total:t.status==='FINISHED'&&st.dealer?blackjackScore(st.dealer):null,
  hands,rule:'1–4 players vs dealer; stands on all 17; natural gross return floor(stake × 5/2); active leave = forfeit, no refund',
  expires_ms:t.expires_ms};
}
const response=(db,t,p)=>({table:view(db,t,p),balance:wallet(db,p)});
function stored(db,player,cmd,tableId){const prev=db.prepare('SELECT table_id,response_json FROM bj_commands WHERE tenant_id=? AND player_id=? AND command_id=?').get('wa-world',player,cmd);if(!prev)return null;assert(prev.table_id===tableId,409,'COMMAND_REUSED_FOR_OTHER_TABLE');return parse(prev.response_json);}
function remember(db,player,cmd,t,result){db.prepare('INSERT INTO bj_commands VALUES(?,?,?,?,?)').run('wa-world',player,cmd,t.id,json(result));return result;}
function stamp(db,t,state,status=t.status){
 const n=t.version+1;const r=db.prepare('UPDATE bj_tables SET version=?,state_json=?,status=?,updated_ms=? WHERE id=? AND version=?').run(n,json(state),status,now(),t.id,t.version);
 assert(r.changes===1,409,'TABLE_STATE_STALE');return lookup(db,t.id);
}
export function createBlackjackTable(db,p,{bet=10,command_id}={}){
 idCheck(command_id);tenantFor(db,p);checkStake(bet,policy(db,'B2-MP'));
 return transaction(db,()=>{
  bindCommand(db,p,command_id,{operation:'blackjack.create',bet});
  const prior=db.prepare('SELECT table_id,response_json FROM bj_commands WHERE tenant_id=? AND player_id=? AND command_id=?').get('wa-world',p,command_id);
  if(prior)return parse(prior.response_json);
  assert(db.prepare("SELECT COUNT(*) n FROM bj_tables WHERE host_id=? AND status='OPEN' AND expires_ms>?").get(p,now()).n<3,429,'TABLE_LIMIT');
  const id=uuid(),stampMs=now();let invite=null;for(let i=0;i<12;i++){const next=code();if(!lookup(db,next)){invite=next;break;}}
  assert(invite,500,'ROOM_CODE_EXHAUSTED');
  db.prepare('INSERT INTO bj_tables VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'wa-world',invite,p,bet,'OPEN',1,json({phase:'WAITING',stake_policy:policy(db,'B2-MP')}),stampMs,stampMs,stampMs+OPEN_MS);
  db.prepare('INSERT INTO bj_members VALUES(?,?,?,?,?)').run(id,p,1,0,stampMs);
  return remember(db,p,command_id,lookup(db,id),response(db,lookup(db,id),p));
 });
}
export const blackjackTablePreview=(db,p,ref)=>{const t=table(db,ref,p,false);open(t);return {table:view(db,t,p)};};
export const blackjackTableInfo=(db,p,ref)=>response(db,table(db,ref,p),p);
export const blackjackPublicTables=(db,p)=>db.prepare("SELECT * FROM bj_tables WHERE tenant_id='wa-world' AND status='OPEN' AND expires_ms>? ORDER BY created_ms DESC LIMIT 25").all(now()).map(t=>view(db,t,p));
export const blackjackMyTables=(db,p)=>db.prepare('SELECT t.* FROM bj_tables t JOIN bj_members m ON m.table_id=t.id WHERE m.player_id=? ORDER BY t.updated_ms DESC LIMIT 30').all(p).map(t=>view(db,t,p));
export function joinBlackjackTable(db,p,ref,{expected_version,command_id}={}){
 idCheck(command_id);
 return transaction(db,()=>{
  bindCommand(db,p,command_id,{operation:'blackjack.join',ref,expected_version});
  const t=table(db,ref,p,false),prior=stored(db,p,command_id,t.id);if(prior)return prior;
  open(t);version(t,expected_version);
  const m=members(db,t.id);assert(!m.some(x=>x.player_id===p),409,'ALREADY_JOINED');assert(m.length<4,409,'TABLE_FULL');
  const seat=[1,2,3,4].find(s=>!m.some(x=>x.seat===s));
  db.prepare('INSERT INTO bj_members VALUES(?,?,?,?,?)').run(t.id,p,seat,0,now());
  const changed=stamp(db,t,parse(t.state_json));return remember(db,p,command_id,changed,response(db,changed,p));
 });
}
function nextTurn(hands,currentSeat){return hands.find(h=>h.seat>currentSeat&&!h.done)?.seat??null;}
function finish(db,t,state){
 // A single dealer hand shared by all players. Bust players cannot receive rewards.
 releaseReserve(db,`bj:${t.id}`);
 if(state.hands.some(h=>!h.done))fail(500,'UNSETTLED_HAND');
 if(!natural(state.dealer)&&state.hands.some(h=>blackjackScore(h.cards)<=21)){
  while(blackjackScore(state.dealer)<17)state.dealer.push(state.deck.pop());
 }
 const dealer=blackjackScore(state.dealer),dealerNatural=natural(state.dealer);
 for(const h of state.hands){
  const total=blackjackScore(h.cards);let payout=0,outcome='LOSE';
  if(h.forfeit)outcome='FORFEIT';
  else if(total>21)outcome='BUST';
  else if(natural(h.cards)&&!dealerNatural){outcome='BLACKJACK';payout=Math.floor(t.bet*5/2);}
  else if(dealerNatural&&!natural(h.cards)){outcome='LOSE';}
  else if((natural(h.cards)&&dealerNatural)||total===dealer){outcome='PUSH';payout=t.bet;}
  else if(dealer>21||total>dealer){outcome='WIN';payout=t.bet*2;}
  h.outcome=outcome;h.payout=payout;
  if(payout)transfer(db,{from:'wa-treasury',to:accountId(db,h.player_id),amount:payout,eventKey:`bj:${t.id}:seat:${h.seat}:payout`,reason:'Multiplayer Blackjack payout'});
 }
 state.phase='FINISHED';state.turn_seat=null;state.turn_deadline_ms=null;
 return stamp(db,t,state,'FINISHED');
}
function start(db,t,m){
 assert(m.length>=1&&m.length<=4&&m.every(x=>x.ready),409,'NOT_READY');
 reserve(db,`bj:${t.id}`,m.length*Math.floor(t.bet*5/2));
 for(const member of m)assert(wallet(db,member.player_id)>=t.bet,409,'INSUFFICIENT_ACR');
 const deck=shuffledDeck(),hands=m.map(x=>({seat:x.seat,player_id:x.player_id,cards:[deck.pop()],done:false,payout:null,outcome:null}));
 const dealer=[deck.pop()];for(const h of hands)h.cards.push(deck.pop());dealer.push(deck.pop());
 for(const member of m)transfer(db,{from:accountId(db,member.player_id),to:'wa-treasury',amount:t.bet,eventKey:`bj:${t.id}:seat:${member.seat}:stake`,reason:'Multiplayer Blackjack entry'});
 const dealerNatural=natural(dealer);
 for(const h of hands)h.done=dealerNatural||natural(h.cards);
 const first=hands.find(h=>!h.done)?.seat??null;
 const state={phase:'PLAYING',stake_policy:parse(t.state_json).stake_policy,dealer,deck,hands,turn_seat:first,turn_deadline_ms:first?now()+TURN_MS:null};
 return first===null?finish(db,t,state):stamp(db,t,state,'PLAYING');
}
export function blackjackTableAction(db,p,ref,{action,expected_version,command_id,confirm_forfeit=false}={}){
 idCheck(command_id);
 return transaction(db,()=>{
  bindCommand(db,p,command_id,{operation:'blackjack.action',ref,action,expected_version,confirm_forfeit});
  const t=table(db,ref,p,false),prior=stored(db,p,command_id,t.id);if(prior)return prior;
  // Only actual members can mutate or perform timeout processing.
  const m=members(db,t.id),mine=m.find(x=>x.player_id===p);assert(mine,403,'TABLE_ACCESS_DENIED');
  version(t,expected_version);const st=parse(t.state_json);
  let changed;
  if(action==='CANCEL'&&t.status==='PLAYING')fail(409,'CANNOT_CANCEL_ACTIVE');
  if(action==='START'&&t.status!=='OPEN')fail(409,'ALREADY_STARTED');
  if(action==='LEAVE'&&t.status==='PLAYING'){
   assert(confirm_forfeit===true,409,'CONFIRM_FORFEIT_REQUIRED');
   const hand=st.hands.find(h=>h.player_id===p);assert(hand&&!hand.done,409,'HAND_ALREADY_DONE');hand.done=true;hand.forfeit=true;
   if(st.turn_seat===hand.seat){st.turn_seat=st.hands.find(h=>!h.done)?.seat??null;st.turn_deadline_ms=st.turn_seat?now()+TURN_MS:null;}
   changed=st.hands.every(h=>h.done)?finish(db,t,st):stamp(db,t,st);
  }else if(['READY','LEAVE','CANCEL','START'].includes(action)){
   if(['LEAVE','CANCEL'].includes(action))assert(t.status==='OPEN',409,'TABLE_NOT_OPEN');else open(t);
   if(action==='READY'){
    db.prepare('UPDATE bj_members SET ready=1 WHERE table_id=? AND player_id=?').run(t.id,p);changed=stamp(db,t,st);
   }else if(action==='LEAVE'){
    if(t.host_id===p){const successor=m.find(x=>x.player_id!==p);if(successor)db.prepare('UPDATE bj_tables SET host_id=? WHERE id=?').run(successor.player_id,t.id);else{changed=stamp(db,t,{phase:'CANCELLED'},'CANCELLED');return remember(db,p,command_id,changed,response(db,changed,p));}}
    db.prepare('DELETE FROM bj_members WHERE table_id=? AND player_id=?').run(t.id,p);
    db.prepare('UPDATE bj_members SET ready=0 WHERE table_id=?').run(t.id);changed=stamp(db,t,st);
   }else if(action==='CANCEL'){
    assert(t.host_id===p,403,'HOST_ONLY');changed=stamp(db,t,{phase:'CANCELLED'},'CANCELLED');
   }else{
    assert(t.host_id===p,403,'HOST_ONLY');changed=start(db,t,m);
   }
  }else if(['HIT','STAND','TIMEOUT'].includes(action)){
   assert(t.status==='PLAYING',409,'TABLE_NOT_PLAYING');const current=st.hands.find(h=>h.seat===st.turn_seat);
   assert(current,500,'TURN_INVARIANT');
   if(action==='TIMEOUT')assert(now()>=st.turn_deadline_ms,409,'TURN_NOT_EXPIRED');
   else {assert(current.player_id===p,403,'NOT_YOUR_TURN');assert(now()<st.turn_deadline_ms,409,'TURN_EXPIRED');}
   if(action==='HIT'){current.cards.push(st.deck.pop());if(blackjackScore(current.cards)>=21)current.done=true;}
   else current.done=true; // Timeout is a safe auto-stand; no extra stake.
   if(current.done){const next=nextTurn(st.hands,current.seat);if(next){st.turn_seat=next;st.turn_deadline_ms=now()+TURN_MS;}else {st.turn_seat=null;st.turn_deadline_ms=null;}}
   changed=st.turn_seat===null?finish(db,t,st):stamp(db,t,st);
  }else fail(400,'INVALID_TABLE_ACTION');
  return remember(db,p,command_id,changed,response(db,changed,p));
 });
}
export function sweepBlackjackTimeouts(db){
 transaction(db,()=>{for(const t of db.prepare("SELECT * FROM bj_tables WHERE status='OPEN' AND expires_ms<=?").all(now()))stamp(db,t,{phase:'CANCELLED',reason:'TABLE_EXPIRED'},'CANCELLED');});
 const expired=db.prepare("SELECT id,state_json FROM bj_tables WHERE status='PLAYING' ORDER BY updated_ms LIMIT 100").all();let processed=0;
 for(const row of expired){const st=parse(row.state_json);if(!st.turn_deadline_ms||st.turn_deadline_ms>now())continue;
  const t=lookup(db,row.id),m=members(db,t.id),actor=m[0]?.player_id;
  if(!actor)continue;
  try{blackjackTableAction(db,actor,t.id,{action:'TIMEOUT',expected_version:t.version,command_id:`bj:sweep:${t.id}:${t.version}`});processed++;}catch(error){if(!['TABLE_STATE_STALE','TURN_NOT_EXPIRED'].includes(error.code))throw error;}
 }
 return processed;
}
