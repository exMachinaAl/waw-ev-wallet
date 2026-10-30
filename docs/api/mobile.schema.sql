-- Generated schema; no users, credentials or player data.
PRAGMA foreign_keys=ON;

CREATE TRIGGER users_role_insert BEFORE INSERT ON users WHEN NEW.role NOT IN ('USER','MERCHANT','OPERATOR') BEGIN SELECT RAISE(ABORT,'INVALID_USER_ROLE'); END;

CREATE TRIGGER users_role_update BEFORE UPDATE OF role ON users WHEN NEW.role NOT IN ('USER','MERCHANT','OPERATOR') BEGIN SELECT RAISE(ABORT,'INVALID_USER_ROLE'); END;

CREATE TABLE accounts(id TEXT PRIMARY KEY,user_id TEXT UNIQUE REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN ('USER','FAUCET','ISSUANCE_OFFSET')),currency TEXT NOT NULL DEFAULT 'VAL' CHECK(currency='VAL'),pocket TEXT NOT NULL DEFAULT 'lab' CHECK(pocket='lab'),balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND (kind='ISSUANCE_OFFSET' OR balance>=0)));

CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,event TEXT NOT NULL,reference TEXT,created_ms INTEGER NOT NULL);

CREATE TABLE challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_id TEXT REFERENCES sessions(id),device_id TEXT REFERENCES devices(id),purpose TEXT NOT NULL CHECK(purpose IN ('ENROLL','LOGIN','CONFIRM')),intent_id TEXT REFERENCES intents(id),payload TEXT NOT NULL,public_key TEXT,label TEXT,expires_ms INTEGER NOT NULL,consumed_ms INTEGER,created_ms INTEGER NOT NULL);

CREATE TABLE commands(actor TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,response_json TEXT NOT NULL,created_ms INTEGER NOT NULL,PRIMARY KEY(actor,key));

CREATE TABLE devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,public_key TEXT NOT NULL,key_hash TEXT UNIQUE NOT NULL,algorithm TEXT NOT NULL CHECK(algorithm='RS256'),revoked_ms INTEGER,created_ms INTEGER NOT NULL);

CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,journal_id TEXT NOT NULL REFERENCES journals(id),account_id TEXT NOT NULL REFERENCES accounts(id),delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),UNIQUE(journal_id,account_id));

CREATE TABLE integrations(id TEXT PRIMARY KEY,label TEXT NOT NULL,service_hash TEXT UNIQUE NOT NULL,receiver_id TEXT NOT NULL REFERENCES users(id),scopes_json TEXT NOT NULL,revoked_ms INTEGER);

CREATE TABLE intents(id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES users(id),payer_id TEXT REFERENCES users(id),receiver_id TEXT NOT NULL REFERENCES users(id),app_id TEXT REFERENCES integrations(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),channel TEXT NOT NULL CHECK(channel IN ('TRANSFER','QR_VAL_DEMO','NFC_VAL_DEMO')),status TEXT NOT NULL CHECK(status IN ('PENDING','SETTLED','CANCELLED')),token TEXT UNIQUE NOT NULL,expires_ms INTEGER NOT NULL,journal_id TEXT UNIQUE REFERENCES journals(id),created_ms INTEGER NOT NULL,settled_ms INTEGER);

CREATE TABLE journals(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,event_key TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),currency TEXT NOT NULL DEFAULT 'VAL' CHECK(currency='VAL'),pocket TEXT NOT NULL DEFAULT 'lab' CHECK(pocket='lab'),created_ms INTEGER NOT NULL);

CREATE TABLE notifications(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),event_type TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,reference TEXT,read_ms INTEGER,created_ms INTEGER NOT NULL);

CREATE TABLE outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,app_id TEXT REFERENCES integrations(id),event_type TEXT NOT NULL,payload_json TEXT NOT NULL,created_ms INTEGER NOT NULL);

CREATE TABLE platform_meta(id INTEGER PRIMARY KEY CHECK(id=1),product TEXT NOT NULL CHECK(product='VAL_LAB'),schema_version INTEGER NOT NULL);

CREATE TABLE recovery_codes(user_id TEXT NOT NULL REFERENCES users(id),code_hash TEXT NOT NULL,created_ms INTEGER NOT NULL,consumed_ms INTEGER,PRIMARY KEY(user_id,code_hash));

CREATE TABLE refunds(id TEXT PRIMARY KEY,original_journal_id TEXT NOT NULL REFERENCES journals(id),journal_id TEXT UNIQUE NOT NULL REFERENCES journals(id),initiator_id TEXT NOT NULL REFERENCES users(id),amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),created_ms INTEGER NOT NULL);

CREATE TABLE registration_invites(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('USER','MERCHANT')),expires_ms INTEGER NOT NULL,used_by TEXT UNIQUE REFERENCES users(id),created_by TEXT NOT NULL REFERENCES users(id),created_ms INTEGER NOT NULL,used_ms INTEGER);

CREATE TABLE session_context(session_id TEXT PRIMARY KEY REFERENCES sessions(id),client_name TEXT NOT NULL,created_ms INTEGER NOT NULL,last_seen_ms INTEGER NOT NULL);

CREATE TABLE sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),family_id TEXT NOT NULL,access_hash TEXT UNIQUE NOT NULL,refresh_hash TEXT UNIQUE NOT NULL,access_expires_ms INTEGER NOT NULL,refresh_expires_ms INTEGER NOT NULL,revoked_ms INTEGER,authenticated_ms INTEGER NOT NULL,created_ms INTEGER NOT NULL);

CREATE TABLE users(id TEXT PRIMARY KEY,handle TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),failed_logins INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,created_ms INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'USER');

CREATE INDEX challenge_user ON challenges(user_id,purpose);

CREATE INDEX entries_account ON entries(account_id,journal_id);

CREATE INDEX notifications_user ON notifications(user_id,seq DESC);

CREATE INDEX recovery_active ON recovery_codes(user_id,consumed_ms);

CREATE INDEX refunds_original ON refunds(original_journal_id,created_ms);

CREATE INDEX sessions_family ON sessions(family_id);
