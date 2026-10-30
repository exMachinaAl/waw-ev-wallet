import {postTransfer as transfer} from './val/ledger.mjs';
/** Admin-only ACR test credits. Does not import, call, or touch WA-WORLD's VCUR. */
import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {uuid,now,assert} from './util.mjs';
import {transaction,accountId,audit,wallet} from './db.mjs';

const SALT_LEN=16,KEY_LEN=64,SESSION_MS=12*60*60*1000;
const POOL_ID='wae-admin-test-pool';
export const MAX_ADJUSTMENT=50000;
export const DAILY_GRANT_LIMIT=200000;
const digest = value=>createHash('sha256').update(value).digest('hex');
function normalizedUsername(name){assert(typeof name==='string'&&/^[a-z0-9_.-]{3,40}$/i.test(name),400,'INVALID_ADMIN_NAME');return name.toLowerCase();}
function passwordHash(password,salt){return scryptSync(password,salt,KEY_LEN,{N:16384,r:8,p:1}).toString('hex');}
export function setupAdminSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS admin_users (
   id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_salt TEXT NOT NULL,
   password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'ADMIN',created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_sessions (
   id TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES admin_users(id),
   secret_hash TEXT UNIQUE NOT NULL,expires_ms INTEGER NOT NULL,revoked_ms INTEGER);
 CREATE TABLE IF NOT EXISTS admin_adjustments (
   id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,admin_id TEXT NOT NULL,
   player_id TEXT NOT NULL REFERENCES players(id),operation TEXT NOT NULL,
   amount INTEGER NOT NULL,reason TEXT NOT NULL,transfer_id TEXT NOT NULL,
   created_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS admin_adjustments_created ON admin_adjustments(created_ms);
 CREATE INDEX IF NOT EXISTS admin_adjustments_player ON admin_adjustments(player_id,created_ms);`);
 db.prepare('INSERT OR IGNORE INTO accounts(id,tenant_id,owner_id,kind,balance) VALUES(?,?,?,?,?)')
   .run(POOL_ID,'wa-world',null,'TREASURY',5000000);
}
export function createAdmin(db,username,password){
 username=normalizedUsername(username);
 assert(typeof password==='string'&&password.length>=12&&password.length<=256,400,'ADMIN_PASSWORD_TOO_SHORT');
 assert(!db.prepare('SELECT id FROM admin_users WHERE username=?').get(username),409,'ADMIN_ALREADY_EXISTS');
 const salt=randomBytes(SALT_LEN).toString('hex');
 const id=uuid();
 db.prepare('INSERT INTO admin_users(id,username,password_salt,password_hash,role,created_ms) VALUES(?,?,?,?,?,?)')
   .run(id,username,salt,passwordHash(password,salt),'ADMIN',now());
 audit(db,'admin.created',{adminId:id,username});return {id,username};
}
export function adminLogin(db,username,password){
 // Both known and unknown username paths execute scrypt, reducing timing differences.
 const u=typeof username==='string'?username.trim().toLowerCase():'';
 const entry=db.prepare('SELECT * FROM admin_users WHERE username=?').get(u);
 const salt=entry?.password_salt??'00000000000000000000000000000000';
 const target=Buffer.from(entry?.password_hash??'00'.repeat(KEY_LEN),'hex');
 const candidate=Buffer.from(passwordHash(typeof password==='string'?password:'',salt),'hex');
 assert(Boolean(entry)&&timingSafeEqual(candidate,target),401,'ADMIN_LOGIN_FAILED');
 const secret=randomBytes(32).toString('base64url');
 db.prepare('INSERT INTO admin_sessions(id,admin_id,secret_hash,expires_ms,revoked_ms) VALUES(?,?,?,?,NULL)')
   .run(uuid(),entry.id,digest(secret),now()+SESSION_MS);
 audit(db,'admin.login',{adminId:entry.id});
 return {secret,username:entry.username,role:entry.role,expires_at:now()+SESSION_MS};
}
export function adminSession(db,secret){
 if(typeof secret!=='string'||secret.length<32)return null;
 return db.prepare(`SELECT s.id AS session_id,u.id,u.username,u.role,s.expires_ms FROM admin_sessions s
   JOIN admin_users u ON u.id=s.admin_id WHERE s.secret_hash=? AND s.revoked_ms IS NULL AND s.expires_ms>?`).get(digest(secret),now())??null;
}
export function adminLogout(db,session){
 db.prepare('UPDATE admin_sessions SET revoked_ms=? WHERE id=?').run(now(),session.session_id);
 audit(db,'admin.logout',{adminId:session.id});
}
export function adminPlayers(db,query=''){
 assert(typeof query==='string'&&query.length<=90,400,'INVALID_SEARCH');
 const q=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
 return db.prepare(`SELECT p.id,p.created_ms,a.balance,
  COALESCE(GROUP_CONCAT(i.provider||':'||i.subject, ', '),'') AS identities
  FROM players p JOIN accounts a ON a.owner_id=p.id AND a.tenant_id=p.tenant_id AND a.kind='PLAYER'
  LEFT JOIN identities i ON i.player_id=p.id AND i.tenant_id=p.tenant_id
  WHERE p.tenant_id='wa-world' AND (?='' OR p.id LIKE ? ESCAPE '\\' OR i.subject LIKE ? ESCAPE '\\')
  GROUP BY p.id ORDER BY p.created_ms DESC LIMIT 75`).all(query,q,q);
}
export function adminDashboard(db){
 const stats=db.prepare(`SELECT COUNT(*) AS players,COALESCE(SUM(a.balance),0) AS player_acr
    FROM players p JOIN accounts a ON a.owner_id=p.id AND a.kind='PLAYER' WHERE p.tenant_id='wa-world'`).get();
 const pool=db.prepare('SELECT balance FROM accounts WHERE id=?').get(POOL_ID)?.balance??0;
 const today=new Date();today.setUTCHours(0,0,0,0);
 const daily=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM admin_adjustments WHERE operation='ADD' AND created_ms>=?").get(today.getTime());
 return {...stats,pool_acr:pool,daily_grants:daily.total,daily_limit:DAILY_GRANT_LIMIT,max_per_action:MAX_ADJUSTMENT};
}
export function adminRecentAdjustments(db){
 return db.prepare(`SELECT x.id,x.request_id,x.player_id,x.operation,x.amount,x.reason,x.created_ms,
   u.username AS admin FROM admin_adjustments x JOIN admin_users u ON x.admin_id=u.id
   ORDER BY x.created_ms DESC LIMIT 40`).all();
}
export function adminAdjust(db,admin,{player_id,operation,amount,reason,request_id}){
 assert(typeof player_id==='string'&&/^[a-f0-9]{32}$/.test(player_id),400,'INVALID_PLAYER_ID');
 assert(['ADD','DEDUCT'].includes(operation),400,'INVALID_OPERATION');
 assert(Number.isSafeInteger(amount)&&amount>=1&&amount<=MAX_ADJUSTMENT,400,'INVALID_ADMIN_AMOUNT');
 assert(typeof reason==='string'&&reason.trim().length>=8&&reason.trim().length<=240,400,'REASON_REQUIRED');
 assert(typeof request_id==='string'&&/^[a-f0-9-]{36}$/i.test(request_id),400,'BAD_REQUEST_ID');
 return transaction(db,()=>{
   const earlier=db.prepare('SELECT * FROM admin_adjustments WHERE request_id=?').get(request_id);
   if(earlier){
     assert(earlier.admin_id===admin.id&&earlier.player_id===player_id&&earlier.operation===operation&&earlier.amount===amount&&earlier.reason===reason.trim(),409,'REQUEST_ID_REUSED');
     return {reused:true,adjustment_id:earlier.id,balance:wallet(db,player_id)};
   }
   assert(db.prepare("SELECT id FROM players WHERE id=? AND tenant_id='wa-world'").get(player_id),404,'PLAYER_NOT_FOUND');
   if(operation==='ADD'){
     const utcMidnight=new Date();utcMidnight.setUTCHours(0,0,0,0);
     const used=db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM admin_adjustments WHERE operation='ADD' AND created_ms>=?").get(utcMidnight.getTime()).total;
     assert(used+amount<=DAILY_GRANT_LIMIT,409,'DAILY_ADMIN_LIMIT');
   }
   const userAccount=accountId(db,player_id);
   const result=transfer(db,{kind:'CORRECTION',from:operation==='ADD'?POOL_ID:userAccount,to:operation==='ADD'?userAccount:POOL_ID,
     amount,eventKey:`admin:${request_id}`,reason:`ADMIN_TEST_${operation}: ${reason.trim()}`});
   assert(!result.reused,409,'DUPLICATE_ADMIN_LEDGER');
   const id=uuid();
   db.prepare('INSERT INTO admin_adjustments VALUES(?,?,?,?,?,?,?,?,?)')
     .run(id,request_id,admin.id,player_id,operation,amount,reason.trim(),result.transferId,now());
   audit(db,'admin.wallet_adjusted',{adminId:admin.id,playerId:player_id,operation,amount,adjustmentId:id});
   return {reused:false,adjustment_id:id,balance:wallet(db,player_id)};
 });
}
