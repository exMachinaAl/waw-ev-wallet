import {canonical} from './val/commands.mjs';
import {heldAmount} from './val/ledger.mjs';
import {postTransfer as transfer} from './val/ledger.mjs';
import {assert,uuid,json,parse,now,digest} from './util.mjs';
import {transaction,audit} from './db.mjs';
export const SAFETY_CEILING=10000;
export const DEFAULT_POLICY=Object.freeze({min:1,max:3000,presets:[1,10,100,500,1000,3000],maxDigits:12});
export function tenantFor(db,p){const t=db.prepare('SELECT tenant_id FROM players WHERE id=?').get(p)?.tenant_id;assert(t==='wa-world',403,'TENANT_NOT_SUPPORTED');return t;}
export function policy(db,game='*',tenant='wa-world'){
 const rows=db.prepare('SELECT * FROM stake_policies WHERE tenant_id=? AND game_code IN (?,?)').all(tenant,'*',game);
 const global=rows.find(r=>r.game_code==='*'),specific=rows.find(r=>r.game_code===game&&game!=='*');
 const base=global?parse(global.policy_json):{...DEFAULT_POLICY},local=specific?parse(specific.policy_json):base;
 return {...local,min:Math.max(base.min,local.min),max:Math.min(base.max,local.max),version:`${global?.version??0}:${specific?.version??0}`,game_code:game,tenant_id:tenant};
}
export function checkStake(amount,p){assert(Number.isSafeInteger(amount)&&amount>0,400,'INVALID_BET');assert(amount>=p.min,400,'BET_TOO_LOW');assert(amount<=p.max&&amount<=SAFETY_CEILING,400,'BET_TOO_HIGH');return amount;}
export function once(db,actor,cmd,payload,fn,tenant='wa-world'){
 assert(typeof cmd==='string'&&/^[A-Za-z0-9:_-]{12,100}$/.test(cmd),400,'INVALID_COMMAND_ID');
 const fingerprint=digest(json(canonical(payload)));
 return transaction(db,()=>{const old=db.prepare('SELECT * FROM rc_commands WHERE tenant_id=? AND actor=? AND command_id=?').get(tenant,actor,cmd);
 if(old){assert(old.fingerprint===fingerprint,409,'COMMAND_PAYLOAD_MISMATCH');return parse(old.response_json);}
 const result=parse(json(fn()));db.prepare('INSERT INTO rc_commands VALUES(?,?,?,?,?)').run(tenant,actor,cmd,fingerprint,json(result));return result;});
}
export function setPolicy(db,admin,input){assert(admin?.role==='ADMIN',403,'ADMIN_REQUIRED');const {game_code='*',min=1,max=3000,maxDigits=12,command_id}=input;
 assert(['*','L1','B1','B2','B2-MP','T0','A1-01','A1-02','A1-03','A1-04','A1-05'].includes(game_code),400,'UNKNOWN_GAME');
 assert(Number.isSafeInteger(min)&&Number.isSafeInteger(max)&&min>=1&&max>=min&&max<=SAFETY_CEILING,400,'INVALID_POLICY');
 assert(Number.isInteger(maxDigits)&&maxDigits>=4&&maxDigits<=32,400,'INVALID_DIGIT_LIMIT');assert(!input.tenant_id||input.tenant_id==='wa-world',403,'TENANT_NOT_SUPPORTED');
 return once(db,admin.id,command_id,input,()=>{const before=policy(db,game_code);const next={min,max,maxDigits,presets:[min,10,100,500,1000,max].filter((v,i,a)=>v>=min&&v<=max&&a.indexOf(v)===i).sort((a,b)=>a-b)};
 db.prepare('INSERT INTO stake_policies VALUES(?,?,1,?) ON CONFLICT(tenant_id,game_code) DO UPDATE SET version=version+1,policy_json=excluded.policy_json').run('wa-world',game_code,json(next));
 db.prepare('INSERT INTO policy_audit VALUES(?,?,?,?,?,?)').run(uuid(),'wa-world',admin.id,json(before),json(next),now());audit(db,'stake.policy.changed',{actor:admin.id,game_code,before,next});return policy(db,game_code);});
}
export function reserve(db,id,amount){assert(Number.isSafeInteger(amount)&&amount>=0,400,'INVALID_EXPOSURE');const other=db.prepare('SELECT COALESCE(SUM(amount),0) n FROM treasury_reserves WHERE tenant_id=? AND id<>?').get('wa-world',id).n;assert(Number.isSafeInteger(other)&&Number.isSafeInteger(other+amount),400,'RESERVE_OVERFLOW');
 const balance=db.prepare("SELECT balance FROM accounts WHERE id='wa-treasury'").get().balance;assert(balance-other>=amount,409,'TREASURY_RESERVE_INSUFFICIENT');db.prepare('INSERT INTO treasury_reserves VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount').run(id,'wa-world',amount);}
export const releaseReserve=(db,id)=>db.prepare('DELETE FROM treasury_reserves WHERE id=?').run(id);

export function treasuryStatus(db){const balance=db.prepare("SELECT balance FROM accounts WHERE id='wa-treasury'").get().balance,reserved=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM treasury_reserves WHERE tenant_id='wa-world'").get().n,faucet=db.prepare("SELECT balance FROM accounts WHERE id='wa-faucet'").get().balance;return {balance,reserved,available:balance-reserved,deficit:Math.max(0,reserved-balance),faucet_available:faucet,status:balance>=reserved?'FUNDED':'RESERVE_DEFICIT'};}
export function fundTreasury(db,admin,b){assert(admin?.role==='ADMIN',403,'ADMIN_REQUIRED');assert(Number.isSafeInteger(b.amount)&&b.amount>=1&&b.amount<=100000000,400,'INVALID_AMOUNT');assert(typeof b.reason==='string'&&b.reason.length>=8&&b.reason.length<=240,400,'REASON_REQUIRED');return once(db,admin.id,b.command_id,b,()=>{transfer(db,{from:'wa-faucet',to:'wa-treasury',amount:b.amount,eventKey:`treasury-fund:${b.command_id}`,reason:`Treasury reserve allocation: ${b.reason}`});audit(db,'treasury.faucet_allocated',{admin_id:admin.id,amount:b.amount,reason:b.reason});return treasuryStatus(db);});}
