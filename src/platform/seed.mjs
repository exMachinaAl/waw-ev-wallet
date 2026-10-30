import {assert,token,now,digest} from '../util.mjs';
import {atomic} from './db.mjs';
import {post} from './ledger.mjs';
import {passwordHash} from './auth.mjs';
export const TEST_USERS=[{id:'usr_alice',handle:'alice.test',name:'Alice · akun uji',role:'USER'},{id:'usr_bob',handle:'bob.test',name:'Bob · akun uji',role:'USER'},{id:'usr_merchant',handle:'merchant.test',name:'Toko VAL · merchant uji',role:'MERCHANT'},{id:'usr_operator',handle:'operator.test',name:'Operator VAL · akun uji',role:'OPERATOR'}];
export async function seedLab(db){
 // Never reset existing passwords or balances. Re-running the initializer issues no credits.
 const material=[];for(const user of TEST_USERS)if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(user.id)){const password='Val-'+token(18),derived=await passwordHash(password);material.push({...user,password,...derived})}
 const credentials=atomic(db,()=>{
  db.prepare("INSERT OR IGNORE INTO accounts(id,kind) VALUES('lab-offset','ISSUANCE_OFFSET')").run();db.prepare("INSERT OR IGNORE INTO accounts(id,kind) VALUES('lab-faucet','FAUCET')").run();
  post(db,{from:'lab-offset',to:'lab-faucet',amount:1000000,eventKey:'lab:genesis:1',kind:'ISSUANCE',issuance:true});const accounts=[];
  for(const u of material){if(db.prepare('SELECT 1 FROM users WHERE id=?').get(u.id))continue;db.prepare('INSERT INTO users(id,handle,display_name,password_salt,password_hash,created_ms,role) VALUES(?,?,?,?,?,?,?)').run(u.id,u.handle,u.name,u.salt,u.hash,now(),u.role);db.prepare("INSERT INTO accounts(id,user_id,kind) VALUES(?,?,'USER')").run('account:'+u.id,u.id);post(db,{from:'lab-faucet',to:'account:'+u.id,amount:1000,eventKey:'lab:starter:'+u.id,kind:'INITIAL_CREDIT'});accounts.push({handle:u.handle,password:u.password,user_id:u.id,role:u.role,starting_balance:'1000'})}
  let service=null;if(!db.prepare("SELECT 1 FROM integrations WHERE id='merchant-demo'").get()){const secret=token();db.prepare('INSERT INTO integrations VALUES(?,?,?,?,?,?)').run('merchant-demo','Merchant fixture',digest(secret),'usr_merchant',JSON.stringify(['payment:create','events:read']),null);service={app_id:'merchant-demo',service_token:secret}}
  return {environment:'LAB',accounts,service};
 });return credentials;
}
