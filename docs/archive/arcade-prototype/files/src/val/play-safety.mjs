import {assert,now} from '../util.mjs';
export function playSafety(db,player,tenant='wa-world'){
 const row=db.prepare('SELECT * FROM val_play_safety WHERE tenant_id=? AND player_id=?').get(tenant,player);
 return {excluded_until:row?.excluded_until??0,session_end:row?.session_end??0,pause_until:row?.pause_until??0,budget:String(row?.budget??0),spent:String(row?.spent??0),limits_active:Boolean(row?.session_end),public_beta_ready:false};
}
export function updateSafety(db,player,input,tenant='wa-world'){
 assert(db.isTransaction,500,'VAL_TRANSACTION_REQUIRED');
 db.prepare('INSERT OR IGNORE INTO val_play_safety(tenant_id,player_id) VALUES(?,?)').run(tenant,player);
 const row=db.prepare('SELECT * FROM val_play_safety WHERE tenant_id=? AND player_id=?').get(tenant,player),time=now();
 if(input.action==='EXCLUDE'){
  assert([1,7,30].includes(input.days),400,'INVALID_EXCLUSION');
  db.prepare('UPDATE val_play_safety SET excluded_until=? WHERE tenant_id=? AND player_id=?').run(Math.max(row.excluded_until,time+input.days*86400000),tenant,player);
 }else if(input.action==='START_SESSION'){
  assert(row.excluded_until<=time,403,'SELF_EXCLUDED');assert(row.pause_until<=time,409,'PLAY_BREAK_REQUIRED');
  assert(Number.isSafeInteger(input.budget)&&input.budget>=1&&input.budget<=100,400,'INVALID_PLAY_BUDGET');
  db.prepare('UPDATE val_play_safety SET session_end=?,pause_until=?,budget=?,spent=0 WHERE tenant_id=? AND player_id=?').run(time+15*60000,time+30*60000,input.budget,tenant,player);
 }else assert(false,400,'INVALID_SAFETY_ACTION');
 return playSafety(db,player,tenant);
}
export function enforceStake(db,player,amount,tenant){
 const row=db.prepare('SELECT * FROM val_play_safety WHERE tenant_id=? AND player_id=?').get(tenant,player);if(!row)return;
 assert(row.excluded_until<=now(),403,'SELF_EXCLUDED');
 if(row.session_end){
  assert(now()<row.session_end,403,'PLAY_SESSION_ENDED');
  assert(Number.isSafeInteger(row.spent+amount)&&row.spent+amount<=row.budget,403,'PLAY_BUDGET_REACHED');
  db.prepare('UPDATE val_play_safety SET spent=spent+? WHERE tenant_id=? AND player_id=?').run(amount,tenant,player);
 }
}
