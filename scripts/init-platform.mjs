import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openPlatformDb} from '../src/platform/db.mjs';
import {seedLab} from '../src/platform/seed.mjs';
import {reconcile} from '../src/platform/ledger.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),file=path.resolve(process.env.VAL_LAB_DATABASE??path.join(root,'.local/val-lab.sqlite')),db=openPlatformDb(file);
try{
 const credentials=await seedLab(db),report=reconcile(db);if(!report.ok)throw Error('RECONCILIATION_FAILED');
 const target=path.join(root,'.local/test-accounts.json');fs.mkdirSync(path.dirname(target),{recursive:true});
 if(credentials.accounts.length||credentials.service){let old={accounts:[]};if(fs.existsSync(target))old=JSON.parse(fs.readFileSync(target,'utf8'));fs.writeFileSync(target,JSON.stringify({...old,...credentials,accounts:[...(old.accounts??[]).filter(a=>!credentials.accounts.some(n=>n.handle===a.handle)),...credentials.accounts],service:credentials.service??old.service},null,2),{mode:0o600});}
 console.log(`SQLite siap: ${file}\nAkun uji: alice.test, bob.test, merchant.test, operator.test\nPassword/service credential tersimpan lokal: ${target}\nInisialisasi ulang tidak mereset saldo atau password. Rekonsiliasi: PASS.`);
}finally{db.close()}
