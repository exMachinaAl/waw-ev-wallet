import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {assert} from '../util.mjs';

export function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}
function hasColumn(db,table,column){return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column)}
function migrate(db){
 const meta=db.prepare('SELECT product,schema_version FROM platform_meta WHERE id=1').get();assert(meta?.product==='VAL_LAB',409,'SCHEMA_PRODUCT_UNSUPPORTED');assert(meta.schema_version<=3,409,'SCHEMA_VERSION_UNSUPPORTED');
 if(meta.schema_version<2)atomic(db,()=>{
  if(!hasColumn(db,'users','role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER'");
  db.exec(`
   CREATE TRIGGER IF NOT EXISTS users_role_insert BEFORE INSERT ON users WHEN NEW.role NOT IN ('USER','MERCHANT','OPERATOR') BEGIN SELECT RAISE(ABORT,'INVALID_USER_ROLE'); END;
   CREATE TRIGGER IF NOT EXISTS users_role_update BEFORE UPDATE OF role ON users WHEN NEW.role NOT IN ('USER','MERCHANT','OPERATOR') BEGIN SELECT RAISE(ABORT,'INVALID_USER_ROLE'); END;
   CREATE TABLE IF NOT EXISTS registration_invites(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('USER','MERCHANT')),expires_ms INTEGER NOT NULL,used_by TEXT UNIQUE REFERENCES users(id),created_by TEXT NOT NULL REFERENCES users(id),created_ms INTEGER NOT NULL,used_ms INTEGER);
   CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT NOT NULL REFERENCES users(id),code_hash TEXT NOT NULL,created_ms INTEGER NOT NULL,consumed_ms INTEGER,PRIMARY KEY(user_id,code_hash));
   CREATE INDEX IF NOT EXISTS recovery_active ON recovery_codes(user_id,consumed_ms);
   CREATE TABLE IF NOT EXISTS session_context(session_id TEXT PRIMARY KEY REFERENCES sessions(id),client_name TEXT NOT NULL,created_ms INTEGER NOT NULL,last_seen_ms INTEGER NOT NULL);
  `);
  db.prepare("UPDATE users SET role='MERCHANT' WHERE handle='merchant.test'").run();
  db.prepare('UPDATE platform_meta SET schema_version=2 WHERE id=1').run();
 });
 const version=db.prepare('SELECT schema_version FROM platform_meta WHERE id=1').get().schema_version;
 if(version<3)atomic(db,()=>{db.exec(`
  CREATE TABLE IF NOT EXISTS refunds(id TEXT PRIMARY KEY,original_journal_id TEXT NOT NULL REFERENCES journals(id),journal_id TEXT UNIQUE NOT NULL REFERENCES journals(id),initiator_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),created_ms INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS refunds_original ON refunds(original_journal_id,created_ms);
  CREATE TABLE IF NOT EXISTS notifications(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),event_type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,reference TEXT,read_ms INTEGER,created_ms INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id,seq DESC);
 `);db.prepare('UPDATE platform_meta SET schema_version=3 WHERE id=1').run()});
 const current=db.prepare('SELECT schema_version FROM platform_meta WHERE id=1').get();assert(current?.schema_version===3,409,'SCHEMA_VERSION_UNSUPPORTED');
}
export function openPlatformDb(filename=':memory:'){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
 const db=new DatabaseSync(filename);
 const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 if(existing.length&&!existing.some(t=>t.name==='platform_meta')){db.close();throw Error('FOREIGN_DATABASE_FORBIDDEN: use a dedicated VAL Lab database')}
 // This is an isolated payment laboratory, never a second ledger for Arcade balances.
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('val_scope','players')").get()){db.close();throw Error('ARCADE_DATABASE_FORBIDDEN: use a separate VAL Lab database')}
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
 atomic(db,()=>db.exec(`
 CREATE TABLE IF NOT EXISTS platform_meta(id INTEGER PRIMARY KEY CHECK(id=1),product TEXT NOT NULL CHECK(product='VAL_LAB'),schema_version INTEGER NOT NULL);
 INSERT OR IGNORE INTO platform_meta VALUES(1,'VAL_LAB',1);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,handle TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),failed_logins INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,user_id TEXT UNIQUE REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('USER','FAUCET','ISSUANCE_OFFSET')),currency TEXT NOT NULL DEFAULT 'VAL' CHECK(currency='VAL'),pocket TEXT NOT NULL DEFAULT 'lab' CHECK(pocket='lab'),balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND (kind='ISSUANCE_OFFSET' OR balance>=0)));
 CREATE TABLE IF NOT EXISTS journals(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),currency TEXT NOT NULL DEFAULT 'VAL' CHECK(currency='VAL'),pocket TEXT NOT NULL DEFAULT 'lab' CHECK(pocket='lab'),created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT,journal_id TEXT NOT NULL REFERENCES journals(id),account_id TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),UNIQUE(journal_id,account_id));
 CREATE INDEX IF NOT EXISTS entries_account ON entries(account_id,journal_id);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),family_id TEXT NOT NULL,access_hash TEXT UNIQUE NOT NULL,refresh_hash TEXT UNIQUE NOT NULL,access_expires_ms INTEGER NOT NULL,refresh_expires_ms INTEGER NOT NULL,revoked_ms INTEGER,authenticated_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS sessions_family ON sessions(family_id);
 CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,public_key TEXT NOT NULL,key_hash TEXT UNIQUE NOT NULL,algorithm TEXT NOT NULL CHECK(algorithm='RS256'),revoked_ms INTEGER,created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS integrations(id TEXT PRIMARY KEY,label TEXT NOT NULL,service_hash TEXT UNIQUE NOT NULL,receiver_id TEXT NOT NULL REFERENCES users(id),scopes_json TEXT NOT NULL,revoked_ms INTEGER);
 CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES users(id),payer_id TEXT REFERENCES users(id),receiver_id TEXT NOT NULL REFERENCES users(id),app_id TEXT REFERENCES integrations(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),channel TEXT NOT NULL CHECK(channel IN ('TRANSFER','QR_VAL_DEMO','NFC_VAL_DEMO')),status TEXT NOT NULL CHECK(status IN ('PENDING','SETTLED','CANCELLED')),token TEXT UNIQUE NOT NULL,expires_ms INTEGER NOT NULL,journal_id TEXT UNIQUE REFERENCES journals(id),created_ms INTEGER NOT NULL,settled_ms INTEGER);
 CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT REFERENCES sessions(id),device_id TEXT REFERENCES devices(id),purpose TEXT NOT NULL CHECK(purpose IN ('ENROLL','LOGIN','CONFIRM')),intent_id TEXT REFERENCES intents(id),payload TEXT NOT NULL,public_key TEXT,label TEXT,expires_ms INTEGER NOT NULL,consumed_ms INTEGER,created_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS challenge_user ON challenges(user_id,purpose);
 CREATE TABLE IF NOT EXISTS commands(actor TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,response_json TEXT NOT NULL,created_ms INTEGER NOT NULL,PRIMARY KEY(actor,key));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,event TEXT NOT NULL,reference TEXT,created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,app_id TEXT REFERENCES integrations(id),event_type TEXT NOT NULL,payload_json TEXT NOT NULL,created_ms INTEGER NOT NULL);
 `));
 migrate(db);return db;
}
