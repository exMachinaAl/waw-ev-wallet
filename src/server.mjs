import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDb,transaction} from './db.mjs';
import {authenticate,demoSession} from './session.mjs';
import {valApi} from './val/api.mjs';
import {registerValWriter,hasValSchema} from './val/schema.mjs';
import {assert,now} from './util.mjs';
import {getPorts,listenFixed,localUrl} from './runtime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const local=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function readBody(req){let data='';for await(const chunk of req){data+=chunk;assert(Buffer.byteLength(data)<=8192,413,'BODY_TOO_LARGE')}try{const body=JSON.parse(data||'{}');assert(body&&typeof body==='object'&&!Array.isArray(body),400,'BAD_JSON');return body}catch{assert(false,400,'BAD_JSON')}}
export function connectArcadeDatabase(filename){
 // Connection only: no startup schema migration, no player creation, no balance seed.
 assert(fs.existsSync(filename),400,'DATABASE_NOT_FOUND');
 const db=new DatabaseSync(filename);registerValWriter(db);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
 if(!hasValSchema(db)){db.close();assert(false,409,'VAL_MIGRATION_REQUIRED')}
 return db;
}

export function createWalletApp({db=openDb(),demo=true,arcadeUrl=null,origin=null,secureCookie=false,closeDatabase=true}={}){
 if(arcadeUrl)assert(['http:','https:'].includes(new URL(arcadeUrl).protocol),400,'INVALID_ARCADE_URL');
 const rates=new Map();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  try{
   const base=origin??`${secureCookie?'https':'http'}://${req.headers.host}`,url=new URL(req.url,base);
   if(url.pathname.startsWith('/api/')){
    if(req.method==='POST'){
     assert(req.headers.origin===base,403,'ORIGIN_DENIED');
     const key=req.socket.remoteAddress,time=now(),prior=rates.get(key);if(!prior||time-prior.at>60000)rates.set(key,{at:time,n:1});else assert(++prior.n<=30,429,'RATE_LIMITED');
     if(rates.size>1000)for(const [k,v] of rates)if(time-v.at>60000)rates.delete(k);
    }
    if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{product:'EV-wallet VAL',version:'0.1.0',mode:demo?'local-demo':'connected',arcade_url:arcadeUrl,arcade_connected:Boolean(arcadeUrl),currency:'VAL',pocket:'arcade',public_beta_ready:false});
    if(req.method==='POST'&&url.pathname==='/api/demo-login'){
     assert(demo&&local(req.socket.remoteAddress)&&url.hostname==='127.0.0.1'&&!req.headers.forwarded&&!req.headers['x-forwarded-for']&&!req.headers['x-forwarded-host'],403,'DEMO_DISABLED');
     const s=demoSession(db);res.setHeader('Set-Cookie',`${secureCookie?'__Host-wae_session':'wae_session'}=${s.secret}; Path=/; HttpOnly; SameSite=Strict; ${secureCookie?'Secure; ':''}Max-Age=86400`);
     return send(res,200,{ok:true});
    }
    const session=authenticate(db,req.headers.cookie);
    if(req.method==='GET'&&url.pathname==='/api/me')return send(res,200,{id:session.player_id,label:demo?'Akun demo lokal':'Pemain Arcade',device:session.device_label,expires_ms:session.expires_ms});
    if(req.method==='POST'&&url.pathname==='/api/logout'){
     transaction(db,()=>db.prepare('UPDATE browser_sessions SET revoked_ms=? WHERE id=?').run(now(),session.id));
     res.setHeader('Set-Cookie',`${secureCookie?'__Host-wae_session':'wae_session'}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie?'; Secure':''}`);return send(res,200,{ok:true});
    }
    if(url.pathname.startsWith('/api/val/v1/'))return send(res,200,valApi(db,session,req.method,url.pathname.slice('/api/val/v1'.length),url.searchParams,req.method==='POST'?await readBody(req):{}));
    assert(false,404,'ENDPOINT_NOT_FOUND');
   }
   assert(req.method==='GET'||req.method==='HEAD',405,'METHOD_NOT_ALLOWED');
   const dist=path.join(root,'dist');
   const asset=url.pathname.startsWith('/assets/')?path.resolve(dist,'.'+url.pathname):path.join(dist,'index.html');
   assert(asset.startsWith(dist+path.sep),404,'NOT_FOUND');
   if(!fs.existsSync(asset))return send(res,503,{error:'WEB_BUILD_REQUIRED',message:'Jalankan npm run build terlebih dahulu.'});
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(asset)]??'application/octet-stream';
   res.writeHead(200,{'Content-Type':type,'Cache-Control':asset.endsWith('.html')?'no-cache':'public, max-age=31536000, immutable'});res.end(req.method==='HEAD'?undefined:fs.readFileSync(asset));
  }catch(e){const status=e.status??500;if(status===500)console.error('[VAL] Request failed:',e.code??e.name);send(res,status,{error:status===500?'INTERNAL_ERROR':e.code});}
 });
 return {server,db,close:()=>new Promise(resolve=>{server.close(()=>{if(closeDatabase)db.close();resolve()});server.closeIdleConnections()})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const filename=process.env.VAL_DATABASE,port=getPorts().arcadeWallet;
 const app=createWalletApp({...(filename?{db:connectArcadeDatabase(path.resolve(filename)),demo:false}:{}),arcadeUrl:process.env.VAL_ARCADE_URL??null});
 try{await listenFixed(app.server,port,'127.0.0.1','Wallet konektor Arcade');console.log(`EV-wallet VAL Arcade: ${localUrl(port)} (${filename?'connected':'demo in-memory'})`)}catch(error){await app.close();console.error(error.message);process.exitCode=1}
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0)});
}
