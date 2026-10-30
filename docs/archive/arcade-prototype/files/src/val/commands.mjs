import {assert,digest} from '../util.mjs';
export function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
 return value;
}
// Call inside the SAME transaction, before legacy replay lookup. A thrown command rolls this back too.
export function bindCommand(db,actor,key,payload,tenant='wa-world'){
 assert(db.isTransaction,500,'VAL_TRANSACTION_REQUIRED');
 // expected_version is a precondition for a NEW command; WA refreshes it on redelivery.
 const {expected_version,...businessPayload}=payload;
 const fingerprint=digest(JSON.stringify(canonical(businessPayload)));
 const old=db.prepare('SELECT fingerprint FROM val_commands WHERE tenant_id=? AND actor=? AND command_id=?').get(tenant,actor,key);
 if(old)assert(old.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT');
 else {
  // Pre-VAL response caches did not retain the request. Never guess its fingerprint.
  for(const [table,owner] of [['game_actions',null],['multiplayer_commands','player_id'],['bj_commands','player_id']]){
   if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   const prior=db.prepare(`SELECT 1 FROM ${table} WHERE tenant_id=? AND command_id=?${owner?` AND ${owner}=?`:''}`).get(...(owner?[tenant,key,actor]:[tenant,key]));
   assert(!prior,409,'LEGACY_COMMAND_UNVERIFIABLE');
  }
  db.prepare('INSERT INTO val_commands VALUES(?,?,?,?)').run(tenant,actor,key,fingerprint);
 }
}
