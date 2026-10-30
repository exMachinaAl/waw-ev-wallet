import {bindCommand} from './val/commands.mjs';
import {postTransfer as transfer} from './val/ledger.mjs';
import {policy,checkStake,reserve,releaseReserve,tenantFor,once} from './stake-policy.mjs';
import {normalizeSlip,roulettePayout,rouletteColor} from './roulette-rounds.mjs';
import {randomInt} from 'node:crypto';
import {runNumberDraw,drawQuota,DRAW_POLICY} from './number-draw.mjs';
import {evaluateBidirectionalLines} from './slot-rules.mjs';
import {uuid,now,json,parse,assert,fail} from './util.mjs';
import {transaction,wallet,accountId} from './db.mjs';
import {generateGrid,resolveScatterSpin} from './scatter-rush.mjs';
import {initialPotState,generatePotGrid,resolvePotSpin,resolvePotChoice,publicPotState} from './mystery-guci.mjs';
import {generateBlastGrid,resolveBlastSpin} from './column-blast.mjs';
import {generateFusionGrid,initialFusionState,resolveFusionSpin,resolveFusionChoice,publicFusionState} from './ultimate-fusion.mjs';
const GAMES={
 'T0':{name:'Dice Duel · Multiplayer Room',description:'2 pemain, siap bersama, satu lemparan dadu server dan settlement ACR atomik; gunakan Lobby Room API'},
 'A1-01':{name:'Classic Match 3x3',description:'3 horizontal rows, 3+ matching symbols from either left or right; deduplicated payouts'},
 'A1-02':{name:'Scatter Rush 6x4',description:'6x4, bidirectional paylines, 3+ Scatter columns, top-row A x4 blasts, B complements ordinary lines; 50 total bonus cap'},
 'A1-03':{name:'Mystery Guci 5x3',description:'3 progress pots, win lines from either side, committed hidden choices and ACR virtual rewards'},
 'A1-04':{name:'Column Blast 5x4',description:'4+ A symbols on top row blast entire columns downward; B complements ordinary lines only'},
 'A1-05':{name:'Ultimate Fusion 6x4',description:'Two-way paylines + 50 free spins + 4 top-row A blast + B helper + sealed Guci choices'},
 'B1':{name:'European Roulette',description:'European 0-36, red/black/odd/even/number'},
 'B2':{name:'Blackjack Solo',description:'Dealer vs player, hit/stand'},
 'L1':{name:'Lottery Exclusive',description:'Scheduled shared draws; use /api/v1/lottery. Legacy history retained.'}
};
const SYMBOLS=['🍒','🍋','🔔','⭐','7️⃣'];
const PAY=[2,3,4,5,8];
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export function games(){return Object.entries(GAMES).map(([code,g])=>({code,...g,category:code.startsWith('A1-')?'slot':code==='L1'?'lottery':code==='T0'?'multiplayer':'arcade',status:'BETA'}));}
function playerSession(db,sessionId,playerId){
 const r=db.prepare('SELECT * FROM game_sessions WHERE id=? AND player_id=?').get(sessionId,playerId);
 assert(r,404,'SESSION_NOT_FOUND');return r;
}
function project(r){
 const state=parse(r.state_json);const publicState=r.game_code==='A1-03'?publicPotState(state):r.game_code==='A1-05'?publicFusionState(state):{...state};
 // Dealer hole card and deck must never leak through APIs/SSE/WA.
 if(r.game_code==='B2'&&state.phase==='PLAYER_TURN'){
   delete publicState.deck;
   publicState.dealer=[state.dealer[0],'🂠'];
 } else if(r.game_code==='B2')delete publicState.deck;
 delete publicState.reserve_key;
 return {...publicState,id:r.id,game_code:r.game_code,version:r.version};
}
export function getSession(db,id,playerId){return project(playerSession(db,id,playerId));}
export function sessionsFor(db,playerId){return db.prepare('SELECT id,game_code,version,updated_ms FROM game_sessions WHERE player_id=? ORDER BY updated_ms DESC LIMIT 30').all(playerId);}
function checkBet(bet,p){checkStake(bet,p);}
function shuffledDeck(){const d=[];for(const suit of ['♣','♦','♥','♠'])for(const r of ['2','3','4','5','6','7','8','9','10','J','Q','K','A'])d.push(`${r}${suit}`);for(let i=d.length-1;i>0;i--){const j=randomInt(i+1);[d[i],d[j]]=[d[j],d[i]];}return d;}
function score(hand){let n=0,aces=0;for(const card of hand){const r=card.slice(0,-1);if(r==='A'){n+=11;aces++;}else n+=['J','Q','K'].includes(r)?10:Number(r);}while(n>21&&aces){n-=10;aces--;}return n;}
const natural=h=>h.length===2&&score(h)===21;
function debit(db,pid,bet,eventKey){transfer(db,{from:accountId(db,pid),to:'wa-treasury',amount:bet,eventKey,reason:'ACR arcade play'});}
function credit(db,pid,amount,eventKey){if(amount>0)transfer(db,{from:'wa-treasury',to:accountId(db,pid),amount,eventKey,reason:'ACR arcade payout'});}
function blackjackDeal(db,pid,state,bet,eventKey){
 debit(db,pid,bet,`${eventKey}:stake`);
 const deck=shuffledDeck(),player=[deck.pop(),deck.pop()],dealer=[deck.pop(),deck.pop()];
 Object.assign(state,{bet,player,dealer,deck,phase:'PLAYER_TURN',outcome:null,payout:0});
 if(natural(player)||natural(dealer))settleBlackjack(db,pid,state,`${eventKey}:payout`);
 state.player_total=score(state.player);state.dealer_total=state.phase==='FINISHED'?score(state.dealer):null;
}
function settleBlackjack(db,pid,state,eventKey){
 const p=score(state.player),d=score(state.dealer);
 let outcome='LOSE',payout=0;
 if(p>21){outcome='BUST';}
 else if(natural(state.player)&&!natural(state.dealer)){outcome='BLACKJACK';payout=Math.floor(state.bet*5/2);}
 else if(natural(state.dealer)&&!natural(state.player)){outcome='LOSE';}
 else if((natural(state.player)&&natural(state.dealer))||p===d){outcome='PUSH';payout=state.bet;}
 else if(d>21||p>d){outcome='WIN';payout=state.bet*2;}
 if(!Number.isSafeInteger(payout))fail(500,'INVALID_PAYOUT');
 if(state.reserve_key)releaseReserve(db,state.reserve_key);
 credit(db,pid,payout,eventKey);
 state.phase='FINISHED';state.outcome=outcome;state.payout=payout;
}
export function createGame(db,playerId,gameCode,bet=10,commandId=null){
 tenantFor(db,playerId);
 assert(GAMES[gameCode],404,'UNKNOWN_GAME');assert(gameCode!=='T0',400,'USE_MULTIPLAYER_LOBBY');
 if(gameCode==='L1')fail(410,'LOTTERY_USE_ROUNDS_API');else checkBet(bet,policy(db,gameCode));
 const create=()=>{
  const id=uuid(),state={phase:'READY',last:null,bet,stake_policy:policy(db,gameCode)};
  if(gameCode==='L1')Object.assign(state,{phase:'READY',bet:0,quota:drawQuota(db,playerId),last:null});
  if(gameCode==='A1-03')Object.assign(state,initialPotState(bet));
  if(gameCode==='A1-05')Object.assign(state,initialFusionState(bet));
  if(gameCode==='B2'){state.reserve_key=`solo:${id}`;reserve(db,state.reserve_key,Math.floor(bet*5/2));}
  if(gameCode==='B2')blackjackDeal(db,playerId,state,bet,`game:${id}:start`);
  db.prepare('INSERT INTO game_sessions VALUES(?,?,?,?,?,?,?,?)').run(id,'wa-world',playerId,gameCode,1,json(state),now(),now());
  if(gameCode==='B2'&&state.phase==='FINISHED')releaseReserve(db,`solo:${id}`);
  const session=getSession(db,id,playerId);
  addEvent(db,playerId,session,'game.created');return {session,balance:wallet(db,playerId)};
 };
 return commandId?once(db,playerId,commandId,{operation:'game.create',gameCode,bet},create):transaction(db,create);
}
function addEvent(db,playerId,s,eventType){db.prepare('INSERT INTO outbox(tenant_id,player_id,session_id,event_type,version,payload_json,created_ms) VALUES(?,?,?,?,?,?,?)').run('wa-world',playerId,s.id,eventType,s.version,json({sessionId:s.id,version:s.version}),now());}
function perform(db,pid,record,command){
 const state=parse(record.state_json),action=command.action,bet=command.bet??state.bet;
 const frozen=state.phase==='BONUS'||state.phase==='POT_CHOICE'||state.phase==='PLAYER_TURN';
 const pol=frozen?(state.stake_policy??policy(db,record.game_code)):policy(db,record.game_code);
 if(!frozen)state.stake_policy=pol;
 if(record.game_code==='L1'){
  fail(410,'LOTTERY_USE_ROUNDS_API');
 }else if(record.game_code==='A1-01'){
  assert(action==='SPIN',400,'INVALID_ACTION');checkBet(bet,pol);
  debit(db,pid,bet,`action:${command.command_id}:stake`);
  const grid=Array.from({length:3},()=>Array.from({length:3},()=>randomInt(SYMBOLS.length)));
  const displayGrid=grid.map(r=>r.map(i=>SYMBOLS[i]));
  const {lines:matches,payout}=evaluateBidirectionalLines(displayGrid,bet,Object.fromEntries(SYMBOLS.map((symbol,i)=>[symbol,PAY[i]])));
  credit(db,pid,payout,`action:${command.command_id}:payout`);
  Object.assign(state,{phase:'READY',bet,last:{grid:displayGrid,matches,payout,net:payout-bet}});
 }else if(record.game_code==='A1-02'){
  assert(action==='SPIN',400,'INVALID_ACTION');checkBet(bet,pol);
  const free=state.phase==='BONUS'&&state.bonus?.remaining>0;
  if(free)assert(bet===state.bet,409,'BET_LOCKED_DURING_BONUS');
  if(!free)debit(db,pid,bet,`action:${command.command_id}:stake`);
  const next=resolveScatterSpin(state,generateGrid(),bet);
  credit(db,pid,next.last.payout,`action:${command.command_id}:payout`);
  Object.assign(state,next);
 }else if(record.game_code==='A1-03'){
  if(action==='SPIN'){
   checkBet(bet,pol);assert(state.phase==='READY',409,'POT_CHOICE_REQUIRED');
   debit(db,pid,bet,`action:${command.command_id}:stake`);
   const next=resolvePotSpin(state,generatePotGrid(),bet);
   credit(db,pid,next.last.payout,`action:${command.command_id}:payout`);
   Object.assign(state,next);
  } else if(action==='OPEN_POT'){
   const next=resolvePotChoice(state,command.choice);
   credit(db,pid,next.last_open.payout,`action:${command.command_id}:pot-reward`);
   Object.assign(state,next);
  } else fail(400,'INVALID_ACTION');
 }else if(record.game_code==='A1-04'){
  assert(action==='SPIN',400,'INVALID_ACTION');checkBet(bet,pol);
  debit(db,pid,bet,`action:${command.command_id}:stake`);
  const next=resolveBlastSpin(state,generateBlastGrid(),bet);
  credit(db,pid,next.last.payout,`action:${command.command_id}:payout`);
  Object.assign(state,next);
 }else if(record.game_code==='A1-05'){
  if(action==='SPIN'){
   checkBet(bet,pol);assert(state.phase!=='POT_CHOICE',409,'FUSION_POT_CHOICE_REQUIRED');
   const free=state.phase==='BONUS'&&state.bonus?.remaining>0;
   if(free)assert(bet===state.bet,409,'BET_LOCKED_DURING_BONUS');
   if(!free)debit(db,pid,bet,`action:${command.command_id}:stake`);
   const next=resolveFusionSpin(state,generateFusionGrid(),bet);
   credit(db,pid,next.last.payout,`action:${command.command_id}:payout`);
   Object.assign(state,next);
  }else if(action==='OPEN_POT'){
   const next=resolveFusionChoice(state,command.choice);
   credit(db,pid,next.last_open.payout,`action:${command.command_id}:pot-reward`);
   Object.assign(state,next);
  }else fail(400,'INVALID_ACTION');
 }else if(record.game_code==='B1'){
  assert(action==='SPIN',400,'INVALID_ACTION');
  const slip=normalizeSlip(command.bets??[{choice:String(command.choice??'').toLowerCase(),stake:bet}],pol);
  reserve(db,`spin:${command.command_id}`,slip.exposure);
  debit(db,pid,slip.total,`action:${command.command_id}:stake`);
  const n=randomInt(37),payout=roulettePayout(slip.bets,n);releaseReserve(db,`spin:${command.command_id}`);
  credit(db,pid,payout,`action:${command.command_id}:payout`);
  Object.assign(state,{phase:'READY',bet,last:{number:n,color:rouletteColor(n),bets:slip.bets,choice:command.choice,win:payout>0,payout,net:payout-slip.total}});
 }else if(record.game_code==='B2'){
  if(state.phase==='PLAYER_TURN'&&!state.reserve_key){state.reserve_key=`solo:${record.id}`;reserve(db,state.reserve_key,Math.floor(state.bet*5/2));}
  if(action==='NEW_ROUND'){
    assert(state.phase==='FINISHED',409,'ROUND_IN_PROGRESS');checkBet(bet,pol);
    state.reserve_key=`solo:${record.id}`;reserve(db,state.reserve_key,Math.floor(bet*5/2));
    blackjackDeal(db,pid,state,bet,`action:${command.command_id}`);
  }else if(action==='HIT'){
    assert(state.phase==='PLAYER_TURN',409,'NOT_PLAYER_TURN');
    state.player.push(state.deck.pop());
    if(score(state.player)>=21) {
      if(score(state.player)===21){while(score(state.dealer)<17)state.dealer.push(state.deck.pop());}
      settleBlackjack(db,pid,state,`action:${command.command_id}:payout`);
    }
  }else if(action==='STAND'){
    assert(state.phase==='PLAYER_TURN',409,'NOT_PLAYER_TURN');
    while(score(state.dealer)<17)state.dealer.push(state.deck.pop());
    settleBlackjack(db,pid,state,`action:${command.command_id}:payout`);
  } else fail(400,'INVALID_ACTION');
  state.player_total=score(state.player);state.dealer_total=state.phase==='FINISHED'?score(state.dealer):null;
 }
 return state;
}
export function act(db,playerId,sessionId,command){
 assert(typeof command.command_id==='string'&&/^[a-zA-Z0-9:_-]{12,100}$/.test(command.command_id),400,'INVALID_COMMAND_ID');
 assert(Number.isSafeInteger(command.expected_version),400,'VERSION_REQUIRED');
 return transaction(db,()=>{
  const row=playerSession(db,sessionId,playerId);
  bindCommand(db,playerId,command.command_id,{operation:'game.action',sessionId,...command});
  const previous=db.prepare('SELECT * FROM game_actions WHERE tenant_id=? AND command_id=?').get('wa-world',command.command_id);
  if(previous){assert(previous.session_id===sessionId,409,'COMMAND_REUSED_FOR_OTHER_SESSION');return parse(previous.response_json);}
  if(row.version!==command.expected_version)fail(409,'STATE_STALE');
  const before=parse(row.state_json),slot=row.game_code.startsWith('A1-'),reserveId=`slot:${row.id}`;
  const bound={'A1-01':24,'A1-02':262,'A1-03':121,'A1-04':132,'A1-05':292}[row.game_code];
  const future=st=>((st.phase==='BONUS'||st.phase==='POT_CHOICE')&&st.bonus?.remaining>0?(50-st.bonus.played)*bound*st.bet:0)+(st.pot_queue??[]).reduce((s,t)=>s+5*t.bet,0);
  if(slot){const paid=command.action==='SPIN'&&before.phase==='READY';const amount=paid?bound*(row.game_code==='A1-02'||row.game_code==='A1-05'?51:1)*(command.bet??before.bet):future(before);reserve(db,reserveId,amount);releaseReserve(db,reserveId);}
  const state=perform(db,playerId,row,command);
  if(slot)reserve(db,reserveId,future(state));
  const version=row.version+1;
  db.prepare('UPDATE game_sessions SET state_json=?,version=?,updated_ms=? WHERE id=? AND version=?').run(json(state),version,now(),sessionId,row.version);
  const result={session:getSession(db,sessionId,playerId),balance:wallet(db,playerId)};
  db.prepare('INSERT INTO game_actions VALUES(?,?,?,?,?)').run('wa-world',command.command_id,sessionId,json(result),now());
  addEvent(db,playerId,result.session,'game.state.updated');
  return result;
 });
}
