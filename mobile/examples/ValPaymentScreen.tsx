import React,{useEffect,useState} from 'react';
import {View,Text,TextInput,Button,Alert,ScrollView} from 'react-native';
import type {ValClient,Intent,Signer} from '../src/index';

/** Mount inside your authenticated navigation. Scanner/NFC results call client.resolvePayment first. */
export function ValPaymentScreen({client,sign,newKey}:{client:ValClient;sign:Signer;newKey:()=>string}){
 const [handle,setHandle]=useState('bob.test'),[amount,setAmount]=useState('25'),[intent,setIntent]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[result,setResult]=useState('');
 const [pending,setPending]=useState<{id:string;key:string;proof:{challenge_id:string;signature:string}}|null>(null);
 useEffect(()=>{let active=true;(async()=>{try{const saved=await client.pendingPayment();if(!saved||!active)return;const enquiry=await client.enquirePending();if(!active||!enquiry)return;if(enquiry.intent.status==='PENDING'){setPending(saved);setIntent(enquiry.intent);setResult('Konfirmasi tersimpan dipulihkan. Periksa status atau ulangi permintaan yang sama.')}else if(enquiry.receipt)setResult(`Sudah tercatat: ${enquiry.receipt.id}`)}catch(e){if(active)setResult('Konfirmasi tersimpan perlu diperiksa setelah login.') }})();return()=>{active=false}},[client]);
 async function prepare(){setBusy(true);try{const i=await client.prepareTransfer(handle,amount,newKey());setIntent(i);setPending(null);setResult('')}catch(e){Alert.alert('Belum berhasil',String(e))}finally{setBusy(false)}}
 async function confirm(){if(!intent)return;setBusy(true);try{
  const request=pending??await client.createPendingConfirmation(intent.id,sign,newKey());setPending(request);
  const paid=await client.confirmPending(request);setResult(`Tercatat: ${paid.receipt.id}`);setPending(null);setIntent(null);
 }catch(e){setResult('Status belum pasti atau transaksi ditolak. Periksa status sebelum membuat transaksi baru.');Alert.alert('Pembayaran belum dikonfirmasi',String(e))}finally{setBusy(false)}}
 async function enquire(){if(!intent)return;setBusy(true);try{const current=await client.intent(intent.id);setResult(`Status server: ${current.status}${current.journal_id?' · '+current.journal_id:''}`);if(current.status==='SETTLED'){setPending(null);setIntent(null)}}catch(e){Alert.alert('Gagal membaca status',String(e))}finally{setBusy(false)}}
 return <ScrollView contentContainerStyle={{padding:24,gap:16}}><Text style={{fontSize:24}}>EV-wallet VAL</Text><Text>VAL Lab · hanya akun uji, bukan uang nyata</Text><TextInput accessibilityLabel="Penerima" autoCapitalize="none" value={handle} onChangeText={setHandle} editable={!intent&&!busy}/><TextInput accessibilityLabel="Jumlah VAL" keyboardType="number-pad" value={amount} onChangeText={setAmount} editable={!intent&&!busy}/>{!intent?<Button title="Periksa transfer" disabled={busy} onPress={prepare}/>:<View style={{gap:16}}><Text>Penerima: {intent.recipient.display_name} ({intent.recipient.handle})</Text><Text>{intent.amount} VAL Lab</Text><Button title={pending?'Ulangi konfirmasi yang sama':'Konfirmasi dengan biometrik'} disabled={busy} onPress={confirm}/><Button title="Periksa status server" disabled={busy} onPress={enquire}/></View>}<Text accessibilityLiveRegion="polite">{result}</Text></ScrollView>;
}
