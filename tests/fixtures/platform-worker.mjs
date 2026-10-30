import {parentPort,workerData} from 'node:worker_threads';
import {openPlatformDb} from '../../src/platform/db.mjs';
import {authenticate} from '../../src/platform/auth.mjs';
import {confirm} from '../../src/platform/payments.mjs';
import {createRefund} from '../../src/platform/refunds.mjs';
const db=openPlatformDb(workerData.file);parentPort.postMessage('ready');
parentPort.once('message',()=>{try{const session=authenticate(db,'Bearer '+workerData.access),result=workerData.operation==='refund'?createRefund(db,session,workerData.original,{amount:workerData.amount,...workerData.proof},workerData.key):confirm(db,session,workerData.intent,workerData.proof,workerData.key);parentPort.postMessage({ok:true,result})}catch(e){parentPort.postMessage({ok:false,code:e.code})}finally{db.close()}});
