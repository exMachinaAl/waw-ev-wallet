import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'vite';
import {createWalletApp,connectArcadeDatabase} from '../src/server.mjs';
import {getPorts,listenFixed,localUrl} from '../src/runtime.mjs';
const ports=getPorts();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),fixture=path.join(root,'.local/arcade');
if(!fs.existsSync(path.join(fixture,'integration-manifest.json')))throw new Error('Jalankan npm run arcade:prepare -- <folder referensi Arcade> terlebih dahulu.');
await build({root:path.join(fixture,'web'),configFile:path.join(fixture,'web/vite.config.js')});
const {createApp}=await import(pathToFileURL(path.join(fixture,'src/server.mjs')));
// A fresh temporary database on every launch; no player database path is accepted here.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'val-arcade-demo-')),database=path.join(directory,'fixture.sqlite');
const arcade=createApp({database,demo:true,host:'127.0.0.1',serviceKey:''});
const wallet=createWalletApp({db:connectArcadeDatabase(database),demo:true,arcadeUrl:localUrl(ports.arcade)});
async function cleanup(){await wallet.close();await arcade.close();const target=path.resolve(directory);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep+'val-arcade-demo-'))throw Error('TEMP_DIRECTORY_OUTSIDE_SCOPE');fs.rmSync(target,{recursive:true,force:true})}
try{await listenFixed(arcade.server,ports.arcade,'127.0.0.1','Arcade fixture');await listenFixed(wallet.server,ports.arcadeWallet,'127.0.0.1','Wallet konektor Arcade');console.log(`Wallet konektor Arcade: ${localUrl(ports.arcadeWallet)}\nArcade fixture: ${localUrl(ports.arcade)}\nSatu ledger fixture, sesi browser sama; data dibuang saat demo dihentikan.`)}catch(error){await cleanup();console.error(error.message);process.exitCode=1}
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(closing)return;closing=true;await cleanup();process.exit(0)});
