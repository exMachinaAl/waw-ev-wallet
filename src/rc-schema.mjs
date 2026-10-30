// Additive, restart-safe schema. Existing account balances and history are never rewritten.
export function setupRcSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,applied_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stake_policies(tenant_id TEXT NOT NULL,game_code TEXT NOT NULL,version INTEGER NOT NULL,policy_json TEXT NOT NULL,PRIMARY KEY(tenant_id,game_code));
CREATE TABLE IF NOT EXISTS policy_audit(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,actor TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rc_commands(tenant_id TEXT NOT NULL,actor TEXT NOT NULL,command_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response_json TEXT NOT NULL,PRIMARY KEY(tenant_id,actor,command_id));
CREATE TABLE IF NOT EXISTS treasury_reserves(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>=0));
CREATE TABLE IF NOT EXISTS lottery_campaigns(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,rules_json TEXT NOT NULL,opens_ms INTEGER NOT NULL,closes_ms INTEGER NOT NULL,publishes_ms INTEGER NOT NULL,result TEXT,created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS draw_commits(round_id TEXT PRIMARY KEY REFERENCES lottery_campaigns(id),commitment TEXT NOT NULL,seed TEXT NOT NULL,revealed_ms INTEGER);
CREATE TABLE IF NOT EXISTS lottery_tickets(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES lottery_campaigns(id),player_id TEXT NOT NULL REFERENCES players(id),guess TEXT NOT NULL,cost INTEGER NOT NULL,status TEXT NOT NULL,created_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lottery_ticket_round ON lottery_tickets(round_id,player_id);
CREATE TABLE IF NOT EXISTS lottery_settlements(ticket_id TEXT PRIMARY KEY REFERENCES lottery_tickets(id),matched INTEGER NOT NULL,payout INTEGER NOT NULL,created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS roulette_rounds(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,rules_json TEXT NOT NULL,closes_ms INTEGER NOT NULL,result INTEGER,created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS roulette_slips(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES roulette_rounds(id),player_id TEXT NOT NULL REFERENCES players(id),stake INTEGER NOT NULL,exposure INTEGER NOT NULL,status TEXT NOT NULL,payout INTEGER NOT NULL DEFAULT 0,UNIQUE(round_id,player_id));
CREATE TABLE IF NOT EXISTS roulette_bets(slip_id TEXT NOT NULL REFERENCES roulette_slips(id),position INTEGER NOT NULL,choice TEXT NOT NULL,stake INTEGER NOT NULL,PRIMARY KEY(slip_id,position));
CREATE TABLE IF NOT EXISTS round_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,round_id TEXT NOT NULL,actor TEXT NOT NULL,event TEXT NOT NULL,detail_json TEXT NOT NULL,created_ms INTEGER NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES('1.0.0-rc.1',CAST(strftime('%s','now') AS INTEGER)*1000);
`);}
