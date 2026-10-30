import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import QRCode from 'qrcode';
import {getPorts,listenFixed} from '../runtime.mjs';
import {assert,digest,uuid,now} from '../util.mjs';
import {openPlatformDb,atomic} from './db.mjs';
import * as auth from './auth.mjs';
import * as accounts from './accounts.mjs';
import * as ledger from './ledger.mjs';
import * as payments from './payments.mjs';
import * as refunds from './refunds.mjs';
import * as notifications from './notifications.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),prefix='/api/mobile/v1';
function strict(body,keys,required=keys){assert(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>keys.includes(k)),400,'UNEXPECTED_FIELD');assert(required.every(k=>Object.hasOwn(body,k))&&Object.values(body).every(v=>typeof v==='string'),400,'INVALID_FIELD');return body}
async function body(req){assert((req.headers['content-type']??'').startsWith('application/json'),415,'JSON_REQUIRED');let text='';for await(const chunk of req){text+=chunk;assert(Buffer.byteLength(text)<=16384,413,'BODY_TOO_LARGE')}try{return JSON.parse(text||'{}')}catch{assert(false,400,'BAD_JSON')}}
function send(res,status,value,id){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Request-ID':id});res.end(JSON.stringify(value))}
function service(db,header,permission){assert(typeof header==='string'&&header.startsWith('Bearer '),401,'SERVICE_AUTH_REQUIRED');const app=db.prepare('SELECT * FROM integrations WHERE service_hash=? AND revoked_ms IS NULL').get(digest(header.slice(7)));assert(app&&JSON.parse(app.scopes_json).includes(permission),403,'SERVICE_SCOPE_DENIED');return app}
export function createPlatformServer({db=openPlatformDb(),closeDatabase=true,publicOrigin=null}={}){
 if(publicOrigin){const configured=new URL(publicOrigin);assert(configured.protocol==='https:'&&configured.origin===publicOrigin,400,'INVALID_PUBLIC_ORIGIN')}
 const rates=new Map();
 const server=http.createServer(async(req,res)=>{
  const requestId=uuid();res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  try{
   const url=new URL(req.url,`http://${req.headers.host}`),method=req.method,p=url.pathname.slice(prefix.length),key=req.headers['idempotency-key'];
   if(url.pathname.startsWith(prefix)||url.pathname.startsWith('/internal/val/v1')){
    const rateKey=(req.socket.remoteAddress??'unknown')+(p.startsWith('/auth/')?':auth':':api'),time=now(),window=p.startsWith('/auth/')?30:180,rate=rates.get(rateKey);if(!rate||time-rate.start>60000)rates.set(rateKey,{start:time,count:1});else assert(++rate.count<=window,429,'RATE_LIMITED');if(rates.size>2000)for(const [k,v] of rates)if(time-v.start>60000)rates.delete(k);
    // No cookies are accepted for mobile auth. Native clients use Bearer tokens, without Origin.
    if(req.headers.origin)assert(req.headers.origin===(publicOrigin??url.origin),403,'ORIGIN_DENIED');
    const b=method==='POST'?await body(req):{};let result;
    if(url.pathname==='/internal/val/v1/payment-requests'&&method==='POST'){const app=service(db,req.headers.authorization,'payment:create');strict(b,['amount','channel','currency','pocket'],['amount']);result=payments.createRequest(db,app.receiver_id,b,key,{app:app.id,receiver:app.receiver_id})}
    else if(url.pathname==='/internal/val/v1/events'&&method==='GET'){const app=service(db,req.headers.authorization,'events:read'),after=url.searchParams.get('after')??'0';assert(/^[0-9]{1,15}$/.test(after),400,'INVALID_CURSOR');const events=db.prepare('SELECT seq,id,event_type,payload_json,created_ms FROM outbox WHERE app_id=? AND seq>? ORDER BY seq LIMIT 100').all(app.id,Number(after));result={events:events.map(e=>({...e,payload_json:undefined,payload:JSON.parse(e.payload_json)})),next_cursor:events.length?String(events.at(-1).seq):after}}
    else if(!url.pathname.startsWith(prefix))assert(false,404,'ENDPOINT_NOT_FOUND');
    else if(method==='GET'&&p==='/health')result={product:'EV-wallet VAL',api_version:'mobile.v1',environment:'LAB',storage:'SQLite',production_ready:false};
    else if(method==='GET'&&p==='/capabilities')result=payments.capabilities;
    else if(method==='POST'&&p==='/auth/login')result=await auth.login(db,strict(b,['handle','password','client_name'],['handle','password']));
    else if(method==='POST'&&p==='/auth/register')result=await accounts.register(db,strict(b,['invite_code','handle','display_name','password','client_name'],['invite_code','handle','display_name','password']));
    else if(method==='POST'&&p==='/auth/recover')result=await accounts.recover(db,strict(b,['handle','recovery_code','new_password','client_name'],['handle','recovery_code','new_password']));
    else if(method==='POST'&&p==='/auth/refresh'){const value=strict(b,['refresh_token','client_name'],['refresh_token']);result=auth.refresh(db,value.refresh_token,value.client_name)}
    else if(method==='POST'&&p==='/auth/biometric/challenge')result=auth.loginChallenge(db,strict(b,['device_id']).device_id);
    else if(method==='POST'&&p==='/auth/biometric/verify')result=auth.biometricLogin(db,strict(b,['challenge_id','signature','client_name'],['challenge_id','signature']));
    else{
     const s=auth.authenticate(db,req.headers.authorization);
     if(method==='GET'&&p==='/me')result=accounts.profile(db,s);
     else if(method==='POST'&&p==='/me/profile')result=accounts.updateProfile(db,s,strict(b,['display_name']));
     else if(method==='POST'&&p==='/me/password')result=await accounts.changePassword(db,s,strict(b,['current_password','new_password']));
     else if(method==='POST'&&p==='/recovery-codes/rotate')result=await accounts.rotateRecoveryCodes(db,s,strict(b,['password']));
     else if(method==='GET'&&p==='/sessions')result=accounts.listSessions(db,s);
     else if(method==='POST'&&p==='/sessions/logout-others'){strict(b,[]);result=accounts.logoutOthers(db,s)}
     else if(method==='POST'&&p==='/sessions/logout-all'){strict(b,[]);result=accounts.logoutAll(db,s)}
     else if(method==='POST'&&p==='/admin/registration-invites')result=accounts.createInvite(db,s,strict(b,['role','expires_in_seconds']));
     else if(method==='POST'&&p==='/auth/logout'){strict(b,[]);result=auth.logout(db,s)}
     else if(method==='POST'&&p==='/auth/reauthenticate')result=await auth.reauthenticate(db,s,strict(b,['password']).password);
     else if(method==='GET'&&p==='/wallet')result=atomic(db,()=>({...ledger.balance(db,s.user_id),...ledger.history(db,s.user_id,{before:url.searchParams.get('before'),limit:Number(url.searchParams.get('limit')??20),kind:url.searchParams.get('kind'),direction:url.searchParams.get('direction')}),unread_notifications:notifications.unreadCount(db,s.user_id),as_of:now()}));
     else if(method==='GET'&&p==='/notifications')result=notifications.listNotifications(db,s.user_id,{before:url.searchParams.get('before'),limit:Number(url.searchParams.get('limit')??20)});
     else if(method==='POST'&&p==='/notifications/read-all'){strict(b,[]);result=notifications.markAllRead(db,s.user_id)}
     else if(method==='GET'&&p==='/recipients')result=payments.lookupRecipient(db,url.searchParams.get('handle'));
     else if(method==='GET'&&p==='/devices')result={devices:auth.listDevices(db,s.user_id)};
     else if(method==='POST'&&p==='/devices/challenge')result=auth.enrollChallenge(db,s,strict(b,['public_key','label']));
     else if(method==='POST'&&p==='/devices/enroll')result=auth.enroll(db,s,strict(b,['challenge_id','signature']),key);
     else if(method==='POST'&&p==='/transfers/prepare')result=payments.prepareTransfer(db,s,strict(b,['recipient_handle','amount','currency','pocket'],['recipient_handle','amount']),key);
     else if(method==='POST'&&p==='/payment-requests')result=payments.createRequest(db,s.user_id,strict(b,['amount','channel','currency','pocket'],['amount']),key);
     else if(method==='POST'&&p==='/payment-requests/resolve')result=payments.resolveRequest(db,strict(b,['payload']).payload);
     else{
      const receipt=p.match(/^\/transactions\/([a-f0-9]{32})$/),refund=p.match(/^\/transactions\/([a-f0-9]{32})\/refunds(?:\/(challenge))?$/),notification=p.match(/^\/notifications\/([a-f0-9]{32})\/read$/),device=p.match(/^\/devices\/([a-f0-9]{32})$/),session=p.match(/^\/sessions\/([a-f0-9]{32})$/),intent=p.match(/^\/intents\/([a-f0-9]{32})(?:\/(challenge|confirm|code|cancel))?$/);
      if(refund&&method==='POST'&&refund[2]==='challenge')result=refunds.refundChallenge(db,s,refund[1],strict(b,['amount','device_id','currency','pocket'],['amount','device_id']));
      else if(refund&&method==='POST')result=refunds.createRefund(db,s,refund[1],strict(b,['amount','challenge_id','signature','currency','pocket'],['amount','challenge_id','signature']),key);
      else if(receipt&&method==='GET')result=ledger.receipt(db,s.user_id,receipt[1]);
      else if(notification&&method==='POST'){strict(b,[]);result=notifications.markRead(db,s.user_id,notification[1])}
      else if(device&&method==='DELETE')result=auth.revokeDevice(db,s,device[1]);
      else if(session&&method==='DELETE')result=accounts.revokeSession(db,s,session[1]);
      else if(intent){const [,id,action]=intent;
       if(method==='GET'&&!action)result=payments.ownIntent(db,s.user_id,id);
       else if(method==='GET'&&action==='code'){result=payments.requestPayload(db,s.user_id,id);result.qr_svg=await QRCode.toString(result.payload,{type:'svg',errorCorrectionLevel:'M',margin:2})}
       else if(method==='POST'&&action==='challenge')result=payments.confirmationChallenge(db,s,id,strict(b,['device_id']).device_id);
       else if(method==='POST'&&action==='confirm')result=payments.confirm(db,s,id,strict(b,['challenge_id','signature']),key);
       else if(method==='POST'&&action==='cancel'){strict(b,[]);result=payments.cancel(db,s,id,key)}else assert(false,404,'ENDPOINT_NOT_FOUND');
      }else assert(false,404,'ENDPOINT_NOT_FOUND');
     }
    }
    return send(res,200,result,requestId);
   }
   if(url.pathname==='/openapi.json'&&method==='GET')return send(res,200,JSON.parse(fs.readFileSync(path.join(root,'docs/api/mobile.openapi.json'),'utf8')),requestId);
   if(url.pathname==='/'&&method==='GET'){res.writeHead(302,{Location:'/lab'});res.end();return}
   assert(method==='GET'||method==='HEAD',405,'METHOD_NOT_ALLOWED');const dist=path.join(root,'dist'),asset=url.pathname.startsWith('/assets/')?path.resolve(dist,'.'+url.pathname):path.join(dist,'index.html');assert(asset.startsWith(dist+path.sep),404,'NOT_FOUND');assert(fs.existsSync(asset),503,'WEB_BUILD_REQUIRED');res.writeHead(200,{'Content-Type':asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:fs.readFileSync(asset));
  }catch(e){const status=e.status??500;if(status===500)console.error('[VAL mobile]',requestId,e.code??e.name);if(status===429)res.setHeader('Retry-After','60');send(res,status,{error:status===500?'INTERNAL_ERROR':e.code,request_id:requestId},requestId)}
 });
 return {server,db,close:()=>new Promise(resolve=>{server.close(()=>{if(closeDatabase)db.close();resolve()});server.closeIdleConnections()})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=getPorts().wallet,file=path.resolve(process.env.VAL_LAB_DATABASE??path.join(root,'.local/val-lab.sqlite'));assert(fs.existsSync(file),400,'RUN_SERVER_INIT_FIRST');const host=process.env.VAL_MOBILE_HOST??'127.0.0.1';assert(host==='127.0.0.1'||process.env.VAL_ALLOW_INSECURE_LAB==='1',400,'HTTPS_PROXY_REQUIRED');
 const app=createPlatformServer({db:openPlatformDb(file),publicOrigin:process.env.VAL_PUBLIC_ORIGIN??null});try{await listenFixed(app.server,port,host,'EV-wallet utama');console.log(`EV-wallet VAL Lab: http://${host}:${port}/lab · API ${prefix} · SQLite persisten`)}catch(error){await app.close();console.error(error.message);process.exitCode=1}for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await app.close();process.exit(0)});
}
