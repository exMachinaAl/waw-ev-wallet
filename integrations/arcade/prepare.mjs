// Read-only reference â†’ isolated, generated integration fixture. Never patch the source directory.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'.local','arcade');
const moduleUrl=rel=>pathToFileURL(path.join(root,rel)).href;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function replace(source,from,to){if(!source.includes(from))throw new Error('Unsupported Arcade source; missing integration anchor: '+from.slice(0,80));return source.replace(from,to)}

export function prepareArcade(reference){
 const source=fs.realpathSync(reference),destination=path.resolve(output);
 if(source.toLowerCase()===destination.toLowerCase()||source.toLowerCase().startsWith(destination.toLowerCase()+path.sep)||destination.toLowerCase().startsWith(source.toLowerCase()+path.sep))throw new Error('Source and fixture must be separate directories');
 const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
 if(pkg.name!=='world-arcade-engine'||pkg.version!=='1.0.0-rc.3')throw new Error('Adapter verified for WORLD Arcade Engine 1.0.0-rc.3 only');
 fs.mkdirSync(path.join(destination,'src'),{recursive:true});
 // A failed preparation must not leave a previous success marker on partial output.
 fs.rmSync(path.join(destination,'integration-manifest.json'),{force:true});
 const manifest={source_version:pkg.version,prepared_ms:Date.now(),files:{}};
 for(const filename of fs.readdirSync(path.join(source,'src')).filter(name=>name.endsWith('.mjs'))){
  const relative='src/'+filename,bytes=fs.readFileSync(path.join(source,relative));manifest.files[relative]=digest(bytes);
  fs.writeFileSync(path.join(destination,relative),bytes);
 }
 // Tests can build the existing Arcade UI from source using this project's dependencies.
 function copySource(from,to){fs.mkdirSync(to,{recursive:true});for(const e of fs.readdirSync(from,{withFileTypes:true})){if(['node_modules','.env','dist','web-dist','.git'].includes(e.name)||e.name.startsWith('.env.'))continue;const src=path.join(from,e.name),dst=path.join(to,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())copySource(src,dst);else{const data=fs.readFileSync(src);fs.writeFileSync(dst,data);manifest.files[path.relative(source,src).replaceAll('\\','/')]=digest(data)}}}
 copySource(path.join(source,'web'),path.join(destination,'web'));
 fs.mkdirSync(path.join(destination,'tests'),{recursive:true});
 for(const name of fs.readdirSync(path.join(source,'tests')).filter(name=>name.endsWith('.test.mjs'))){const rel='tests/'+name,bytes=fs.readFileSync(path.join(source,rel));manifest.files[rel]=digest(bytes);fs.writeFileSync(path.join(destination,rel),bytes);}
 // Only the adapter source is copied; optional patches, credentials and WA sessions are excluded.
 const waRel='integrations/wa-world/adapter.mjs';fs.mkdirSync(path.join(destination,'integrations','wa-world'),{recursive:true});const waSource=fs.readFileSync(path.join(source,waRel),'utf8');manifest.files[waRel]=digest(waSource);
 fs.writeFileSync(path.join(destination,waRel),replace(waSource,'{subject,game_code:codes[op],bet}',"{subject,game_code:codes[op],bet,command_id:`wa:create:${messageId||randomUUID()}`}"));
 fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({...pkg,scripts:{start:'node --experimental-sqlite src/server.mjs'}},null,2));
 fs.writeFileSync(path.join(destination,'src','db.mjs'),`// Generated bridge: VAL owns ledger operations; Arcade owns game state.\nexport * from '${moduleUrl('src/db.mjs')}';\n`);
 for(const name of ['admin','blackjack-tables','games','lottery','number-draw','rooms','roulette-rounds','stake-policy']){
  const file=path.join(destination,'src',name+'.mjs');let s=fs.readFileSync(file,'utf8');
  s=s.replace(/import \{([^}]+)\} from '\.\/db\.mjs';/g,(_,items)=>`import {${items.split(',').filter(x=>x!=='transfer').join(',')}} from './db.mjs';`);
  s=`import {postTransfer as transfer} from '${moduleUrl('src/val/ledger.mjs')}';\n`+s;
  if(name==='admin')s=replace(s,'const result=transfer(db,{',"const result=transfer(db,{kind:'CORRECTION',");
  if(['games','rooms','blackjack-tables'].includes(name))s=`import {bindCommand} from '${moduleUrl('src/val/commands.mjs')}';\n`+s;
  if(name==='games'){
   s=replace(s,'  const previous=db.prepare(',"  bindCommand(db,playerId,command.command_id,{operation:'game.action',sessionId,...command});\n  const previous=db.prepare(");
   s=replace(s,'tenantFor} from','tenantFor,once} from');s=replace(s,'export function createGame(db,playerId,gameCode,bet=10){','export function createGame(db,playerId,gameCode,bet=10,commandId=null){');
   const a=s.indexOf('export function createGame('),b=s.indexOf('\nfunction ',a);let part=s.slice(a,b);part=replace(part,' return transaction(db,()=>{',' const create=()=>{');const end=part.lastIndexOf(' });');if(end<0)throw Error('Missing createGame transaction');
   part=part.slice(0,end)+" };\n return commandId?once(db,playerId,commandId,{operation:'game.create',gameCode,bet},create):transaction(db,create);"+part.slice(end+4);s=s.slice(0,a)+part+s.slice(b);
  }
  if(name==='rooms'){
   s=replace(s,"  const prior=db.prepare('SELECT room_id","  bindCommand(db,playerId,command_id,{operation:'room.create',bet});\n  const prior=db.prepare('SELECT room_id");
   s=replace(s,'  const room=findRoom(db,String(code).toUpperCase()',"  bindCommand(db,playerId,command_id,{operation:'room.join',code:String(code).toUpperCase(),expected_version});\n  const room=findRoom(db,String(code).toUpperCase()");
   s=replace(s,'  commandId(command_id);',"  commandId(command_id);\n  bindCommand(db,playerId,command_id,{operation:'room.action',id,action,expected_version});");
  }
  if(name==='blackjack-tables'){
   s=replace(s,"  const prior=db.prepare('SELECT table_id","  bindCommand(db,p,command_id,{operation:'blackjack.create',bet});\n  const prior=db.prepare('SELECT table_id");
   const a=s.indexOf('export function joinBlackjackTable'),b=s.indexOf('export function blackjackTableAction');
   s=s.slice(0,a)+replace(s.slice(a,b),'  const t=table(db,ref,p,false),prior=',"  bindCommand(db,p,command_id,{operation:'blackjack.join',ref,expected_version});\n  const t=table(db,ref,p,false),prior=")+replace(s.slice(b),'  const t=table(db,ref,p,false),prior=',"  bindCommand(db,p,command_id,{operation:'blackjack.action',ref,action,expected_version,confirm_forfeit});\n  const t=table(db,ref,p,false),prior=");
  }
  if(name==='stake-policy'){
   s=`import {canonical} from '${moduleUrl('src/val/commands.mjs')}';\n`+s;s=replace(s,'digest(json(payload))','digest(json(canonical(payload)))');
   const start=s.indexOf('export function reserve('),end=s.indexOf('export function treasuryStatus',start);if(start<0||end<0)throw Error('Reserve bridge anchor missing');
   s=s.slice(0,start)+`export {reserve,releaseReserve} from '${moduleUrl('src/val/reserves.mjs')}';\n\n`+s.slice(end);
  }
  fs.writeFileSync(file,s);
 }
 const serverFile=path.join(destination,'src/server.mjs');let server=fs.readFileSync(serverFile,'utf8');server=replace(server,'\ngetEnv();','');server=server.replaceAll('b.game_code,b.bet)','b.game_code,b.bet,b.command_id)');fs.writeFileSync(serverFile,server);
 const appFile=path.join(destination,'web/src/App.jsx');let app=fs.readFileSync(appFile,'utf8');app=replace(app,'{game_code:code,bet}','{game_code:code,bet,command_id:crypto.randomUUID()}');fs.writeFileSync(appFile,app);
 const panelFile=path.join(destination,'web/src/components/GamePanel.jsx');let panel=fs.readFileSync(panelFile,'utf8');panel=replace(panel,'{AUTO_GAMES.has(code)&&<div className="auto-spin-panel"','{false&&<div className="auto-spin-panel"');fs.writeFileSync(panelFile,panel);
 // Verify source remained byte-for-byte unchanged. No .env/data/WA credentials were copied.
 for(const [rel,hash] of Object.entries(manifest.files))if(digest(fs.readFileSync(path.join(source,rel)))!==hash)throw new Error('Reference changed during preparation: '+rel);
 fs.writeFileSync(path.join(destination,'integration-manifest.json'),JSON.stringify(manifest,null,2));
 return {output:destination,version:pkg.version,reference_unchanged:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const reference=process.argv[2];if(!reference)throw new Error('Usage: npm run arcade:prepare -- <read-only Arcade reference directory>');console.log(JSON.stringify(prepareArcade(reference),null,2));
}
