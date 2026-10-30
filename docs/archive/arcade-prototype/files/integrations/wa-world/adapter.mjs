/** WORLD Arcade Engine native connector adapter.
 * Requires trusted WA-WORLD message sender; only use parsed sender from Baileys, NEVER message text as identity.
 * No VCUR access or WA-WORLD database calls.
 */
import {randomUUID} from 'node:crypto';
export function createWorldArcadeAdapter({apiUrl='http://127.0.0.1:8787',serviceKey,publicUrl=apiUrl}={}){
 if(!serviceKey||serviceKey.length<24)throw Error('WAE serviceKey must be configured separately');
 async function request(method,route,payload){
   const res=await fetch(`${apiUrl.replace(/\/$/,'')}${route}`,{method,headers:{'Content-Type':'application/json','X-WAE-Service-Key':serviceKey},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(8000)});
   const data=await res.json();if(!res.ok)throw Error(`WAE ${data.error||res.status}`);return data;
 }
 const post=(route,data)=>request('POST',route,data);
 const get=(route)=>request('GET',route);
 const fmt=s=>s?`${s.game_code} (#${s.id.slice(0,8)}), v${s.version}`:'Tidak ada sesi';
 function summarize(d){const s=d.session;let text=`🎮 WORLD ARCADE (${s.game_code})\nSesi: ${s.id}\nVersi: ${s.version}\nACR: ${d.balance}`;
   if(s.game_code==='A1-01')text+=`\n${(s.last?.grid||[]).map(row=>row.join(' | ')).join('\n')}\nHadiah: ${s.last?.payout??'-'} ACR`;
   if(s.game_code==='A1-02')text+=`\n${(s.last?.grid||[]).map(row=>row.join(' | ')).join('\n')}\nFree spins: ${s.bonus?.remaining??0}\nHadiah: ${s.last?.payout??'-'} ACR`;
   if(s.game_code==='A1-04')text+=`\n${(s.last?.grid_after||[]).map(row=>row.join(' | ')).join('\n')}\nBlast: ${s.last?.activated?'AKTIF':'tidak aktif'}; kolom ${s.last?.trigger_columns?.join(', ')||'-'}\nBaris menang: ${s.last?.lines?.length??0}\nHadiah: ${s.last?.payout??'-'} ACR`;
   if(s.game_code==='A1-03')text+=`\n${(s.last?.grid||[]).map(row=>row.join(' | ')).join('\n')}\nProgres: aktivitas ${s.meters?.activity??0}/8, simbol ${s.meters?.symbols??0}/6, kemenangan ${s.meters?.victory??0}/3\nHadiah guci tertutup: ${s.pot_pending??0}\n${s.phase==='POT_CHOICE'?'Gunakan .wae open 1|2|3 untuk memilih guci.':''}\nHadiah: ${s.last_open?.payout??s.last?.payout??'-'} ACR`;
   if(s.game_code==='A1-05')text+=`\n${(s.last?.grid_after||[]).map(row=>row.join(' | ')).join('\n')}\nScatter: ${s.last?.scatter_count??0} kolom, Free Spins: ${s.bonus?.remaining??0}\nBlast: ${s.last?.blast_activated?'AKTIF':'-'}\nGuci: ${s.pot_pending??0} menunggu (pakai .wae open fusion 1|2|3)\nHadiah: ${s.last_open?.payout??s.last?.payout??'-'} ACR`;
   if(s.game_code==='B1')text+=`\nRoulette: ${s.last?.number??'-'} (${s.last?.color??'-'})\nHasil: ${s.last?.net??'-'} ACR`;
   if(s.game_code==='B2')text+=`\nDealer: ${s.dealer.join(' ')}\nKartu: ${s.player.join(' ')}\nStatus: ${s.phase}`;
   return text;
 }
 async function handle({senderJid,text,isGroup=false,messageId}){
   const raw=String(text||'').trim();if(!/^\.wae(?:\s|$)/i.test(raw))return null;
   if(isGroup)return '🔒 World Arcade hanya menerima aksi privat di DM bot. Buka chat pribadi dan tulis .wae';
   if(!senderJid||typeof senderJid!=='string')return 'Identitas pengirim tidak valid.';
   const args=raw.split(/\s+/),op=(args[1]||'menu').toLowerCase(),subject=senderJid;
   try{
    if(['menu','help'].includes(op))return '.wae policy\n.wae lottery list | status ID | buy ID NOMOR confirm\n.wae rtable list | status ID | slip ID 7:100,12:50,red:100 confirm\n.wae notifications [cursor]\n🎮 WORLD ARCADE\n.wae profile\n.wae slot [ACR custom]\n.wae scatter [ACR custom]\n.wae guci [ACR custom]\n.wae blast [ACR custom]\n.wae fusion [ACR custom]\n.wae roulette [ACR custom]\n.wae blackjack [ACR custom]\n.wae spin [classic|scatter|guci|blast|fusion|red|black|odd|even|0..36]\n.wae open <1|2|3> (Mystery Guci)\n.wae open fusion <1|2|3> (Fusion Guci)\n.wae hit | .wae stand\n.wae web | .wae pending\n.wae approve <ref> <6digit>\n.wae link <6digit> | .wae confirm <6digit>\n.wae room create 10 | .wae room list\n.wae room join KODE | ready KODE | start KODE\n.wae bjroom create 10 | list | join KODE | ready KODE | start KODE\n.wae bjroom hit KODE | stand KODE | status KODE\nSaldo ACR berbeda dari VCUR.';
    if(op==='policy'){const p=await get(`/internal/v1/policies?subject=${encodeURIComponent(subject)}&game_code=${encodeURIComponent(args[2]||'*')}`);return `ACR custom: ${p.min}–${p.max}; preset ${p.presets.join(', ')}. Ronde aktif memakai aturan terkunci.`;}
    if(op==='lottery'||op==='rtable'){
     const lottery=op==='lottery',route=lottery?'lottery':'roulette-rounds',verb=(args[2]||'list').toLowerCase(),id=args[3];
     const summary=r=>`${r.title||'Roulette'} · ${r.id}\n${r.status} v${r.version} · tutup ${new Date(r.closes_ms).toISOString()}\nHasil ${r.result??'menunggu'}\n${lottery?`Harga ${r.rules.price} ACR, ${r.rules.digits} digit, min 4 prefix; base ${r.rules.base_prize} × (3/2)^(matched−4), cap ${r.rules.max_prize}. Tiket: ${r.tickets_mine?.map(t=>t.guess+':'+t.status+':'+(t.payout??'-')).join(', ')||'-'}; peluang >=4: 1/10000`:`Max ${r.rules.policy.max} ACR/slip; 36x straight, 2x even-money. Slip: ${JSON.stringify(r.slip?.bets||[])}; payout ${r.slip?.payout??'-'}`}`;
     if(verb==='list'){const d=await get(`/internal/v1/${route}?subject=${encodeURIComponent(subject)}`);return d.rounds.map(summary).join('\n\n')||'Belum ada ronde.';}
     if(!/^[a-f0-9]{32}$/.test(id||''))return `Gunakan .wae ${op} status ROUND_ID`;
     const current=(await get(`/internal/v1/${route}/${id}?subject=${encodeURIComponent(subject)}`)).round;
     if(verb==='status')return summary(current);
     if(lottery&&verb==='buy'){
      if(args[5]!=='confirm')return `${summary(current)}\nPeluang/biaya ditampilkan di atas. Konfirmasi: .wae lottery buy ${id} ${args[4]||'0000'} confirm`;
      const d=await post(`/internal/v1/${route}/${id}/tickets`,{subject,guess:args[4],command_id:`wa:lottery:${messageId||randomUUID()}`});return summary(d.round)+`\nACR ${d.balance}`;
     }
     if(!lottery&&verb==='slip'){
      const bets=(args[4]||'').split(',').map(x=>{const [choice,stake]=x.split(':');return {choice,stake:Number(stake)}});
      if(args[5]!=='confirm')return `${summary(current)}\nSlip: ${JSON.stringify(bets)}; total ${bets.reduce((n,b)=>n+b.stake,0)} ACR. Final setelah confirm.\n.wae rtable slip ${id} ${args[4]||'7:100,red:100,even:50'} confirm`;
      const d=await post(`/internal/v1/${route}/${id}/slips`,{subject,bets,command_id:`wa:roulette:${messageId||randomUUID()}`});return summary(d.round)+`\nACR ${d.balance}`;
     }
     return `Gunakan .wae ${op} list | status ID | ${lottery?'buy ID NOMOR confirm':'slip ID 7:100,12:50,red:100 confirm'}`;
    }
    if(op==='notifications'){const d=await get(`/internal/v1/notifications?subject=${encodeURIComponent(subject)}&after=${encodeURIComponent(args[2]||'0')}`);return d.events.filter(e=>/^(lottery|roulette)\./.test(e.event_type)).map(e=>`#${e.id} ${e.event_type} ${JSON.stringify(e.payload)}`).join('\n')||'Tidak ada hasil baru.';}
    if(op==='bjroom'){
      const verb=(args[2]||'list').toLowerCase();
      const route='/internal/v1/blackjack-tables';
      const summary=(out)=>{const t=out.table;const own=t.hands?.find(h=>h.seat===t.my_seat);return `🃏 BLACKJACK TABLE ${t.code}\nStatus: ${t.status} · v${t.version}\nPemain: ${t.player_count}/4 · Stake: ${t.bet} ACR\n${t.members.map(m=>`P${m.seat}: ${m.ready?'SIAP':'MENUNGGU'}${m.is_me?' (Anda)':''}`).join('\n')}\nDealer: ${t.dealer.join(' ')}\n${own?`Kartu Anda: ${own.cards.join(' ')} · Total ${own.total}\n`:''}${t.turn_seat?`Giliran: P${t.turn_seat}`:''}\n${t.status==='PLAYING'&&t.turn_seat===t.my_seat?`.wae bjroom hit ${t.code} / stand ${t.code}`:''}${t.status==='FINISHED'?`\nHasil Anda: ${own?.outcome??'-'} · hadiah ${own?.payout??0} ACR`:''}\nSaldo: ${out.balance} ACR`;};
      if(verb==='list'){
        const d=await get(`${route}?subject=${encodeURIComponent(subject)}`);
        return d.tables.length?`🃏 MEJA BLACKJACK\n${d.tables.slice(0,8).map(t=>`${t.code} · ${t.status} · ${t.player_count}/4 · ${t.bet} ACR`).join('\n')}\nBuat: .wae bjroom create 10`:'Belum ada meja Blackjack. Gunakan .wae bjroom create 10';
      }
      if(verb==='create'){
        const bet=Number(args[3]||10);
        const d=await post(`${route}/create`,{subject,bet,command_id:`wa:bj:create:${messageId||randomUUID()}`});
        return `${summary(d)}\nUndang teman: .wae bjroom join ${d.table.code}`;
      }
      const ref=(args[3]||'').toUpperCase();if(!/^[A-Z2-9]{7}$/.test(ref))return 'Format: .wae bjroom <join|status|ready|start|hit|stand|leave|cancel> <kode 7 karakter>';
      if(verb==='join'){
        const d=await get(`${route}?subject=${encodeURIComponent(subject)}`);
        const t=d.open.find(t=>t.code===ref);if(!t)return 'Meja tidak ditemukan / sudah mulai.';
        const out=await post(`${route}/join`,{subject,code:ref,expected_version:t.version,command_id:`wa:bj:join:${messageId||randomUUID()}`});return `${summary(out)}\nGunakan .wae bjroom ready ${out.table.code}`;
      }
      const d=await get(`${route}/info?subject=${encodeURIComponent(subject)}&table_id=${encodeURIComponent(ref)}`).catch(()=>null);
      if(!d)return 'Meja tidak ditemukan atau Anda bukan peserta.';
      if(verb==='status')return summary(d);
      const actions={ready:'READY',start:'START',hit:'HIT',stand:'STAND',leave:'LEAVE',cancel:'CANCEL'};
      if(!actions[verb])return 'Gunakan .wae bjroom list / create / join / status / ready / start / hit / stand / leave / cancel';
      const result=await post(`${route}/action`,{subject,table_id:d.table.id,expected_version:d.table.version,command_id:`wa:bj:${verb}:${messageId||randomUUID()}`,action:actions[verb],confirm_forfeit:verb==='leave'&&args[4]==='confirm'});
      return summary(result);
    }
    if(op==='room'){
      const verb=(args[2]||'list').toLowerCase();
      if(verb==='list'){
        const r=await get(`/internal/v1/rooms?subject=${encodeURIComponent(subject)}`);
        return r.rooms.length?`🎲 DICE DUEL — ROOM SAYA\n${r.rooms.slice(0,8).map(x=>`${x.code} (${x.status}) · ${x.player_count}/2 · ${x.bet} ACR · v${x.version}`).join('\n')}\n.wae room status <kode>`:'Belum ada room. Buat .wae room create 10';
      }
      if(verb==='create'){
        const bet=Number(args[3]||10);
        const r=await post('/internal/v1/rooms/create',{subject,bet,command_id:`wa:room:create:${messageId||randomUUID()}`});
        return `🎲 DICE DUEL ROOM\nKode: ${r.room.code}\nStake: ${r.room.bet} ACR\nBagikan kode ke teman. .wae room join ${r.room.code}\nSetelah dua pemain siap, host: .wae room start ${r.room.code}`;
      }
      const code=(args[3]||'').toUpperCase();
      if(!/^[A-Z2-9]{7}$/.test(code))return 'Format: .wae room <join|status|ready|start|leave|cancel> <kode 7 karakter>';
      const r=await get(`/internal/v1/rooms/info?subject=${encodeURIComponent(subject)}&room_id=${encodeURIComponent(code)}`).catch(e=>null);
      if(verb==='status'){
        if(!r)return 'Room tidak ditemukan atau bukan anggota. Untuk bergabung gunakan .wae room join <kode>';
        const x=r.room;return `🎲 ROOM ${x.code}\nStatus: ${x.status}, ${x.player_count}/2 pemain, ${x.bet} ACR, v${x.version}\n${x.members.map(m=>`P${m.seat}: ${m.ready?'READY':'MENUNGGU'}`).join('\n')}\n${x.result?`Hasil: ${x.result.dice.join(' vs ')}; pemenang seat ${x.result.winning_seat}`:''}`;
      }
      if(verb==='join'){
        // Join uses the currently observed room version, supplied by listing public room info.
        // HTTP service endpoint returns a safe catalog for trusted connector.
        const catalog=await get(`/internal/v1/rooms/open?subject=${encodeURIComponent(subject)}`);
        const room=catalog.rooms.find(x=>x.code===code);
        if(!room)return 'Room sudah tutup atau tidak ditemukan.';
        const out=await post('/internal/v1/rooms/join',{subject,code,expected_version:room.version,command_id:`wa:room:join:${messageId||randomUUID()}`});
        return `✅ Bergabung ke room ${out.room.code}. Gunakan .wae room ready ${out.room.code}`;
      }
      if(!r)return 'Anda bukan anggota room tersebut.';
      const actions={ready:'READY',start:'START',leave:'LEAVE',cancel:'CANCEL'};
      if(!actions[verb])return 'Gunakan .wae room list | create <bet> | join <kode> | status <kode> | ready <kode> | start <kode> | leave <kode> | cancel <kode>';
      const out=await post('/internal/v1/rooms/action',{subject,room_id:r.room.id,expected_version:r.room.version,command_id:`wa:room:${verb}:${messageId||randomUUID()}`,action:actions[verb]});
      return `🎲 ROOM ${out.room.code}\nStatus: ${out.room.status} · ${out.room.player_count}/2 · v${out.room.version}${out.room.result?`\nDadu: ${out.room.result.dice.join(' vs ')}; pemenang P${out.room.result.winning_seat}; hadiah ${out.room.result.payout} ACR`:''}`;
    }
    if(op==='profile'||op==='status'){
      const r=await get(`/internal/v1/profile?subject=${encodeURIComponent(subject)}`);
      return `👤 WORLD ARCADE\nACR: ${r.balance}\nSesi terkini: ${r.sessions.slice(0,3).map(fmt).join(' / ')||'Belum ada'}`;
    }
    if(op==='web'){
      const profile=await get(`/internal/v1/profile?subject=${encodeURIComponent(subject)}`);
      const r=await post('/internal/v1/handoffs',{subject,session_id:profile.sessions[0]?.id??null});
      return `🔐 LINK WEB PRIBADI\n${publicUrl.replace(/\/$/,'')}/connect?r=${r.ref}\n\nLink ini bukan token login. Buka link, klaim, lalu ketik .wae pending untuk melihat kode konfirmasi. Jangan setujui handoff yang tidak Anda mulai.`;
    }
    if(op==='pending'){
      const r=await get(`/internal/v1/handoffs/pending?subject=${encodeURIComponent(subject)}`);
      return r.requests.length?'🔐 Permintaan Web aktif:\n'+r.requests.map(x=>`${x.ref}\nStatus: ${x.status}${x.display_code?` · kode: ${x.display_code}`:''}\n${x.status==='CLAIMED'?`.wae approve ${x.ref} ${x.display_code}`:''}`).join('\n---\n'):'Tidak ada permintaan handoff aktif.';
    }
    if(op==='approve'){
      if(!/^[a-zA-Z0-9_-]{12,50}$/.test(args[2]||'')||!/^[0-9]{6}$/.test(args[3]||''))return 'Gunakan .wae approve <ref> <kode 6 angka> dari DM pemilik.';
      const r=await post(`/internal/v1/handoffs/${args[2]}/approve`,{subject,code:args[3]});return r.ok?'✅ Perangkat disetujui. Kembali ke browser dan pilih Lanjut.':'❌ Kode konfirmasi salah.';
    }
    if(op==='link'||op==='confirm'){
      if(!/^[0-9]{6}$/.test(args[2]||''))return `Gunakan .wae ${op} <6-digit-code>`;
      const r=await post(`/internal/v1/wa-links/${op==='link'?'claim':'confirm'}`,{subject,code:args[2]});
      return op==='link'?`Permintaan penautan ditemukan. Jika Anda yang memulai dari browser, konfirmasi dengan .wae confirm ${args[2]}`:'Konfirmasi WhatsApp berhasil. Kembali ke browser dan klik Selesaikan Link.';
    }
    if(['slot','scatter','guci','blast','fusion','roulette','blackjack'].includes(op)){
      const bet=Number(args[2]||10);const codes={slot:'A1-01',scatter:'A1-02',guci:'A1-03',blast:'A1-04',fusion:'A1-05',roulette:'B1',blackjack:'B2'};
      const r=await post('/internal/v1/games/create',{subject,game_code:codes[op],bet,command_id:`wa:create:${messageId||randomUUID()}`});return summarize(r);
    }
    if(op==='open'){
      const fusion=(args[2]||'').toLowerCase()==='fusion';
      const pick=Number(args[fusion?3:2]);if(!Number.isInteger(pick)||pick<1||pick>3)return 'Gunakan .wae open 1|2|3 (Guci) atau .wae open fusion 1|2|3';
      const prof=await get(`/internal/v1/profile?subject=${encodeURIComponent(subject)}`);
      const ses=prof.sessions.find(x=>x.game_code===(fusion?'A1-05':'A1-03'));
      if(!ses)return `Belum ada sesi ${fusion?'Ultimate Fusion':'Mystery Guci'}. Buat dulu dengan .wae ${fusion?'fusion':'guci'} 10`;
      const r=await post('/internal/v1/games/action',{subject,session_id:ses.id,expected_version:ses.version,command_id:`wa:${messageId||randomUUID()}:${ses.id}`,action:'OPEN_POT',choice:pick-1});
      return summarize(r);
    }
    if(['spin','hit','stand'].includes(op)){
      const prof=await get(`/internal/v1/profile?subject=${encodeURIComponent(subject)}`);
      const target=(args[2]||'').toLowerCase();
      const code=op!=='spin'?'B2':target==='scatter'?'A1-02':target==='guci'?'A1-03':target==='blast'?'A1-04':target==='fusion'?'A1-05':target==='classic'||!target?'A1-01':'B1';
      const s=prof.sessions.find(x=>x.game_code===code);
      if(!s)return `Tidak ada sesi ${code}. Buat dahulu dengan .wae slot / scatter / guci / blast / roulette / blackjack.`;
      const r=await post('/internal/v1/games/action',{subject,session_id:s.id,expected_version:s.version,command_id:`wa:${messageId||randomUUID()}:${s.id}`,action:op==='spin'?'SPIN':op.toUpperCase(),choice:code==='B1'?(args[2]||'red'):undefined});
      return summarize(r);
    }
    return 'Perintah tidak dikenal. Gunakan .wae menu';
   }catch(error){return `WORLD Arcade: ${String(error.message).slice(0,135)}. Coba .wae status untuk menyegarkan.`;}
 }
 return {handle};
}
