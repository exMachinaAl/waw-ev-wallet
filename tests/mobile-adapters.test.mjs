import test from 'node:test';
import assert from 'node:assert/strict';
import {biometricSigner,keychainStore,readNfcPayment,writeNfcPayment} from '../mobile/src/adapters.js';
import {ValClient} from '../mobile/src/client.js';

test('Native signing adapter rejects unavailable/cancelled sensors and passes exact challenge bytes',async()=>{
 let calls=0;const module={isSensorAvailable:async()=>({available:false}),createSignature:async()=>{calls++;return {success:false}}};
 await assert.rejects(biometricSigner(module)('challenge'),/BIOMETRICS_UNAVAILABLE/);assert.equal(calls,0);
 module.isSensorAvailable=async()=>({available:true});await assert.rejects(biometricSigner(module)('challenge'),/BIOMETRIC_CANCELLED/);
 module.createSignature=async options=>{assert.equal(options.payload,'exact UTF-8: uji ✓');return {success:true,signature:'c2lnbmF0dXJl'}};
 assert.equal(await biometricSigner(module)('exact UTF-8: uji ✓'),'c2lnbmF0dXJl');
});

test('Secure store uses device-only access; SDK requires explicit insecure Lab opt-in',async()=>{
 const records=new Map(),native={ACCESSIBLE:{WHEN_UNLOCKED_THIS_DEVICE_ONLY:'device-only'},getGenericPassword:async({service})=>records.get(service)??false,setGenericPassword:async(user,password,options)=>{assert.equal(options.accessible,'device-only');records.set(options.service,{password})},resetGenericPassword:async({service})=>records.delete(service)},store=keychainStore(native);
 await store.set('test','secret-fixture');assert.equal(await store.get('test'),'secret-fixture');await store.remove('test');assert.equal(await store.get('test'),null);
 assert.throws(()=>new ValClient({baseUrl:'http://localhost:3212',secureStore:store}),/HTTPS_REQUIRED/);assert.doesNotThrow(()=>new ValClient({baseUrl:'http://localhost:3212',secureStore:store,allowInsecureLab:true}));
});

test('NFC adapter only resolves NDEF URI, cleans sessions on failures and validates writes before touching hardware',async()=>{
 const uri='val-demo://pay/'+'a'.repeat(32);let started=0,cancelled=0,written=null,resolved=0;
 const modules={NfcManager:{start:async()=>{started++},requestTechnology:async()=>{},getTag:async()=>({ndefMessage:[{tnf:1,type:[0x55],payload:[1]}]}),cancelTechnologyRequest:async()=>{cancelled++},ndefHandler:{writeNdefMessage:async bytes=>{written=bytes}}},NfcTech:{Ndef:'Ndef'},Ndef:{uri:{decodePayload:()=>uri},uriRecord:value=>({uri:value}),encodeMessage:records=>{assert.equal(records[0].uri,uri);return [1,2,3]}}};
 const client={resolvePayment:async payload=>{resolved++;assert.equal(payload,uri);return {id:'preview'}}};
 assert.deepEqual(await readNfcPayment(modules,client),{id:'preview'});assert.equal(resolved,1);assert.equal(cancelled,1);
 await writeNfcPayment(modules,uri);assert.deepEqual(written,[1,2,3]);assert.equal(cancelled,2);
 await assert.rejects(writeNfcPayment(modules,'000201qris'),/INVALID_PAYMENT_CODE/);assert.equal(started,2);
 modules.NfcManager.getTag=async()=>{throw Error('tag removed')};await assert.rejects(readNfcPayment(modules,client),/tag removed/);assert.equal(cancelled,3);
 modules.NfcManager.requestTechnology=async()=>{throw Error('user cancelled')};await assert.rejects(writeNfcPayment(modules,uri),/user cancelled/);assert.equal(cancelled,4);
});
