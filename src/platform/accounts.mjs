import {randomBytes} from 'node:crypto';
import {assert,digest,now,token,uuid} from '../util.mjs';
import {atomic} from './db.mjs';
import {audit,post} from './ledger.mjs';
import {issueSession,passwordHash,verifyPassword} from './auth.mjs';

const RECOVERY_COUNT=8;
const cleanCode=value=>typeof value==='string'?value.trim().toUpperCase():'';
const validHandle=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(value);
function displayName(value){assert(typeof value==='string'&&value.trim().length>=2&&value.trim().length<=80&&!/[\x00-\x1f\x7f]/.test(value),400,'INVALID_DISPLAY_NAME');return value.trim()}
function recoveryCode(){const hex=randomBytes(10).toString('hex').toUpperCase();return `VALR-${hex.slice(0,5)}-${hex.slice(5,10)}-${hex.slice(10,15)}-${hex.slice(15)}`}
function replaceRecoveryCodes(db,user){const time=now();db.prepare('UPDATE recovery_codes SET consumed_ms=? WHERE user_id=? AND consumed_ms IS NULL').run(time,user);const codes=Array.from({length:RECOVERY_COUNT},recoveryCode),insert=db.prepare('INSERT INTO recovery_codes VALUES(?,?,?,NULL)');for(const code of codes)insert.run(user,digest(cleanCode(code)),time);return codes}
function userProfile(db,id){const row=db.prepare('SELECT id,handle,display_name,role,status,created_ms FROM users WHERE id=?').get(id);assert(row,404,'ACCOUNT_NOT_FOUND');return row}
function requireRole(db,s,role){const user=userProfile(db,s.user_id);assert(user.status==='ACTIVE'&&user.role===role,403,'ROLE_FORBIDDEN');return user}

export function profile(db,s){return userProfile(db,s.user_id)}
export function updateProfile(db,s,{display_name}){return atomic(db,()=>{const name=displayName(display_name);db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name,s.user_id);audit(db,s.user_id,'account.profile_updated');return userProfile(db,s.user_id)})}

export function createInvite(db,s,{role,expires_in_seconds}){
 requireRole(db,s,'OPERATOR');assert(s.authenticated_ms>now()-5*60000,403,'PASSWORD_REAUTH_REQUIRED');assert(['USER','MERCHANT'].includes(role),400,'INVALID_INVITE_ROLE');assert(/^[0-9]{2,7}$/.test(expires_in_seconds),400,'INVALID_INVITE_EXPIRY');const seconds=Number(expires_in_seconds);assert(Number.isSafeInteger(seconds)&&seconds>=60&&seconds<=7*86400,400,'INVALID_INVITE_EXPIRY');
 return atomic(db,()=>{const id=uuid(),invite_code='VALI-'+token(24),time=now(),expires=time+seconds*1000;db.prepare('INSERT INTO registration_invites VALUES(?,?,?,?,?,?,?,NULL)').run(id,digest(invite_code),role,expires,null,s.user_id,time);audit(db,s.user_id,'registration.invite_created',id);return {invite_id:id,invite_code,role,expires_ms:expires}})
}

export async function register(db,{invite_code,handle,display_name,password,client_name}){
 assert(typeof invite_code==='string'&&/^VALI-[A-Za-z0-9_-]{32}$/.test(invite_code),400,'INVITE_INVALID');assert(validHandle(handle),400,'INVALID_HANDLE');const name=displayName(display_name),derived=await passwordHash(password);
 return atomic(db,()=>{
  const invite=db.prepare('SELECT * FROM registration_invites WHERE token_hash=?').get(digest(invite_code));assert(invite&&invite.used_by===null&&invite.expires_ms>now(),400,'INVITE_INVALID');assert(!db.prepare('SELECT 1 FROM users WHERE handle=?').get(handle),409,'HANDLE_TAKEN');
  const id=uuid(),time=now();db.prepare('INSERT INTO users(id,handle,display_name,password_salt,password_hash,status,failed_logins,locked_until,created_ms,role) VALUES(?,?,?,?,?,\'ACTIVE\',0,0,?,?)').run(id,handle,name,derived.salt,derived.hash,time,invite.role);db.prepare("INSERT INTO accounts(id,user_id,kind) VALUES(?,?,'USER')").run('account:'+id,id);post(db,{from:'lab-faucet',to:'account:'+id,amount:1000,eventKey:'lab:starter:'+id,kind:'INITIAL_CREDIT'});
  const used=db.prepare('UPDATE registration_invites SET used_by=?,used_ms=? WHERE id=? AND used_by IS NULL').run(id,time,invite.id);assert(used.changes===1,409,'INVITE_ALREADY_USED');const recovery_codes=replaceRecoveryCodes(db,id);audit(db,id,'account.registered',invite.id);const session=issueSession(db,id,{authenticated:time,clientName:client_name??'Registration client'});return {...session,profile:userProfile(db,id),recovery_codes};
 })
}

export async function changePassword(db,s,{current_password,new_password}){
 const snapshot=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id),valid=await verifyPassword(current_password,snapshot),derived=await passwordHash(new_password);assert(valid,401,'CURRENT_PASSWORD_INVALID');assert(current_password!==new_password,400,'PASSWORD_UNCHANGED');
 return atomic(db,()=>{const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(s.user_id);assert(current?.password_hash===snapshot.password_hash,409,'PASSWORD_CHANGED_RETRY');assert(db.prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_ms IS NULL').get(s.id,s.user_id),401,'AUTH_REQUIRED');db.prepare('UPDATE users SET password_salt=?,password_hash=?,failed_logins=0,locked_until=0 WHERE id=?').run(derived.salt,derived.hash,s.user_id);db.prepare('UPDATE sessions SET revoked_ms=? WHERE user_id=? AND family_id<>? AND revoked_ms IS NULL').run(now(),s.user_id,s.family_id);db.prepare('UPDATE sessions SET authenticated_ms=? WHERE id=? AND revoked_ms IS NULL').run(now(),s.id);audit(db,s.user_id,'account.password_changed');return {changed:true,other_sessions_revoked:true}})
}

export async function rotateRecoveryCodes(db,s,{password}){
 const user=db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id),valid=await verifyPassword(password,user);assert(valid,401,'CURRENT_PASSWORD_INVALID');return atomic(db,()=>{const current=db.prepare('SELECT password_hash FROM users WHERE id=?').get(s.user_id);assert(current?.password_hash===user.password_hash,409,'PASSWORD_CHANGED_RETRY');assert(db.prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_ms IS NULL').get(s.id,s.user_id),401,'AUTH_REQUIRED');const recovery_codes=replaceRecoveryCodes(db,s.user_id);db.prepare('UPDATE sessions SET authenticated_ms=? WHERE id=? AND revoked_ms IS NULL').run(now(),s.id);audit(db,s.user_id,'account.recovery_rotated');return {recovery_codes}})
}

export async function recover(db,{handle,recovery_code,new_password,client_name}){
 const user=validHandle(handle)?db.prepare('SELECT * FROM users WHERE handle=?').get(handle):null,derived=await passwordHash(new_password),codeHash=digest(cleanCode(recovery_code));
 return atomic(db,()=>{const current=user&&db.prepare('SELECT * FROM users WHERE id=?').get(user.id),code=current&&db.prepare('SELECT * FROM recovery_codes WHERE user_id=? AND code_hash=? AND consumed_ms IS NULL').get(current.id,codeHash);assert(current&&current.status==='ACTIVE'&&code,401,'RECOVERY_FAILED');const consumed=db.prepare('UPDATE recovery_codes SET consumed_ms=? WHERE user_id=? AND code_hash=? AND consumed_ms IS NULL').run(now(),current.id,codeHash);assert(consumed.changes===1,401,'RECOVERY_FAILED');db.prepare('UPDATE users SET password_salt=?,password_hash=?,failed_logins=0,locked_until=0 WHERE id=?').run(derived.salt,derived.hash,current.id);db.prepare('UPDATE sessions SET revoked_ms=COALESCE(revoked_ms,?) WHERE user_id=?').run(now(),current.id);db.prepare('UPDATE devices SET revoked_ms=COALESCE(revoked_ms,?) WHERE user_id=?').run(now(),current.id);const recovery_codes=replaceRecoveryCodes(db,current.id);audit(db,current.id,'account.recovered');const session=issueSession(db,current.id,{authenticated:now(),clientName:client_name??'Recovery client'});return {...session,profile:userProfile(db,current.id),recovery_codes,devices_revoked:true}})
}

export function listSessions(db,s){const rows=db.prepare(`SELECT a.family_id,a.id AS session_id,COALESCE(c.client_name,'Unknown client') AS client_name,a.created_ms,COALESCE(c.last_seen_ms,a.created_ms) AS last_seen_ms,a.refresh_expires_ms FROM sessions a LEFT JOIN session_context c ON c.session_id=a.id WHERE a.user_id=? AND a.revoked_ms IS NULL AND a.refresh_expires_ms>? ORDER BY last_seen_ms DESC`).all(s.user_id,now());return {sessions:rows.map(row=>({...row,current:row.family_id===s.family_id}))}}
export function revokeSession(db,s,family){assert(/^[a-f0-9]{32}$/.test(family),400,'INVALID_SESSION_ID');return atomic(db,()=>{const exists=db.prepare('SELECT 1 FROM sessions WHERE user_id=? AND family_id=? AND revoked_ms IS NULL').get(s.user_id,family);assert(exists,404,'SESSION_NOT_FOUND');db.prepare('UPDATE sessions SET revoked_ms=COALESCE(revoked_ms,?) WHERE user_id=? AND family_id=?').run(now(),s.user_id,family);audit(db,s.user_id,'session.revoked',family);return {revoked:true,current:family===s.family_id}})}
export function logoutOthers(db,s){return atomic(db,()=>{const changed=db.prepare('UPDATE sessions SET revoked_ms=? WHERE user_id=? AND family_id<>? AND revoked_ms IS NULL').run(now(),s.user_id,s.family_id);audit(db,s.user_id,'session.others_revoked');return {revoked_sessions:changed.changes}})}
export function logoutAll(db,s){return atomic(db,()=>{const changed=db.prepare('UPDATE sessions SET revoked_ms=? WHERE user_id=? AND revoked_ms IS NULL').run(now(),s.user_id);audit(db,s.user_id,'session.all_revoked');return {revoked_sessions:changed.changes}})}
