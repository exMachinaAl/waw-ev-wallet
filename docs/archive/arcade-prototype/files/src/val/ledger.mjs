import {assert,uuid,now} from '../util.mjs';
import {enforceStake} from './play-safety.mjs';

export const VAL_SCOPE=Object.freeze({currency:'VAL',pocket:'arcade',app_id:'world-arcade'});
export function heldAmount(db,account){
 const amount=account.kind==='TREASURY'?db.prepare('SELECT amount FROM treasury_reserves WHERE tenant_id=?').all(account.tenant_id).reduce((sum,row)=>sum+BigInt(row.amount),0n):0n;
 assert(amount>=0n&&amount<=BigInt(Number.MAX_SAFE_INTEGER),409,'RESERVE_OVERFLOW');return Number(amount);
}
// Internal only: the authenticated game/administrator decides accounts and amount.
export function postTransfer(db,{tenant='wa-world',from,to,amount,eventKey,reason,kind}){
 assert(db.isTransaction,500,'VAL_TRANSACTION_REQUIRED');
 assert(Number.isSafeInteger(amount)&&amount>0&&amount<=1000000000000,400,'INVALID_AMOUNT');
 assert(typeof eventKey==='string'&&eventKey.length>0&&typeof reason==='string',400,'INVALID_TRANSFER');
 const old=db.prepare('SELECT * FROM transfers WHERE tenant_id=? AND event_key=?').get(tenant,eventKey);
 if(old){
  const entries=db.prepare('SELECT account_id,delta FROM entries WHERE transfer_id=?').all(old.id);
  assert(old.reason===reason&&entries.length===2&&entries.some(e=>e.account_id===from&&e.delta===-amount)&&entries.some(e=>e.account_id===to&&e.delta===amount),409,'IDEMPOTENCY_CONFLICT');
  return {reused:true,transferId:old.id};
 }
 const src=db.prepare('SELECT * FROM accounts WHERE id=? AND tenant_id=?').get(from,tenant),dst=db.prepare('SELECT * FROM accounts WHERE id=? AND tenant_id=?').get(to,tenant);
 assert(src&&dst,400,'INVALID_ACCOUNTS');assert(from!==to,400,'SAME_ACCOUNT');
 assert(!(src.kind==='PLAYER'&&dst.kind==='PLAYER'),403,'POCKET_TRANSFER_FORBIDDEN');
 assert(Number.isSafeInteger(src.balance)&&Number.isSafeInteger(dst.balance)&&Number.isSafeInteger(dst.balance+amount),400,'BALANCE_OVERFLOW');
 assert(src.balance>=amount,409,'INSUFFICIENT_ACR');
 assert(src.balance-amount>=heldAmount(db,src),409,'TREASURY_RESERVED');
 if(src.kind==='PLAYER'&&kind!=='CORRECTION')enforceStake(db,src.owner_id,amount,tenant);
 const id=uuid();db.prepare('INSERT INTO transfers VALUES(?,?,?,?,?)').run(id,tenant,eventKey,reason,now());
 db.prepare('UPDATE accounts SET balance=balance-? WHERE id=?').run(amount,from);
 db.prepare('UPDATE accounts SET balance=balance+? WHERE id=?').run(amount,to);
 db.prepare('INSERT INTO entries(transfer_id,account_id,delta) VALUES(?,?,?)').run(id,from,-amount);
 db.prepare('INSERT INTO entries(transfer_id,account_id,delta) VALUES(?,?,?)').run(id,to,amount);
 return {reused:false,transferId:id};
}

function ownedAccount(db,player,tenant){const a=db.prepare("SELECT * FROM accounts WHERE tenant_id=? AND owner_id=? AND kind='PLAYER'").get(tenant,player);assert(a,404,'WALLET_NOT_FOUND');return a;}
export function readWallet(db,player,tenant='wa-world'){
 const a=ownedAccount(db,player,tenant),held=heldAmount(db,a);assert(Number.isSafeInteger(a.balance)&&a.balance>=held,409,'WALLET_RECONCILIATION_REQUIRED');
 return {...VAL_SCOPE,posted:String(a.balance),held:String(held),available:String(a.balance-held),legacy_currency:'ACR'};
}
function projection(row){
 const kind=row.event_key.startsWith('starter:')?'INITIAL_CREDIT':/refund/i.test(row.event_key+row.reason)?'REFUND':/admin/i.test(row.event_key+row.reason)?'CORRECTION':row.delta<0?'STAKE':'PAYOUT';
 return {...VAL_SCOPE,id:row.id,reference:row.event_key,kind,amount:String(Math.abs(row.delta)),delta:String(row.delta),status:'POSTED',created_ms:row.created_ms};
}
const receiptQuery=`SELECT t.*,e.delta FROM transfers t JOIN entries e ON e.transfer_id=t.id WHERE t.tenant_id=? AND e.account_id=?`;
export function readReceipt(db,player,id,tenant='wa-world'){
 const a=ownedAccount(db,player,tenant),row=db.prepare(receiptQuery+' AND t.id=?').get(tenant,a.id,id);assert(row,404,'RECEIPT_NOT_FOUND');return projection(row);
}
export function readHistory(db,player,{cursor=null,limit=20}={},tenant='wa-world'){
 const a=ownedAccount(db,player,tenant);assert(Number.isInteger(limit)&&limit>=1&&limit<=100,400,'INVALID_PAGE_SIZE');
 let before=null;
 if(cursor){assert(/^[a-f0-9]{32}$/.test(cursor),400,'INVALID_CURSOR');before=readReceipt(db,player,cursor,tenant);}
 const rows=before?db.prepare(receiptQuery+' AND (t.created_ms<? OR (t.created_ms=? AND t.id<?)) ORDER BY t.created_ms DESC,t.id DESC LIMIT ?').all(tenant,a.id,before.created_ms,before.created_ms,before.id,limit+1):db.prepare(receiptQuery+' ORDER BY t.created_ms DESC,t.id DESC LIMIT ?').all(tenant,a.id,limit+1);
 const page=rows.slice(0,limit);return {transactions:page.map(projection),next_cursor:rows.length>limit?page.at(-1).id:null};
}
