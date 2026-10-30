import {assert} from '../util.mjs';
export function reserve(db,id,amount,tenant='wa-world'){
 assert(db.isTransaction,500,'VAL_TRANSACTION_REQUIRED');
 assert(Number.isSafeInteger(amount)&&amount>=0,400,'INVALID_EXPOSURE');
 const other=db.prepare('SELECT amount FROM treasury_reserves WHERE tenant_id=? AND id<>?').all(tenant,id).reduce((sum,r)=>sum+BigInt(r.amount),0n);
 assert(other+BigInt(amount)<=BigInt(Number.MAX_SAFE_INTEGER),400,'RESERVE_OVERFLOW');
 const treasury=db.prepare("SELECT balance FROM accounts WHERE tenant_id=? AND kind='TREASURY'").get(tenant);
 assert(treasury&&Number.isSafeInteger(treasury.balance)&&BigInt(treasury.balance)-other>=BigInt(amount),409,'TREASURY_RESERVE_INSUFFICIENT');
 const current=db.prepare('SELECT tenant_id FROM treasury_reserves WHERE id=?').get(id);assert(!current||current.tenant_id===tenant,403,'RESERVE_SCOPE_MISMATCH');
 db.prepare('INSERT INTO treasury_reserves VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount').run(id,tenant,amount);
}
export function releaseReserve(db,id,tenant='wa-world'){
 assert(db.isTransaction,500,'VAL_TRANSACTION_REQUIRED');
 return db.prepare('DELETE FROM treasury_reserves WHERE id=? AND tenant_id=?').run(id,tenant);
}
