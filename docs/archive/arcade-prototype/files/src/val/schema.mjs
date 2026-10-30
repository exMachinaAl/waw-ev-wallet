import {assert,now} from '../util.mjs';

export const VAL_VERSION='val-arcade-1';
export function registerValWriter(db){db.function('val_writer_v1',()=>1);}
export function hasValSchema(db){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='val_openings'").get());}

// No inferred balancing entries: the supported RC3 genesis is explicit and audited.
export function reconcileVal(db,{legacy=false}={}){
 const errors=[];
 const accounts=db.prepare('SELECT * FROM accounts').all();
 const totals=new Map(accounts.map(a=>[a.id,0n]));
 const journals=new Map();
 for(const e of db.prepare('SELECT e.*,t.tenant_id FROM entries e JOIN transfers t ON t.id=e.transfer_id').all()){
  const a=accounts.find(a=>a.id===e.account_id);
  if(!Number.isSafeInteger(e.delta)||!a||a.tenant_id!==e.tenant_id){errors.push({code:'INVALID_ENTRY',id:e.id});continue;}
  totals.set(a.id,totals.get(a.id)+BigInt(e.delta));
  const j=journals.get(e.transfer_id)??{sum:0n,count:0};j.sum+=BigInt(e.delta);j.count++;journals.set(e.transfer_id,j);
 }
 for(const t of db.prepare('SELECT id FROM transfers').all()){
  const j=journals.get(t.id);if(!j||j.sum!==0n||j.count!==2)errors.push({code:'UNBALANCED_JOURNAL',id:t.id});
 }
 const report=accounts.map(a=>{
  const opening=legacy?(a.id==='wa-faucet'?2000000:a.id==='wa-treasury'?800000:0):db.prepare('SELECT amount FROM val_openings WHERE account_id=?').get(a.id)?.amount;
  if(!Number.isSafeInteger(a.balance)||!Number.isSafeInteger(opening)||BigInt(a.balance)!==BigInt(opening??0)+totals.get(a.id))errors.push({code:'BALANCE_MISMATCH',id:a.id});
  const held=a.kind==='TREASURY'?db.prepare('SELECT amount FROM treasury_reserves WHERE tenant_id=?').all(a.tenant_id).reduce((n,r)=>n+BigInt(r.amount),0n):0n;
  if(held>BigInt(a.balance)||held>BigInt(Number.MAX_SAFE_INTEGER))errors.push({code:'RESERVE_DEFICIT',id:a.id});
  return {id:a.id,kind:a.kind,opening:String(opening??0),posted:String(a.balance),entries:String(totals.get(a.id)),held:String(held)};
 });
 return {ok:errors.length===0,currency:'VAL',pocket:'arcade',accounts:report,journals:journals.size,errors};
}

export function migrateVal(db){
 registerValWriter(db);
 if(hasValSchema(db))return {applied:false,reconciliation:reconcileVal(db)};
 db.exec('BEGIN IMMEDIATE');
 try{
  const before=reconcileVal(db,{legacy:true});assert(before.ok,409,'VAL_RECONCILIATION_REQUIRED');
  db.exec(`
   CREATE TABLE val_openings(account_id TEXT PRIMARY KEY REFERENCES accounts(id),amount INTEGER NOT NULL CHECK(amount>=0),basis TEXT NOT NULL);
   CREATE TABLE val_scope(id INTEGER PRIMARY KEY CHECK(id=1),currency TEXT NOT NULL CHECK(currency='VAL'),pocket TEXT NOT NULL CHECK(pocket='arcade'),app_id TEXT NOT NULL CHECK(app_id='world-arcade'));
   INSERT INTO val_scope VALUES(1,'VAL','arcade','world-arcade');
   CREATE TABLE val_commands(tenant_id TEXT NOT NULL,actor TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(tenant_id,actor,command_id));
   CREATE TABLE val_play_safety(tenant_id TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),excluded_until INTEGER NOT NULL DEFAULT 0,session_end INTEGER NOT NULL DEFAULT 0,pause_until INTEGER NOT NULL DEFAULT 0,budget INTEGER NOT NULL DEFAULT 0,spent INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant_id,player_id));
   CREATE INDEX IF NOT EXISTS val_entries_account ON entries(account_id,transfer_id);
  `);
  for(const a of before.accounts)db.prepare('INSERT INTO val_openings VALUES(?,?,?)').run(a.id,Number(a.opening),'RC3 genesis: faucet 2000000; treasury 800000; player 0');
  db.exec(`CREATE TRIGGER val_new_account AFTER INSERT ON accounts BEGIN INSERT INTO val_openings VALUES(NEW.id,NEW.balance,'account creation'); END;`);
  // Older binaries cannot resolve this connection-local function and fail closed.
  for(const table of ['accounts','transfers','entries','treasury_reserves'])for(const operation of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER val_fence_${table}_${operation} BEFORE ${operation} ON ${table} BEGIN SELECT CASE WHEN val_writer_v1()<>1 THEN RAISE(ABORT,'VAL_WRITER_REQUIRED') END; END;`);
  db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(?,?)').run(VAL_VERSION,now());
  db.exec('COMMIT');return {applied:true,reconciliation:reconcileVal(db)};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
