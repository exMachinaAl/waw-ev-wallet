import fs from 'node:fs';

const defaults=JSON.parse(fs.readFileSync(new URL('../config/ports.json',import.meta.url),'utf8'));
export function getPorts(env=process.env){
 if(env.VAL_PORT&&env.VAL_MOBILE_PORT&&env.VAL_PORT!==env.VAL_MOBILE_PORT)throw Error('VAL_PORT dan alias VAL_MOBILE_PORT berbeda; gunakan satu nilai.');
 const values={wallet:env.VAL_PORT??env.VAL_MOBILE_PORT??defaults.wallet,arcadeWallet:env.VAL_ARCADE_WALLET_PORT??defaults.arcadeWallet,arcade:env.VAL_ARCADE_PORT??defaults.arcade,webDev:env.VAL_WEB_PORT??defaults.webDev};
 const ports=Object.fromEntries(Object.entries(values).map(([name,value])=>{if(!/^\d+$/.test(String(value))||!Number.isInteger(Number(value))||Number(value)<1||Number(value)>65535)throw Error(`Port ${name} tidak valid: gunakan integer 1–65535.`);return [name,Number(value)]}));
 if(new Set(Object.values(ports)).size!==Object.values(ports).length)throw Error('Port layanan harus berbeda. Periksa config/ports.json atau environment VAL_*_PORT.');
 return Object.freeze(ports);
}
export const localUrl=port=>`http://127.0.0.1:${port}`;
export function listenFixed(server,port,host,label){return new Promise((resolve,reject)=>{
 const failed=error=>{server.off('listening',ready);reject(error.code==='EADDRINUSE'?new Error(`${label}: port ${port} sudah digunakan. Layanan tidak berpindah port otomatis. Gunakan proses yang sudah berjalan, atau ubah config/ports.json/environment secara eksplisit.`):error)};
 const ready=()=>{server.off('error',failed);resolve()};server.once('error',failed);server.once('listening',ready);server.listen(port,host);
})}
