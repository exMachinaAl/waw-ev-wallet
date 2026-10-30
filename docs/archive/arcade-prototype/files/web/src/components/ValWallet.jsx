import React,{useEffect,useRef,useState} from 'react';
import {api,money,clock} from '../api';
import './val-wallet.css';
const labels={INITIAL_CREDIT:'Kredit awal',STAKE:'Taruhan',PAYOUT:'Hasil permainan (payout)',REFUND:'Pengembalian',CORRECTION:'Koreksi admin'};
export default function ValWallet({onBalance}){
 const [wallet,setWallet]=useState(null),[items,setItems]=useState([]),[cursor,setCursor]=useState(null),[receipt,setReceipt]=useState(null),[selected,setSelected]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[safety,setSafety]=useState(null),[confirm,setConfirm]=useState(false);
 const generation=useRef(0),detailRequest=useRef(0),lock=useRef(false);
 async function load(more=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=generation.current;
  try{
   const [w,h,s]=await Promise.all([api('GET','/api/val/v1/wallets'),api('GET','/api/val/v1/transactions'+(more?`?cursor=${cursor}`:'')),api('GET','/api/val/v1/play-safety')]);
   if(current!==generation.current)return;
   setWallet(w.wallets[0]);onBalance(Number(w.wallets[0].available));setItems(old=>more?[...old,...h.transactions.filter(t=>!old.some(x=>x.id===t.id))]:h.transactions);setCursor(h.next_cursor);setSafety(s);
  }catch(e){if(current===generation.current)setError(e.message)}finally{lock.current=false;if(current===generation.current)setBusy(false)}
 }
 useEffect(()=>{load();return()=>{generation.current++;detailRequest.current++;lock.current=false}},[]);
 async function detail(id){const request=++detailRequest.current;setSelected(id);setReceipt(null);setDetailError('');try{const r=await api('GET',`/api/val/v1/transactions/${id}`);if(request===detailRequest.current)setReceipt(r.receipt)}catch(e){if(request===detailRequest.current)setDetailError(e.message)}}
 async function changeSafety(body){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{setSafety(await api('POST','/api/val/v1/play-safety',body));setConfirm(false)}catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}}
 return <section className="val-wallet" aria-label="EV-wallet VAL">
  <div className="view-intro"><span className="eyebrow">VIRTUAL AL · WORLD ARCADE</span><h1>EV-wallet VAL</h1><p>VAL Arcade — sebelumnya ACR. Kredit virtual bulat, tanpa kurs uang nyata.</p></div>
  <div className="val-balance"><div className="val-mark" aria-hidden="true">V<span>AL</span></div><span>SALDO TERSEDIA</span><strong data-testid="val-available">{wallet?money(wallet.available):'—'} <small>VAL</small></strong><dl><div><dt>Tercatat</dt><dd>{wallet?money(wallet.posted):'—'} VAL</dd></div><div><dt>Ditahan</dt><dd>{wallet?money(wallet.held):'—'} VAL</dd></div></dl><p>Saldo berasal dari server. Taruhan yang sudah dibayar tercatat sebagai debit; cadangan hadiah disimpan pada treasury.</p></div>
  <p className="val-note">1 ACR lama = 1 VAL Arcade. Tanpa pembelian, penarikan uang, atau transfer antarpocket.</p>
  <div className="panel"><div className="panel-head"><h2>Riwayat transaksi</h2><button className="btn outline" disabled={busy} onClick={()=>load()}>Segarkan dompet</button></div>
   {error&&<div role="alert"><p>{error} Data yang tampil mungkin belum terbaru.</p><button className="btn outline" disabled={busy} onClick={()=>load()}>Coba lagi</button></div>}
   {busy&&<p role="status">Memuat data server…</p>}
   {!busy&&!error&&items.length===0&&<p>Belum ada transaksi.</p>}
   <div className="val-history">{items.map(t=><button className="val-row" key={t.id} onClick={()=>detail(t.id)}><span><strong>{labels[t.kind]}</strong><small>{clock(t.created_ms)} · Tercatat</small><small>Ref: {t.reference}</small></span><b className={t.delta.startsWith('-')?'negative':'positive'}>{t.delta.startsWith('-')?'−':'+'}{money(t.amount)} VAL</b></button>)}</div>
   {cursor&&<button className="btn outline" disabled={busy} onClick={()=>load(true)}>Muat transaksi sebelumnya</button>}
  </div>
  {selected&&<section className="panel val-receipt" aria-label="Detail receipt"><div className="panel-head"><h2>Receipt transaksi</h2><button className="btn ghost" onClick={()=>{detailRequest.current++;setSelected(null)}}>Tutup receipt</button></div>{detailError?<div role="alert"><p>{detailError}</p><button className="btn outline" onClick={()=>detail(selected)}>Coba receipt lagi</button></div>:!receipt?<p role="status">Memuat receipt…</p>:<><dl>{[['Jenis',labels[receipt.kind]],['Jumlah',`${receipt.delta.startsWith('-')?'−':'+'}${money(receipt.amount)} VAL`],['Status','Tercatat (POSTED)'],['Waktu',clock(receipt.created_ms)],['ID transaksi',receipt.id],['Referensi',receipt.reference],['Pocket','VAL Arcade']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>Payout adalah jumlah kredit hasil permainan, termasuk pengembalian taruhan bila aturan game demikian. Payout bukan hasil bersih; hasil bersih = payout dikurangi taruhan terkait.</p></>}</section>}
  <section className="panel"><h2>Kendali bermain</h2><p>Aktifkan batas sesi 15 menit dengan anggaran total 100 VAL dan jeda 15 menit. Kemenangan tidak mengisi kembali anggaran.</p>{safety?.excluded_until>Date.now()?<p role="status">Taruhan baru diblokir hingga {clock(safety.excluded_until)}. Hak payout dan refund tetap diproses.</p>:<><button className="btn outline" disabled={busy} onClick={()=>changeSafety({action:'START_SESSION',budget:100})}>Mulai sesi terbatas</button><button className="btn outline" disabled={busy} onClick={()=>setConfirm(true)}>Blokir bermain 24 jam</button></>}{safety?.limits_active&&<p>Stake terpakai {money(safety.spent)} / {money(safety.budget)} VAL · sesi berakhir {clock(safety.session_end)}</p>}{confirm&&<div><p>Blokir langsung berlaku di Web dan konektor WA Arcade selama 24 jam dan tidak bisa dibatalkan dari layar ini.</p><button className="btn primary" disabled={busy} onClick={()=>changeSafety({action:'EXCLUDE',days:1})}>Konfirmasi blokir 24 jam</button><button className="btn ghost" onClick={()=>setConfirm(false)}>Batal</button></div>}<p className="val-note">Prototipe lokal. Batas harian dan penyelesaian bonus saat blokir belum lengkap; belum siap beta publik.</p></section>
 </section>;
}
