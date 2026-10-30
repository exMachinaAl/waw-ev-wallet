export interface SecureStore{get(key:string):Promise<string|null>;set(key:string,value:string):Promise<void>;remove(key:string):Promise<void>}
export type Signer=(payload:string)=>Promise<string>;
export interface Receipt{id:string;sequence:number;currency:'VAL';pocket:'lab';amount:string;delta:string;status:'POSTED';kind:string;reference:string;created_ms:number;counterparty?:{handle:string;display_name:string}|null;original_transaction_id?:string|null;refund_summary?:{refunded:string;refundable:string;can_refund:boolean}|null}
export interface Intent{id:string;currency:'VAL';pocket:'lab';amount:string;recipient:{handle:string;display_name:string};status:'PENDING'|'SETTLED'|'CANCELLED'|'EXPIRED';channel:string;expires_ms:number;payload?:string;journal_id?:string|null}
export type UserRole='USER'|'MERCHANT'|'OPERATOR';
export interface Profile{id:string;handle:string;display_name:string;role:UserRole;status:'ACTIVE'|'DISABLED';created_ms:number}
export interface SessionInfo{family_id:string;session_id:string;client_name:string;created_ms:number;last_seen_ms:number;refresh_expires_ms:number;current:boolean}
export interface Notification{id:string;seq:number;event_type:string;title:string;body:string;reference:string|null;read_ms:number|null;created_ms:number}
export interface PendingPayment{id:string;key:string;proof:{challenge_id:string;signature:string};created_ms:number}
export class ValApiError extends Error{code:string;status:number;requestId?:string}
export class ValClient{
 constructor(options:{baseUrl:string;secureStore:SecureStore;fetchImpl?:typeof fetch;allowInsecureLab?:boolean;clientName?:string});
 login(handle:string,password:string):Promise<unknown>;refresh():Promise<unknown>;logout():Promise<void>;
 register(options:{inviteCode:string;handle:string;displayName:string;password:string}):Promise<{profile:Profile;recovery_codes:string[]} & Record<string,unknown>>;
 recover(options:{handle:string;recoveryCode:string;newPassword:string}):Promise<{profile:Profile;recovery_codes:string[]} & Record<string,unknown>>;
 reauthenticate(password:string):Promise<{authenticated:true}>;
 me():Promise<Profile>;updateProfile(displayName:string):Promise<Profile>;
 changePassword(currentPassword:string,newPassword:string):Promise<{changed:true;other_sessions_revoked:true}>;
 rotateRecoveryCodes(password:string):Promise<{recovery_codes:string[]}>;
 sessions():Promise<{sessions:SessionInfo[]}>;logoutOthers():Promise<{revoked_sessions:number}>;logoutAll():Promise<{revoked_sessions:number}>;revokeSession(id:string):Promise<{revoked:true;current:boolean}>;
 createRegistrationInvite(role?:'USER'|'MERCHANT',expiresInSeconds?:string):Promise<{invite_id:string;invite_code:string;role:string;expires_ms:number}>;
 wallet(options?:string|{before?:string;kind?:'TRANSFER'|'PAYMENT'|'REFUND'|'INITIAL_CREDIT';direction?:'IN'|'OUT';limit?:number}):Promise<{currency:'VAL';pocket:'lab';posted:string;held:string;available:string;transactions:Receipt[];next_cursor:string|null;unread_notifications:number}>;
 notifications(before?:string):Promise<{notifications:Notification[];next_cursor:string|null;unread:number}>;readNotification(id:string):Promise<{read:true;unread:number}>;readAllNotifications():Promise<{read:number;unread:0}>;
 recipient(handle:string):Promise<{handle:string;display_name:string}>;
 devices():Promise<{devices:unknown[]}>;revokeDevice(id:string):Promise<{revoked:true}>;
 enrollDevice(options:{publicKey:string;sign:Signer;label:string;key:string}):Promise<{device_id:string}>;
 biometricLogin(sign:Signer):Promise<unknown>;
 prepareTransfer(handle:string,amount:string,key:string):Promise<Intent>;
 requestPayment(amount:string,channel:'QR_VAL_DEMO'|'NFC_VAL_DEMO',key:string):Promise<Intent>;
 resolvePayment(payload:string):Promise<Intent>;code(id:string):Promise<{payload:string;qr_svg:string;nfc:{uri:string}}>;
 intent(id:string):Promise<Intent>;receipt(id:string):Promise<Receipt>;
 signConfirmation(id:string,sign:Signer):Promise<{challenge_id:string;signature:string}>;
 createPendingConfirmation(id:string,sign:Signer,key:string):Promise<PendingPayment>;pendingPayment():Promise<PendingPayment|null>;clearPendingPayment():Promise<void>;
 confirm(id:string,proof:{challenge_id:string;signature:string},key:string):Promise<{status:'SETTLED';intent_id:string;receipt:Receipt}>;
 confirmPending(pending?:PendingPayment|null):Promise<{status:'SETTLED';intent_id:string;receipt:Receipt}>;enquirePending():Promise<{intent:Intent;receipt:Receipt|null}|null>;
 signRefund(transactionId:string,amount:string,sign:Signer):Promise<{challenge_id:string;signature:string}>;refund(transactionId:string,amount:string,proof:{challenge_id:string;signature:string},key:string):Promise<{status:'REFUNDED';receipt:Receipt;remaining_refundable:string}>;
 cancel(id:string,key:string):Promise<Intent>;
}
