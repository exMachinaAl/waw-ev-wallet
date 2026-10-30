import type {SecureStore, Signer, ValClient, Intent} from './index';
export function biometricSigner(module: {
 isSensorAvailable(): Promise<{available: boolean}>;
 createSignature(options: {promptMessage: string; payload: string; cancelButtonText: string}): Promise<{success: boolean; signature?: string}>;
}): Signer;
export function keychainStore(module: {
 ACCESSIBLE: {WHEN_UNLOCKED_THIS_DEVICE_ONLY: string};
 getGenericPassword(options: {service: string}): Promise<false | {password: string}>;
 setGenericPassword(user: string, password: string, options: {service: string; accessible: any}): Promise<unknown>;
 resetGenericPassword(options: {service: string}): Promise<unknown>;
}): SecureStore;
export interface NfcModules {
 NfcManager: {
  start(): Promise<unknown>;
  requestTechnology(technology: any): Promise<unknown>;
  getTag(): Promise<{ndefMessage?: {tnf: number; type: number[]; payload: number[]}[]} | null>;
  cancelTechnologyRequest(): Promise<unknown>;
  ndefHandler: {writeNdefMessage(bytes: number[]): Promise<unknown>};
 };
 NfcTech: {Ndef: string};
 Ndef: {uri: {decodePayload(payload: number[]): string}; uriRecord(uri: string): any; encodeMessage(records: any[]): number[] | null};
}
export function readNfcPayment(modules: NfcModules, client: Pick<ValClient, 'resolvePayment'>): Promise<Intent>;
export function writeNfcPayment(modules: NfcModules, payload: string): Promise<void>;
