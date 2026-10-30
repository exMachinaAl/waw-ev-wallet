import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
export const now=()=>Date.now();
export const uuid=()=>randomBytes(16).toString('hex');
export const token=(n=32)=>randomBytes(n).toString('base64url');
export const digest=s=>createHash('sha256').update(String(s)).digest('hex');
export const code=()=>String(randomInt(0,1000000)).padStart(6,'0');
export const json=x=>JSON.stringify(x);
export const parse=s=>JSON.parse(s);
export const equal=(a,b)=>{
  const aa=Buffer.from(String(a??'')); const bb=Buffer.from(String(b??''));
  return aa.length===bb.length && timingSafeEqual(aa,bb);
};
export class HttpError extends Error { constructor(status,code,message) {super(message||code);this.status=status;this.code=code;} }
export const fail=(status,code,message)=>{throw new HttpError(status,code,message);};
export const assert=(condition,status,code)=>{if(!condition)fail(status,code);};
export function compactText(s,max=90){return String(s??'').replace(/[\x00-\x1f]/g,' ').slice(0,max)}
