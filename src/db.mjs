import {postTransfer} from './val/ledger.mjs';
import {registerValWriter,hasValSchema,migrateVal} from './val/schema.mjs';
import {setupRcSchema} from './rc-schema.mjs';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {uuid,now,json,fail,assert} from './util.mjs';
export function openDb(filename=':memory:'){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
 const db=new DatabaseSync(filename);
 registerValWriter(db);
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='accounts'").get()&&!hasValSchema(db)){db.close();fail(409,'VAL_MIGRATION_REQUIRED');}
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS identities(tenant_id TEXT NOT NULL,provider TEXT NOT NULL,subject TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),PRIMARY KEY(tenant_id,provider,subject));
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),owner_id TEXT,kind TEXT NOT NULL CHECK(kind IN('PLAYER','TREASURY','FAUCET')),balance INTEGER NOT NULL CHECK(balance>=0),UNIQUE(tenant_id,owner_id,kind));
 CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,event_key TEXT NOT NULL,reason TEXT NOT NULL,created_ms INTEGER NOT NULL,UNIQUE(tenant_id,event_key));
 CREATE TABLE IF NOT EXISTS entries(id INTEGER PRIMARY KEY AUTOINCREMENT,transfer_id TEXT NOT NULL REFERENCES transfers(id),account_id TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS entries_transfer ON entries(transfer_id);
 CREATE TABLE IF NOT EXISTS game_sessions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),game_code TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,state_json TEXT NOT NULL,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS game_actions(tenant_id TEXT NOT NULL,command_id TEXT NOT NULL,session_id TEXT NOT NULL,response_json TEXT NOT NULL,created_ms INTEGER NOT NULL,PRIMARY KEY(tenant_id,command_id));
 CREATE TABLE IF NOT EXISTS browser_sessions(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),secret_hash TEXT NOT NULL UNIQUE,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,revoked_ms INTEGER,device_label TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL,game_session_id TEXT,ref TEXT NOT NULL UNIQUE,direction TEXT NOT NULL CHECK(direction IN('WA_TO_WEB')),status TEXT NOT NULL,claim_hash TEXT,code_hash TEXT,display_code TEXT,attempts INTEGER NOT NULL DEFAULT 0,expires_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_links(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL REFERENCES players(id),code_hash TEXT NOT NULL UNIQUE,display_code TEXT NOT NULL,wa_subject TEXT,status TEXT NOT NULL,expires_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant_id TEXT,event TEXT NOT NULL,detail_json TEXT NOT NULL,created_ms INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,player_id TEXT NOT NULL,session_id TEXT NOT NULL,event_type TEXT NOT NULL,version INTEGER NOT NULL,payload_json TEXT NOT NULL,created_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS outbox_session ON outbox(session_id,id);
 `);
 db.prepare('INSERT OR IGNORE INTO tenants(id,slug) VALUES(?,?)').run('wa-world','wa-world');
 db.prepare('INSERT OR IGNORE INTO accounts(id,tenant_id,owner_id,kind,balance) VALUES(?,?,?,?,?)').run('wa-faucet','wa-world',null,'FAUCET',2000000);
 db.prepare('INSERT OR IGNORE INTO accounts(id,tenant_id,owner_id,kind,balance) VALUES(?,?,?,?,?)').run('wa-treasury','wa-world',null,'TREASURY',800000);
 setupRcSchema(db);
 migrateVal(db);
 return db;
}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(db,event,detail={},tenant='wa-world'){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?)').run(uuid(),tenant,event,json(detail),now());}
function acct(db,tenant,owner,kind){return db.prepare('SELECT * FROM accounts WHERE tenant_id=? AND kind=? AND owner_id IS ?').get(tenant,kind,owner);}
export function wallet(db,playerId,tenant='wa-world'){return acct(db,tenant,playerId,'PLAYER')?.balance??0;}
// Compatibility adapter: every existing Arcade writer enters VAL in the caller transaction.
export const transfer=postTransfer;
export function ensurePlayer(db,subject,provider='wa',tenant='wa-world'){
 assert(typeof subject==='string'&&subject.length>=3&&subject.length<=120&&/^[a-zA-Z0-9_.:@+-]+$/.test(subject),400,'BAD_IDENTITY');
 assert(['wa','demo'].includes(provider),400,'BAD_PROVIDER');
 const existing=db.prepare('SELECT player_id FROM identities WHERE tenant_id=? AND provider=? AND subject=?').get(tenant,provider,subject);
 if(existing)return existing.player_id;
 const playerId=uuid(),accountId=uuid();
 db.prepare('INSERT INTO players(id,tenant_id,created_ms) VALUES(?,?,?)').run(playerId,tenant,now());
 db.prepare('INSERT INTO identities VALUES(?,?,?,?)').run(tenant,provider,subject,playerId);
 db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(accountId,tenant,playerId,'PLAYER',0);
 transfer(db,{tenant,from:'wa-faucet',to:accountId,amount:500,eventKey:`starter:${playerId}`,reason:'initial nonredeemable test credits'});
 audit(db,'player.registered',{playerId,provider},tenant);
 return playerId;
}
export function accountId(db,playerId,tenant='wa-world'){
 const row=acct(db,tenant,playerId,'PLAYER');if(!row)fail(404,'WALLET_NOT_FOUND');return row.id;
}
export function checkLedger(db){
 const imbalanced=db.prepare('SELECT transfer_id,SUM(delta) AS total FROM entries GROUP BY transfer_id HAVING total<>0').all();
 const mismatched=db.prepare('SELECT a.id,a.balance,COALESCE(SUM(e.delta),0) AS posted FROM accounts a LEFT JOIN entries e ON e.account_id=a.id WHERE a.kind=? GROUP BY a.id HAVING posted<>a.balance').all('PLAYER');
 return {imbalanced,playerBalancesMismatched:mismatched};
}
