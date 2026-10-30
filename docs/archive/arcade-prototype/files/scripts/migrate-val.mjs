// Explicit offline operation. Default is a SQLite backup into a disposable staging DB.
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateVal,registerValWriter,reconcileVal,hasValSchema} from '../src/val/schema.mjs';
const [filename,flag]=process.argv.slice(2);
if(!filename||!['--dry-run','--apply',undefined].includes(flag))throw new Error('Usage: node --experimental-sqlite scripts/migrate-val.mjs <staging.sqlite> [--dry-run|--apply]');
let db,temp;
try{
 if(flag==='--apply')db=new DatabaseSync(path.resolve(filename));
 else{
  temp=mkdtempSync(path.join(os.tmpdir(),'val-migration-'));
  const source=new DatabaseSync(path.resolve(filename),{readOnly:true});
  try{await backup(source,path.join(temp,'fixture.sqlite'));}finally{source.close();}
  db=new DatabaseSync(path.join(temp,'fixture.sqlite'));
 }
 registerValWriter(db);
 const before=reconcileVal(db,{legacy:!hasValSchema(db)});
 if(!before.ok){console.log(JSON.stringify({mode:flag??'--dry-run',applied:false,reconciliation:before},null,2));process.exitCode=1;}
 else console.log(JSON.stringify({mode:flag??'--dry-run',...migrateVal(db)},null,2));
}finally{db?.close();if(temp)rmSync(temp,{recursive:true,force:true});}
