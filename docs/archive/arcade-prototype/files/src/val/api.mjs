import {readWallet,readHistory,readReceipt} from './ledger.mjs';
import {playSafety,updateSafety} from './play-safety.mjs';
import {transaction} from '../db.mjs';
import {assert} from '../util.mjs';
export function valApi(db,session,method,path,query,body){
 const {player_id:player,tenant_id:tenant}=session;
 assert(tenant==='wa-world',403,'TENANT_NOT_SUPPORTED');
 // Scope and owner come only from the authenticated browser session.
 if(method==='GET'&&path==='/wallets')return {wallets:[readWallet(db,player,tenant)]};
 if(method==='GET'&&path==='/transactions')return readHistory(db,player,{cursor:query.get('cursor'),limit:query.has('limit')?Number(query.get('limit')):20},tenant);
 const match=path.match(/^\/transactions\/([a-f0-9]{32})$/);
 if(method==='GET'&&match)return {receipt:readReceipt(db,player,match[1],tenant)};
 if(path==='/play-safety'&&method==='GET')return playSafety(db,player,tenant);
 if(path==='/play-safety'&&method==='POST')return transaction(db,()=>updateSafety(db,player,body,tenant));
 assert(false,404,'ENDPOINT_NOT_FOUND');
}
