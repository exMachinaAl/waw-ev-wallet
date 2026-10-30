import {assert,uuid,now,digest} from '../util.mjs';
import {canonical} from '../val/commands.mjs';
import {atomic} from './db.mjs';
export const SCOPE=Object.freeze({currency:'VAL',pocket:'lab',environment:'LAB'});
export function units(value){assert(typeof value==='string'&&/^[1-9][0-9]{0,11}$/.test(value),400,'INVALID_AMOUNT');const n=Number(value);assert(Number.isSafeInteger(n)&&n<=100000000000,400,'INVALID_AMOUNT');return n}
export function scope(input){assert((input.currency===undefined||input.currency==='VAL')&&(input.pocket===undefined||input.pocket==='lab'),403,'POCKET_FORBIDDEN')}
export function audit(db,actor,event,reference=null){db.prepare('INSERT INTO audit(actor,event,reference,created_ms) VALUES(?,?,?,?)').run(actor,event,reference,now())}
export function once(db,actor,key,input,fn){
 assert(typeof key==='string'&&/^[A-Za-z0-9:_-]{12,100}$/.test(key),400,'IDEMPOTENCY_KEY_REQUIRED');
 const fingerprint=digest(JSON.stringify(canonical(input)));
 return atomic(db,()=>{const old=db.prepare('SELECT * FROM commands WHERE actor=? AND key=?').get(actor,key);if(old){assert(old.fingerprint===fingerprint,409,'IDEMPOTENCY_CONFLICT');return JSON.parse(old.response_json)}const result=fn();db.prepare('INSERT INTO commands VALUES(?,?,?,?,?)').run(actor,key,fingerprint,JSON.stringify(result),now());return result});
}
export function account(db,user){const row=db.prepare("SELECT * FROM accounts WHERE user_id=? AND kind='USER'").get(user);assert(row,404,'WALLET_NOT_FOUND');return row}
export function post(db,{from,to,amount,eventKey,kind,issuance=false}){
 assert(db.isTransaction,500,'TRANSACTION_REQUIRED');assert(Number.isSafeInteger(amount)&&amount>0,400,'INVALID_AMOUNT');assert(from!==to,400,'SAME_ACCOUNT');
 const previous=db.prepare('SELECT * FROM journals WHERE event_key=?').get(eventKey);
 if(previous){const rows=db.prepare('SELECT * FROM entries WHERE journal_id=?').all(previous.id);assert(previous.amount===amount&&previous.kind===kind&&rows.length===2&&rows.some(e=>e.account_id===from&&e.delta===-amount)&&rows.some(e=>e.account_id===to&&e.delta===amount),409,'IDEMPOTENCY_CONFLICT');return previous.id}
 const src=db.prepare('SELECT * FROM accounts WHERE id=?').get(from),dst=db.prepare('SELECT * FROM accounts WHERE id=?').get(to);assert(src&&dst,404,'ACCOUNT_NOT_FOUND');assert(src.currency===dst.currency&&src.pocket===dst.pocket,403,'POCKET_FORBIDDEN');
 assert(Number.isSafeInteger(src.balance-amount)&&Number.isSafeInteger(dst.balance+amount),409,'BALANCE_OVERFLOW');
 assert(src.balance>=amount||(issuance&&src.kind==='ISSUANCE_OFFSET'&&dst.kind==='FAUCET'),409,'INSUFFICIENT_VAL');assert(dst.kind!=='ISSUANCE_OFFSET',403,'ACCOUNT_FORBIDDEN');
 const id=uuid();db.prepare('INSERT INTO journals(id,event_key,kind,amount,created_ms) VALUES(?,?,?,?,?)').run(id,eventKey,kind,amount,now());
 db.prepare('UPDATE accounts SET balance=balance-? WHERE id=?').run(amount,from);db.prepare('UPDATE accounts SET balance=balance+? WHERE id=?').run(amount,to);
 db.prepare('INSERT INTO entries(journal_id,account_id,delta) VALUES(?,?,?)').run(id,from,-amount);db.prepare('INSERT INTO entries(journal_id,account_id,delta) VALUES(?,?,?)').run(id,to,amount);return id;
}
export function balance(db,user){const a=account(db,user);assert(Number.isSafeInteger(a.balance)&&a.balance>=0,409,'RECONCILIATION_REQUIRED');return {...SCOPE,posted:String(a.balance),held:'0',available:String(a.balance)}}
const projection=r=>({...SCOPE,id:r.id,sequence:r.seq,kind:r.kind,amount:String(r.amount),delta:String(r.delta),status:'POSTED',reference:r.event_key,created_ms:r.created_ms});
export function receipt(db,user,id){const own=account(db,user),r=db.prepare('SELECT j.*,e.delta FROM journals j JOIN entries e ON e.journal_id=j.id WHERE j.id=? AND e.account_id=?').get(id,own.id);assert(r,404,'RECEIPT_NOT_FOUND');const other=db.prepare('SELECT u.handle,u.display_name FROM entries e JOIN accounts a ON a.id=e.account_id LEFT JOIN users u ON u.id=a.user_id WHERE e.journal_id=? AND e.account_id<>?').get(id,own.id),refund=db.prepare('SELECT original_journal_id FROM refunds WHERE journal_id=?').get(id);let refunded=0,refundable=0,canRefund=false;if(['TRANSFER','PAYMENT'].includes(r.kind)){refunded=db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE original_journal_id=?').get(id).total;refundable=r.amount-refunded;canRefund=r.delta>0&&refundable>0}return {...projection(r),counterparty:other?{handle:other.handle,display_name:other.display_name}:null,original_transaction_id:refund?.original_journal_id??null,refund_summary:['TRANSFER','PAYMENT'].includes(r.kind)?{refunded:String(refunded),refundable:String(refundable),can_refund:canRefund}:null}}
export function history(db,user,{before=null,limit=20,kind=null,direction=null}={}){assert(Number.isInteger(limit)&&limit>=1&&limit<=100,400,'INVALID_PAGE_SIZE');assert(before===null||/^[1-9][0-9]{0,14}$/.test(before),400,'INVALID_CURSOR');assert(kind===null||['TRANSFER','PAYMENT','REFUND','INITIAL_CREDIT'].includes(kind),400,'INVALID_TRANSACTION_KIND');assert(direction===null||['IN','OUT'].includes(direction),400,'INVALID_DIRECTION');const cursor=before===null?Number.MAX_SAFE_INTEGER:Number(before),where=['e.account_id=?','j.seq<?'],params=[account(db,user).id,cursor];if(kind){where.push('j.kind=?');params.push(kind)}if(direction){where.push(direction==='IN'?'e.delta>0':'e.delta<0')}params.push(limit+1);const rows=db.prepare(`SELECT j.*,e.delta FROM journals j JOIN entries e ON e.journal_id=j.id WHERE ${where.join(' AND ')} ORDER BY j.seq DESC LIMIT ?`).all(...params);return {transactions:rows.slice(0,limit).map(projection),next_cursor:rows.length>limit?String(rows[limit-1].seq):null,filters:{kind,direction}}}
export function reconcile(db){
 const errors=[],sums=new Map(),journals=new Map();for(const a of db.prepare('SELECT * FROM accounts').all())sums.set(a.id,0n);
 for(const e of db.prepare('SELECT * FROM entries').all()){sums.set(e.account_id,(sums.get(e.account_id)??0n)+BigInt(e.delta));const j=journals.get(e.journal_id)??{sum:0n,count:0};j.sum+=BigInt(e.delta);j.count++;journals.set(e.journal_id,j)}
 for(const j of db.prepare('SELECT * FROM journals').all()){const entries=journals.get(j.id);if(!entries||entries.sum!==0n||entries.count!==2)errors.push({id:j.id,code:'UNBALANCED_JOURNAL'})}
 for(const a of db.prepare('SELECT * FROM accounts').all())if(!Number.isSafeInteger(a.balance)||sums.get(a.id)!==BigInt(a.balance))errors.push({id:a.id,code:'BALANCE_MISMATCH'});
 return {...SCOPE,ok:errors.length===0,accounts:sums.size,journals:journals.size,errors};
}
