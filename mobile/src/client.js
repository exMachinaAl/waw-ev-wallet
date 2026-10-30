/** Framework-independent API client: works with React Native fetch and injected secure storage. */
export class ValApiError extends Error{constructor(code,status,requestId){super(code);this.code=code;this.status=status;this.requestId=requestId}}
export class ValClient{
 constructor({baseUrl,secureStore,fetchImpl=globalThis.fetch,allowInsecureLab=false,clientName='React Native'}){
  if(!/^https:\/\//.test(baseUrl)&&!(allowInsecureLab&&/^http:\/\//.test(baseUrl)))throw Error('HTTPS_REQUIRED');
  this.baseUrl=baseUrl.replace(/\/$/,'')+'/api/mobile/v1';this.store=secureStore;this.fetch=(...args)=>fetchImpl(...args);this.access=null;this.userId=null;this.refreshing=null;this.clientName=clientName;
 }
 async request(method,route,body,{key,auth=true,retryAuth=true}={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);let response;
  try{response=await this.fetch(this.baseUrl+route,{method,credentials:'omit',headers:{'Content-Type':'application/json',...(auth&&this.access?{Authorization:'Bearer '+this.access}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal})}catch(e){throw new ValApiError(e.name==='AbortError'?'STATUS_UNKNOWN':'NETWORK_ERROR',0)}finally{clearTimeout(timeout)}
  let value;try{value=await response.json()}catch{throw new ValApiError('INVALID_SERVER_RESPONSE',response.status)}
  if(response.status===401&&value.error==='AUTH_REQUIRED'&&auth&&retryAuth){await this.refresh();return this.request(method,route,body,{key,auth,retryAuth:false})}
  if(!response.ok)throw new ValApiError(value.error??'REQUEST_FAILED',response.status,value.request_id);return value;
 }
 async saveSession(session){this.access=session.access_token;this.userId=session.user_id;await this.store.set('val.refresh',session.refresh_token);await this.store.set('val.last-user',session.user_id);return session}
 async login(handle,password){return this.saveSession(await this.request('POST','/auth/login',{handle,password,client_name:this.clientName},{auth:false}))}
 async register({inviteCode,handle,displayName,password}){return this.saveSession(await this.request('POST','/auth/register',{invite_code:inviteCode,handle,display_name:displayName,password,client_name:this.clientName},{auth:false}))}
 async recover({handle,recoveryCode,newPassword}){return this.saveSession(await this.request('POST','/auth/recover',{handle,recovery_code:recoveryCode,new_password:newPassword,client_name:this.clientName},{auth:false}))}
 reauthenticate(password){return this.request('POST','/auth/reauthenticate',{password})}
 async refresh(){if(this.refreshing)return this.refreshing;this.refreshing=(async()=>{const refresh_token=await this.store.get('val.refresh');if(!refresh_token)throw new ValApiError('LOGIN_REQUIRED',401);try{return await this.saveSession(await this.request('POST','/auth/refresh',{refresh_token,client_name:this.clientName},{auth:false}))}catch(e){this.access=null;await this.store.remove('val.refresh');throw e}})();try{return await this.refreshing}finally{this.refreshing=null}}
 async logout(){try{await this.request('POST','/auth/logout',{})}finally{this.access=null;this.userId=null;await this.store.remove('val.refresh');await this.store.remove('val.last-user')}}
 me(){return this.request('GET','/me')}
 updateProfile(displayName){return this.request('POST','/me/profile',{display_name:displayName})}
 changePassword(currentPassword,newPassword){return this.request('POST','/me/password',{current_password:currentPassword,new_password:newPassword})}
 rotateRecoveryCodes(password){return this.request('POST','/recovery-codes/rotate',{password})}
 sessions(){return this.request('GET','/sessions')}
 logoutOthers(){return this.request('POST','/sessions/logout-others',{})}
 async logoutAll(){try{return await this.request('POST','/sessions/logout-all',{})}finally{this.access=null;this.userId=null;await this.store.remove('val.refresh');await this.store.remove('val.last-user')}}
 async revokeSession(id){const result=await this.request('DELETE','/sessions/'+encodeURIComponent(id));if(result.current){this.access=null;this.userId=null;await this.store.remove('val.refresh');await this.store.remove('val.last-user')}return result}
 createRegistrationInvite(role='USER',expiresInSeconds='86400'){return this.request('POST','/admin/registration-invites',{role,expires_in_seconds:String(expiresInSeconds)})}
 wallet(options={}){if(typeof options==='string')options={before:options};const query=new URLSearchParams();for(const name of ['before','kind','direction','limit'])if(options[name]!==undefined&&options[name]!==null&&options[name]!=='')query.set(name,String(options[name]));return this.request('GET','/wallet'+(query.size?'?'+query:''))}
 notifications(before){return this.request('GET','/notifications'+(before?'?before='+encodeURIComponent(before):''))}
 readNotification(id){return this.request('POST','/notifications/'+encodeURIComponent(id)+'/read',{})}
 readAllNotifications(){return this.request('POST','/notifications/read-all',{})}
 recipient(handle){return this.request('GET','/recipients?handle='+encodeURIComponent(handle))}
 devices(){return this.request('GET','/devices')}
 revokeDevice(id){return this.request('DELETE','/devices/'+encodeURIComponent(id))}
 async enrollDevice({publicKey,sign,label,key}){const c=await this.request('POST','/devices/challenge',{public_key:publicKey,label});const signature=await sign(c.payload);const result=await this.request('POST','/devices/enroll',{challenge_id:c.challenge_id,signature},{key});await this.store.set('val.device',result.device_id);return result}
 async biometricLogin(sign){const device_id=await this.store.get('val.device');if(!device_id)throw Error('DEVICE_ENROLLMENT_REQUIRED');const c=await this.request('POST','/auth/biometric/challenge',{device_id},{auth:false});const signature=await sign(c.payload);return this.saveSession(await this.request('POST','/auth/biometric/verify',{challenge_id:c.challenge_id,signature,client_name:this.clientName},{auth:false}))}
 prepareTransfer(recipient_handle,amount,key){return this.request('POST','/transfers/prepare',{recipient_handle,amount,currency:'VAL',pocket:'lab'},{key})}
 requestPayment(amount,channel,key){return this.request('POST','/payment-requests',{amount,channel,currency:'VAL',pocket:'lab'},{key})}
 resolvePayment(payload){if(!/^val-demo:\/\/pay\/[A-Za-z0-9_-]{32}$/.test(payload))throw Error(payload.startsWith('000201')?'QRIS_NOT_SUPPORTED':'INVALID_PAYMENT_CODE');return this.request('POST','/payment-requests/resolve',{payload})}
 code(id){return this.request('GET','/intents/'+encodeURIComponent(id)+'/code')}
 intent(id){return this.request('GET','/intents/'+encodeURIComponent(id))}
 receipt(id){return this.request('GET','/transactions/'+encodeURIComponent(id))}
 async signConfirmation(id,sign){const device_id=await this.store.get('val.device');if(!device_id)throw Error('DEVICE_ENROLLMENT_REQUIRED');const challenge=await this.request('POST','/intents/'+encodeURIComponent(id)+'/challenge',{device_id});return {challenge_id:challenge.challenge_id,signature:await sign(challenge.payload)}}
 async pendingKey(){const user=this.userId??await this.store.get('val.last-user');return user?'val.pending-payment:'+user:null}
 async createPendingConfirmation(id,sign,key){const storageKey=await this.pendingKey();if(!storageKey)throw new ValApiError('LOGIN_REQUIRED',401);const pending={id,key,proof:await this.signConfirmation(id,sign),created_ms:Date.now()};await this.store.set(storageKey,JSON.stringify(pending));return pending}
 async pendingPayment(){const storageKey=await this.pendingKey();if(!storageKey)return null;const raw=await this.store.get(storageKey);if(!raw)return null;try{const value=JSON.parse(raw);if(typeof value.id!=='string'||typeof value.key!=='string'||typeof value.proof?.challenge_id!=='string'||typeof value.proof?.signature!=='string')throw Error();return value}catch{await this.store.remove(storageKey);throw new ValApiError('PENDING_PAYMENT_CORRUPT',0)}}
 async clearPendingPayment(){const storageKey=await this.pendingKey();if(storageKey)await this.store.remove(storageKey)}
 // Keep this body and key after a timeout. Retry the SAME request, or enquire via intent(id).
 confirm(id,proof,key){return this.request('POST','/intents/'+encodeURIComponent(id)+'/confirm',proof,{key})}
 async confirmPending(pending=null){const value=pending??await this.pendingPayment();if(!value)throw new ValApiError('NO_PENDING_PAYMENT',409);const result=await this.confirm(value.id,value.proof,value.key);await this.clearPendingPayment();return result}
 async enquirePending(){const pending=await this.pendingPayment();if(!pending)return null;const current=await this.intent(pending.id);if(current.status==='SETTLED'){const result={intent:current,receipt:await this.receipt(current.journal_id)};await this.clearPendingPayment();return result}if(['CANCELLED','EXPIRED'].includes(current.status))await this.clearPendingPayment();return {intent:current,receipt:null}}
 async signRefund(transactionId,amount,sign){const device_id=await this.store.get('val.device');if(!device_id)throw Error('DEVICE_ENROLLMENT_REQUIRED');const challenge=await this.request('POST','/transactions/'+encodeURIComponent(transactionId)+'/refunds/challenge',{amount,device_id,currency:'VAL',pocket:'lab'});return {challenge_id:challenge.challenge_id,signature:await sign(challenge.payload)}}
 refund(transactionId,amount,proof,key){return this.request('POST','/transactions/'+encodeURIComponent(transactionId)+'/refunds',{amount,...proof,currency:'VAL',pocket:'lab'},{key})}
 async cancel(id,key){const result=await this.request('POST','/intents/'+encodeURIComponent(id)+'/cancel',{}, {key});const pending=await this.pendingPayment().catch(()=>null);if(pending?.id===id)await this.clearPendingPayment();return result}
}
