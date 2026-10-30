# EV-wallet VAL untuk React Native

SDK lokal `@waw/val-client` menghubungkan aplikasi native ke server mandiri di proyek ini. Fitur aktif: login akun individual, refresh token, daftar perangkat, challenge bertanda tangan, transfer VAL Lab, QR VAL Demo, NFC NDEF, saldo, histori, dan receipt. Nominal selalu string integer, misalnya `'25'`.

## Menjalankan backend

Dari root `waw-ev-wallet`:

```powershell
npm run server:init
npm run build
npm run server:lab
```

Alamat komputer: `http://127.0.0.1:3212`. Kredensial lokal ada di [test-accounts.json](../.local/test-accounts.json); empat akun awal `alice.test`, `bob.test`, `merchant.test`, `operator.test` masing-masing memperoleh 1.000 VAL sekali saja. Pengulangan init tidak mereset saldo. Browser `/lab` menyediakan registrasi undangan, recovery, pengelolaan sesi dan kunci perangkat **software**, bukan sensor sidik jari.

Tahap 1 memakai undangan satu kali dari operator. Setelah `client.register(...)`, tampilkan dan minta pengguna menyimpan `recovery_codes`; server hanya menyimpan hash dan tidak dapat menampilkan kode yang sama lagi. `client.recover(...)` memakai satu kode, mengganti password, mencabut semua sesi/perangkat lama, lalu mengembalikan delapan kode baru. SDK juga menyediakan `me`, `updateProfile`, `changePassword`, `rotateRecoveryCodes`, `sessions`, `revokeSession`, `logoutOthers`, dan `logoutAll`. Service credential dan akun operator tidak boleh ditanam di aplikasi pengguna.

Tahap 2 menambahkan `notifications`, `readNotification`, `readAllNotifications`, filter `wallet({kind,direction})`, signed refund, serta penyimpanan konfirmasi per akun. Gunakan `createPendingConfirmation()` sebelum mengirim dan `confirmPending()` untuk commit. Saat aplikasi dibuka kembali, panggil `pendingPayment()` lalu `enquirePending()`; SDK menghapus pending hanya setelah status final diketahui atau commit berhasil. Key pending disimpan melalui secure store yang sama dan dipisahkan berdasarkan `user_id`.

## Memasang SDK pada proyek native

Folder ini berisi SDK dan contoh layar, belum aplikasi Android/iOS lengkap. Dari aplikasi React Native milikmu, pasang paket lokal menggunakan path relatif menuju folder `mobile` ini:

```sh
npm install /path/to/waw-ev-wallet/mobile
npm install react-native-biometrics react-native-keychain react-native-nfc-manager
```

Pilih versi modul native yang cocok dengan versi React Native dan arsitektur aplikasi tujuan; jalankan pemasangan pods dan build native sesuai dokumentasi masing-masing modul. Modul ini memerlukan binary native; contoh belum dibangun atau diuji pada perangkat fisik. Untuk Expo, gunakan development build yang menyertakan modul native tersebut.

```js
import ReactNativeBiometrics from 'react-native-biometrics';
import * as Keychain from 'react-native-keychain';
import {ValClient} from '@waw/val-client';
import {biometricSigner, keychainStore} from '@waw/val-client/adapters';

const nativeBiometrics = new ReactNativeBiometrics({allowDeviceCredentials: false});
const sign = biometricSigner(nativeBiometrics);
const store = keychainStore(Keychain);
const client = new ValClient({
  baseUrl: 'https://wallet-dev.example.test', // origin, tanpa /api/mobile/v1
  secureStore: store,
});

await client.login(handle, password);
const {publicKey} = await nativeBiometrics.createKeys();
await client.enrollDevice({
  publicKey, sign, label: 'Ponsel pengujian', key: newKey(),
});
// newKey(): UUID acak dari library UUID/CSPRNG aplikasi; bukan Math.random().
// Simpan device_id otomatis ke Keychain. Jangan createKeys() setiap login.

// Saat membuka aplikasi lagi: pilih refresh() atau login dengan biometrik.
await client.biometricLogin(sign);
```

Enrollment memerlukan login password dalam lima menit terakhir. Panggil `client.reauthenticate(password)` sebelum mendaftarkan kunci jika waktunya habis. Satu kunci terikat pada satu akun; jangan menimpa kunci akun lain pada perangkat uji yang sama. Uji Alice dan Bob pada dua perangkat/profil terpisah. `client.devices()` dan `client.revokeDevice(id)` mengelola pencabutan kunci.

`allowDeviceCredentials: false` meminta autentikasi biometrik dari modul native. Jenis sensor mengikuti perangkat (misalnya sidik jari atau Face ID); server tidak menerima gambar/template sidik jari. Kunci privat tetap dikelola native, server menyimpan public key dan memverifikasi RSA PKCS#1 v1.5 SHA-256. Jangan mengganti payload challenge, melakukan hash tambahan, atau memakai hasil boolean `biometric_success` sebagai bukti.

Server belum memakai hardware attestation: tanda tangan membuktikan penguasaan kunci terdaftar, belum membuktikan kunci benar-benar dilindungi sensor. Pencabutan perangkat menolak login/signature baru dari kunci itu; sesi yang sudah diterbitkan mengikuti masa berlaku/logout. Pemulihan akun dan kebijakan perangkat produksi belum tersedia.

## Konfirmasi dan retry pembayaran

```js
const intent = await client.prepareTransfer('bob.test', '25', newKey());
// Tampilkan intent.recipient, intent.amount, currency dan pocket kepada pengguna.
// Setelah pengguna menekan konfirmasi:
const pending = await client.createPendingConfirmation(intent.id, sign, newKey());
const result = await client.confirmPending(pending);
// Hanya result.status === 'SETTLED' yang boleh ditampilkan sukses.
```

Jika request terakhir timeout/koneksi putus, `pending` tetap berada di secure store. Panggil `client.enquirePending()` atau ulangi `client.confirmPending()` dengan **ID, proof dan key yang sama**. Jangan membuat transfer baru. Receipt yang sudah committed dikembalikan lagi tanpa debit tambahan. Jika challenge kedaluwarsa dan intent masih pending, baca status dahulu, hapus pending secara eksplisit, lalu minta konfirmasi baru. Payload berbeda dengan key lama ditolak `IDEMPOTENCY_CONFLICT`.

Untuk refund, baca receipt transaksi awal dan periksa `refund_summary.can_refund`. Minta nominal, tampilkan preview, lalu panggil `signRefund(transactionId, amount, sign)` dan `refund(transactionId, amount, proof, idempotencyKey)`. Hanya penerima transaksi awal yang dapat melakukan ini; total refund server tidak dapat melewati nominal awal.

Access token berada di memori; refresh token berotasi dan disimpan melalui Keychain/Keystore. Kehilangan respons refresh mengharuskan login ulang. Setelah login ulang, periksa status intent; proof sesi lama tidak dapat digunakan oleh keluarga sesi baru. Penyimpanan pending di atas memungkinkan enquiry setelah aplikasi ditutup; jangan menyimpan token/private key di AsyncStorage atau mencetaknya ke log.

Contoh komponen [ValPaymentScreen.tsx](examples/ValPaymentScreen.tsx) menampilkan preview, konfirmasi, retry dan enquiry. Pending pada contoh layar berada di memori; tambahkan pemulihan dari secure store di aplikasi native seperti alur di atas.

## QR dan NFC

Penerima membuat request; kamera atau NFC pengirim hanya membaca URI dan meminta preview dari server. Pemindaian tidak memindahkan saldo.

```js
const request = await receiverClient.requestPayment('15', 'QR_VAL_DEMO', newKey());
const code = await receiverClient.code(request.id);
// Render code.qr_svg atau encode code.payload melalui komponen QR native.
// Callback hasil kamera:
const preview = await payerClient.resolvePayment(scannedText);
// Tampilkan preview lalu jalankan signConfirmation() dan confirm().
```

```js
import NfcManager, {NfcTech, Ndef} from 'react-native-nfc-manager';
import {readNfcPayment, writeNfcPayment} from '@waw/val-client/adapters';

const modules = {NfcManager, NfcTech, Ndef};
await writeNfcPayment(modules, code.payload); // perangkat penerima menulis tag NDEF
const preview = await readNfcPayment(modules, payerClient); // pengirim membaca tag
// Setelah preview disetujui, minta signature dan confirm seperti transfer.
```

Format URI persis `val-demo://pay/<token-acak-32-karakter>`, kedaluwarsa lima menit, hanya bisa diselesaikan sekali. Tag lama harus diperbarui untuk request baru. NFC di sini adalah **tag NDEF**, bukan EMV, terminal bank, atau tap antardua ponsel/HCE. Modul mengakhiri sesi NFC pada sukses maupun error. Aktifkan permission/entitlement NFC, Face ID dan kamera sesuai platform serta modul scanner pilihanmu. Integrasi kamera konkret belum disertakan.

## Koneksi perangkat ke server

Pilihan utama adalah HTTPS reverse proxy ke `127.0.0.1:3212`. Untuk web di origin HTTPS yang sama, set `VAL_PUBLIC_ORIGIN=https://nama-host` pada server (tanpa trailing slash). API native memakai Bearer token dan tidak bergantung cookie atau CORS browser.

Untuk pengujian LAN sementara dengan akun virtual, server dapat dibuka secara eksplisit:

```powershell
$env:VAL_MOBILE_HOST='0.0.0.0'
$env:VAL_ALLOW_INSECURE_LAB='1'
npm run server:lab
```

Gunakan IP LAN komputer pada ponsel, atau `10.0.2.2:3212` dari emulator Android. SDK memerlukan `allowInsecureLab: true` untuk URL HTTP. OS/aplikasi mungkin memerlukan pengecualian cleartext khusus debug; jangan membawanya ke build produksi. `localhost` pada ponsel menunjuk ponsel sendiri.

## Validasi dan referensi

`npm run test:platform` menguji server SQLite, protokol signature dan SDK melalui HTTP lokal. `npm run test:lab:browser` menguji console web. Adapter NFC menggunakan pengujian kontrak dengan mock; sensor, permission, native linking dan tag fisik belum diverifikasi. QRIS resmi, uang nyata, hardware attestation dan pemasangan produksi bukan fitur aktif tahap ini.

- [React Native: security dan penyimpanan rahasia](https://reactnative.dev/docs/security)
- [react-native-biometrics: kunci dan signature](https://github.com/SelfLender/react-native-biometrics)
- [react-native-nfc-manager](https://github.com/revtel/react-native-nfc-manager) dan [contoh NDEF](https://github.com/revtel/react-native-nfc-manager/wiki/Examples)
- [Kontrak API](../docs/api/mobile.openapi.json) dan [arsitektur/database](../docs/waw/MOBILE-SERVER.md)
