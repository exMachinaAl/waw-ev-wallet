/** Inject native modules so core SDK never assumes availability of fingerprint/NFC hardware. */
export function biometricSigner(rnBiometrics){return async payload=>{
 const available=await rnBiometrics.isSensorAvailable();if(!available.available)throw Error('BIOMETRICS_UNAVAILABLE');
 const result=await rnBiometrics.createSignature({promptMessage:'Konfirmasi EV-wallet VAL',payload,cancelButtonText:'Batal'});
 if(!result.success||!result.signature)throw Error('BIOMETRIC_CANCELLED');return result.signature;
}}
export function keychainStore(Keychain){return {
 async get(key){const row=await Keychain.getGenericPassword({service:key});return row?row.password:null},
 async set(key,value){await Keychain.setGenericPassword('val',value,{service:key,accessible:Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY})},
 async remove(key){await Keychain.resetGenericPassword({service:key})},
}}
// Scan/tap only resolves a request. The caller must display preview and ask for confirmation.
export async function readNfcPayment({NfcManager,NfcTech,Ndef},client){
 await NfcManager.start();try{
  await NfcManager.requestTechnology(NfcTech.Ndef);const tag=await NfcManager.getTag();
  const record=tag?.ndefMessage?.find(r=>r.tnf===1&&r.type?.length===1&&r.type[0]===0x55);if(!record)throw Error('NFC_VAL_URI_REQUIRED');
  const payload=Ndef.uri.decodePayload(record.payload);return client.resolvePayment(payload);
 }finally{await NfcManager.cancelTechnologyRequest().catch(()=>{})}
}
export async function writeNfcPayment({NfcManager,NfcTech,Ndef},payload){
 if(!/^val-demo:\/\/pay\/[A-Za-z0-9_-]{32}$/.test(payload))throw Error('INVALID_PAYMENT_CODE');
 await NfcManager.start();try{await NfcManager.requestTechnology(NfcTech.Ndef);const bytes=Ndef.encodeMessage([Ndef.uriRecord(payload)]);if(!bytes)throw Error('NDEF_ENCODE_FAILED');await NfcManager.ndefHandler.writeNdefMessage(bytes)}finally{await NfcManager.cancelTechnologyRequest().catch(()=>{})}
}
