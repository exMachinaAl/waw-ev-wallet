import {postTransfer as transfer} from './val/ledger.mjs';
import {randomInt} from 'node:crypto';
import {assert,now,uuid} from './util.mjs';
import {transaction,accountId,wallet} from './db.mjs';

// Free-to-play test arcade number draw. No real-world value, purchases or VCUR conversion.
export const DRAW_POLICY=Object.freeze({minDigits:4,maxDigits:12,playerDailyEntries:3,globalDailyEntries:200,baseReward:10,extraMatchFactor:1.5,maxReward:500,dailyWorstCaseBudget:100000});
const UTC_DAY=()=>new Date().toISOString().slice(0,10);
export function setupDraw(db){db.exec(`CREATE TABLE IF NOT EXISTS number_draw_plays(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL,
 command_id TEXT NOT NULL UNIQUE,day_utc TEXT NOT NULL,guess TEXT NOT NULL,draw TEXT NOT NULL,
 matched_prefix INTEGER NOT NULL,reward INTEGER NOT NULL,created_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_draw_day ON number_draw_plays(tenant_id,day_utc);
 CREATE INDEX IF NOT EXISTS idx_draw_player_day ON number_draw_plays(tenant_id,player_id,day_utc);`);}
export function evaluateNumberDraw(guess,draw){
 assert(typeof guess==='string'&&/^[0-9]{4,12}$/.test(guess),400,'INVALID_DRAW_DIGITS');
 assert(typeof draw==='string'&&draw.length===guess.length&&/^[0-9]+$/.test(draw),400,'INVALID_DRAW_RESULT');
 let matched=0;while(matched<guess.length&&guess[matched]===draw[matched])matched++;
 const reward=matched>=4?Math.min(DRAW_POLICY.maxReward,Math.round(DRAW_POLICY.baseReward*Math.pow(DRAW_POLICY.extraMatchFactor,matched-4))):0;
 return {matched_prefix:matched,reward};
}
export function drawQuota(db,playerId,tenant='wa-world'){
 const day=UTC_DAY();
 const player=db.prepare('SELECT COUNT(*) count FROM number_draw_plays WHERE tenant_id=? AND player_id=? AND day_utc=?').get(tenant,playerId,day).count;
 const global=db.prepare('SELECT COUNT(*) count FROM number_draw_plays WHERE tenant_id=? AND day_utc=?').get(tenant,day).count;
 return {day_utc:day,player_remaining:Math.max(0,DRAW_POLICY.playerDailyEntries-player),global_remaining:Math.max(0,DRAW_POLICY.globalDailyEntries-global),policy:DRAW_POLICY};
}
export function runNumberDraw(db,playerId,commandId,guess){
 assert(false,410,'LOTTERY_USE_ROUNDS_API');
 assert(typeof guess==='string'&&/^[0-9]{4,12}$/.test(guess),400,'INVALID_DRAW_DIGITS');
 // Called within the action transaction; quotas and payout share the same database lock.
 const q=drawQuota(db,playerId);
 assert(q.player_remaining>0,429,'PLAYER_DAILY_DRAW_LIMIT');
 assert(q.global_remaining>0,429,'GLOBAL_DAILY_DRAW_LIMIT');
 // Worst-case ticket liability must exist *before* the random draw; no changes to odds after it.
 const treasury=db.prepare("SELECT balance FROM accounts WHERE id='wa-treasury' AND tenant_id='wa-world'").get();
 assert(treasury?.balance>=DRAW_POLICY.maxReward,503,'DRAW_TREASURY_PAUSED');
 const result=Array.from({length:guess.length},()=>String(randomInt(10))).join('');
 const matched=evaluateNumberDraw(guess,result);
 if(matched.reward)transfer(db,{from:'wa-treasury',to:accountId(db,playerId),amount:matched.reward,eventKey:`draw:${commandId}:reward`,reason:'free arcade number draw reward'});
 db.prepare('INSERT INTO number_draw_plays VALUES(?,?,?,?,?,?,?,?,?,?)').run(uuid(),'wa-world',playerId,commandId,q.day_utc,guess,result,matched.matched_prefix,matched.reward,now());
 return {guess,draw:result,...matched,quota:drawQuota(db,playerId),payout:matched.reward,free_entry:true};
}
