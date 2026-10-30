import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {transaction} from '../../src/db.mjs';
import {registerValWriter} from '../../src/val/schema.mjs';
import {postTransfer} from '../../src/val/ledger.mjs';
const db=new DatabaseSync(workerData.file);registerValWriter(db);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
parentPort.postMessage('ready');
parentPort.once('message',()=>{try{parentPort.postMessage({ok:true,result:transaction(db,()=>postTransfer(db,workerData.transfer))})}catch(e){parentPort.postMessage({ok:false,code:e.code})}finally{db.close()}});
