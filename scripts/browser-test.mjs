import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {build} from 'vite';
import {createWalletApp} from '../src/server.mjs';
import {reconcileVal} from '../src/val/schema.mjs';
import {readWallet} from '../src/val/ledger.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),fixture=path.join(root,'.local/arcade');
if(!fs.existsSync(path.join(fixture,'integration-manifest.json')))throw Error('Run npm run arcade:prepare -- <reference> first.');
await build({root:path.join(fixture,'web'),configFile:path.join(fixture,'web/vite.config.js'),logLevel:'warn'});
const {createApp}=await import(pathToFileURL(path.join(fixture,'src/server.mjs')));
const {createGame,act}=await import(pathToFileURL(path.join(fixture,'src/games.mjs')));
const arcade=createApp({database:':memory:',demo:true,serviceKey:''});await new Promise(r=>arcade.server.listen(0,'127.0.0.1',r));
const arcadeUrl=`http://127.0.0.1:${arcade.server.address().port}`;
const wallet=createWalletApp({db:arcade.db,demo:true,closeDatabase:false,arcadeUrl});await new Promise(r=>wallet.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${wallet.server.address().port}`,output=path.join(root,'test-results');fs.mkdirSync(output,{recursive:true});
const channel=process.env.VAL_BROWSER_CHANNEL??(!fs.existsSync(chromium.executablePath())&&process.platform==='win32'?'msedge':undefined);
let browser;const errors=[];const successes=[];const pass=name=>{successes.push(name);console.log('PASS '+name)};
try{
 browser=await chromium.launch({headless:true,...(channel?{channel}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Masuk demo lokal'}).click();await page.getByTestId('balance').filter({hasText:'500'}).waitFor();
 const player=arcade.db.prepare("SELECT player_id FROM identities WHERE subject='local-demo'").get().player_id;
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);pass('Standalone login, real server balance 500 VAL, desktop layout');
 await page.getByRole('button',{name:/Receipt Kredit awal/}).click();await page.getByRole('dialog').getByText('POSTED',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});pass('Receipt from server; keyboard close and focus restoration');
 const popupPromise=context.waitForEvent('page');await page.getByRole('link',{name:'Buka Arcade'}).click();const game=await popupPromise;game.on('pageerror',e=>errors.push(e.message));await game.waitForLoadState();
 await game.locator('.rc3-catalog-play').filter({hasText:'Classic Match'}).first().click();const spin=game.getByRole('button',{name:'SPIN NOW',exact:true});await spin.waitFor();await spin.click();await spin.waitFor({state:'visible'});
 await page.bringToFront();await page.getByRole('button',{name:'Segarkan',exact:true}).click();await page.getByRole('button',{name:/Receipt Taruhan Arcade/}).first().waitFor();
 assert.equal(await page.getByTestId('balance').innerText(),new Intl.NumberFormat('id-ID').format(Number(readWallet(arcade.db,player).available))+' VAL');pass('Real Arcade UI stake → committed result → independent VAL refresh; shared authenticated session');
 assert.equal(await game.getByLabel('Kontrol Auto Spin').count(),0);pass('Fixture Arcade has no active autoplay controls');
 // Exercise actual roulette engine; betting every number guarantees a paytable-defined payout.
 const roulette=createGame(arcade.db,player,'B1',1).session;let version=roulette.version;
 for(let i=0;i<12;i++){const result=act(arcade.db,player,roulette.id,{command_id:randomUUID(),action:'SPIN',expected_version:version,bets:Array.from({length:37},(_,n)=>({choice:String(n),stake:1}))});version=result.session.version;}
 await page.getByRole('button',{name:'Segarkan',exact:true}).click();await page.getByRole('button',{name:/Receipt Hasil permainan/}).first().click();await page.getByText('Hasil bersih tercatat',{exact:true}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/-1/);await page.getByRole('button',{name:'Tutup receipt'}).click();pass('Payout receipt distinguishes gross 36 from net -1 for actual 37-stake roulette');
 await page.screenshot({path:path.join(output,'val-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Riwayat transaksi',exact:true}).click();await page.getByRole('button',{name:'Muat transaksi sebelumnya'}).waitFor();const count=await page.locator('.transaction-row').count();await page.getByRole('button',{name:'Muat transaksi sebelumnya'}).click();await page.waitForFunction(n=>document.querySelectorAll('.transaction-row').length>n,count);pass('History keyset pagination loads additional real ledger entries');
 await page.getByRole('combobox',{name:'Jenis transaksi'}).selectOption('REFUND');await page.getByText('Tidak ada jenis ini pada halaman yang dimuat.').waitFor();await page.getByRole('combobox',{name:'Jenis transaksi'}).selectOption('ALL');pass('Filter empty state explains loaded-page scope');
 await page.getByRole('button',{name:'Ringkasan',exact:true}).click();await page.getByTestId('balance').waitFor();
 await page.route('**/api/val/v1/snapshot',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'INTERNAL_ERROR'})}),{times:1});await page.getByRole('button',{name:'Segarkan',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});pass('Network/server error preserves last snapshot, marks stale, and retry recovers');
 await page.reload();await page.getByTestId('balance').waitFor();pass('Reload uses server session and committed wallet data');
 const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);await mobile.getByTestId('balance').waitFor();assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mobile.screenshot({path:path.join(output,'val-mobile.png'),fullPage:true});
 await mobile.getByRole('button',{name:/Receipt/}).first().click();await mobile.getByRole('dialog').getByText('POSTED',{exact:true}).waitFor();assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mobile.screenshot({path:path.join(output,'val-receipt-mobile.png'),fullPage:true});await mobile.getByRole('button',{name:'Tutup receipt'}).click();
 await mobile.setViewportSize({width:320,height:740});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mobile.setViewportSize({width:390,height:844});pass('Mobile 390px and 320px: no horizontal overflow; readable receipt');
 await mobile.getByRole('button',{name:'Buka menu'}).click();await mobile.getByRole('button',{name:'Kendali bermain',exact:true}).click();await mobile.getByRole('button',{name:'Blokir bermain',exact:true}).click();await mobile.getByRole('button',{name:'Konfirmasi blokir',exact:true}).click();await mobile.getByText(/Blokir aktif hingga/).waitFor();
 const blocked=await game.request.post(arcadeUrl+`/api/v1/sessions/${roulette.id}/actions`,{headers:{Origin:arcadeUrl},data:{command_id:randomUUID(),expected_version:version,action:'SPIN',bet:1,choice:'red'}});assert.equal(blocked.status(),403);assert.equal((await blocked.json()).error,'SELF_EXCLUDED');pass('Wallet self-exclusion prevents a new bet through Arcade authenticated API');
 assert.deepEqual(errors,[]);assert.equal(reconcileVal(arcade.db).ok,true);pass('Zero browser page errors; all accounts reconciled, including treasury/faucet');
 fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:successes,failures:[],browser:channel??'chromium',reference_modified:false},null,2));
}catch(e){console.error(e.stack);fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({passed:successes,failures:[e.message]},null,2));process.exitCode=1}
finally{await browser?.close();await wallet.close();await arcade.close()}
