import {assert,digest,token,uuid,now} from './util.mjs';
import {ensurePlayer,transaction} from './db.mjs';
export function authenticate(db,cookieHeader){
 const cookies=Object.fromEntries(String(cookieHeader??'').split(';').map(s=>s.trim().split('=')));
 const secret=cookies['__Host-wae_session']??cookies.wae_session;
 assert(typeof secret==='string'&&secret.length>=20&&secret.length<=200,401,'LOGIN_REQUIRED');
 const session=db.prepare('SELECT * FROM browser_sessions WHERE secret_hash=? AND revoked_ms IS NULL AND expires_ms>?').get(digest(secret),now());
 assert(session&&session.tenant_id==='wa-world',401,'LOGIN_REQUIRED');return session;
}
export function demoSession(db){return transaction(db,()=>{
 const player=ensurePlayer(db,'local-demo','demo'),secret=token();
 db.prepare('INSERT INTO browser_sessions VALUES(?,?,?,?,?,?,?,?)').run(uuid(),'wa-world',player,digest(secret),now(),now()+86400000,null,'EV-wallet VAL · demo lokal');
 return {secret,player};
});}
