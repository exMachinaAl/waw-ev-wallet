# EV-wallet VAL

Aplikasi dompet **mandiri** untuk kredit virtual WAW. VAL berarti **Virtual AL**: satu unit integer virtual, tanpa kurs rupiah, pembelian kredit, cash-out, atau hadiah bernilai nyata.

Semua source aktif berada di proyek `waw-ev-wallet`. WORLD Arcade Engine digunakan sebagai referensi dan target konektor eksternal; source aslinya tidak dimodifikasi. WA-WORLD belum diintegrasikan.

## Server akun individual, transfer, dan React Native

Fitur baru berjalan di **server VAL Lab mandiri** dengan SQLite persisten: transfer antar akun, QR VAL Demo, request NFC NDEF, autentikasi berbasis kunci perangkat, histori dan receipt. Ini VAL virtual untuk pengujian, sesuai ruang lingkup yang disepakati.

```powershell
cd 'C:\Program Files X\waw-ev-wallet'
npm install
npm run server:init
npm run build
npm start
```

Buka **http://127.0.0.1:3212/lab**. Akun `alice.test`, `bob.test`, `merchant.test`, dan `operator.test` masing-masing mendapat 1.000 VAL Lab sekali. Password unik dan service credential tersimpan di [`.local/test-accounts.json`](.local/test-accounts.json); database di `.local/val-lab.sqlite`. Init ulang tidak mereset akun atau saldo.

Tahap 1 akun sudah aktif. Masuk sebagai `operator.test` untuk membuat undangan USER/MERCHANT satu kali. Pendaftar memilih handle, nama dan password sendiri lalu menyimpan delapan recovery code offline. Console yang sama menyediakan profil, ganti password, rotasi recovery code, daftar sesi, pencabutan sesi dan logout seluruh perangkat. Role berasal dari undangan server dan tidak dapat dinaikkan melalui profil.

Tahap 2 transaksi harian juga aktif pada Lab: notifikasi pembayaran/refund/cancel, filter riwayat pada server, pembatalan transaksi pending, receipt dengan lawan transaksi, serta refund parsial/penuh oleh penerima asli. Refund adalah debit baru yang memerlukan tanda tangan perangkat; total kumulatif dibatasi pembayaran awal. SDK menyimpan konfirmasi belum pasti per akun di secure store agar dapat diperiksa atau diulang dengan body/key yang sama setelah aplikasi restart.

- [Panduan React Native, sidik jari, QR dan NFC](mobile/README.md)
- [Arsitektur server, database dan integrasi](docs/waw/MOBILE-SERVER.md)
- [Kontrak OpenAPI](docs/api/mobile.openapi.json) dan [skema SQL lengkap](docs/api/mobile.schema.sql)

Browser memakai kunci uji software. Adapter native mendukung challenge signature melalui modul biometrik dan baca/tulis tag NFC; sensor/perangkat fisik belum diuji. QR ini **QR VAL Demo**, belum QRIS resmi atau pembayaran terminal bank. Saldo Lab terpisah dari saldo Arcade; tidak ada transfer antarpocket atau uang nyata.

## Port tetap dan perintah utama

Semua port runtime ditentukan di [config/ports.json](config/ports.json). Tidak ada pemakaian port 3210 pada aplikasi aktif. Server menolak port yang sudah dipakai dengan pesan jelas; tidak memilih port pengganti diam-diam atau mematikan proses lain.

| Layanan | Port default | Perintah |
|---|---|---|
| E-wallet utama: web + API + SQLite | **3212** | `npm start` atau `npm run dev` |
| Wallet konektor Arcade opsional | 3213 | `npm run server:arcade` atau `npm run demo:arcade` |
| Arcade fixture eksternal | 8788 | Dijalankan oleh `npm run demo:arcade` |
| Vite dengan hot reload (opsional) | 5173 | `npm run dev:web`, buka `/lab`; backend 3212 tetap berjalan |

`server:lab` tetap menjadi alias server utama. Jalankan satu dari `start`, `dev`, atau `server:lab`, bukan semuanya bersamaan. `server:arcade` dan `demo:arcade` juga merupakan pilihan alternatif pada port 3213.

Override opsional melalui environment shell: `VAL_PORT`, `VAL_ARCADE_WALLET_PORT`, `VAL_ARCADE_PORT`, `VAL_WEB_PORT`. `VAL_MOBILE_PORT` merupakan alias lama `VAL_PORT`; jika keduanya diisi, nilainya harus sama. `VAL_PORT` kini selalu mengatur server utama. File `.env` tidak dibaca otomatis. Setelah mengubah konfigurasi, restart server/Vite dan jalankan `npm run api:docs`; sesuaikan `baseUrl` klien mobile. Tes memakai port ephemeral untuk isolasi.

Tahapan menuju aplikasi lengkap: [ROADMAP-EWALLET.md](docs/waw/ROADMAP-EWALLET.md).

## Menjalankan wallet Arcade yang sudah ada

Prasyarat: Node.js ≥22.16 dan npm. Lingkungan yang diuji: Node 24.21.0, npm 11.19.0, Windows.

```powershell
cd 'C:\Program Files X\waw-ev-wallet'
npm install
npm run build
npm run server:arcade
```

Buka **http://127.0.0.1:3213**, lalu pilih **Masuk demo lokal**. Mode ini menggunakan database in-memory dengan akun fixture dan kredit awal 500 VAL. Saldo tidak ditambah lagi saat login ulang selama proses yang sama. Menutup proses mengakhiri database demo. Kartu Arcade tidak memiliki tautan aktif jika konektor belum disiapkan.

## Menjalankan integrasi Arcade lokal

Demo bersama memakai port wallet konektor 3213 dan Arcade 8788. Server akun individual di port 3212 dapat tetap berjalan.

```powershell
npm run arcade:prepare -- 'C:\Program Files X\WORLD-Arcade-Engine-Main'
npm run demo:arcade
```

Perintah pertama membaca source Arcade RC3 dan membuat fixture di **`.local/arcade` dalam proyek ini**. Ia tidak menyalin `.env`, database pemain, atau sesi WA. Perintah kedua membangun UI Arcade fixture dan menyalakan dua aplikasi:

- Wallet konektor: **http://127.0.0.1:3213**
- Arcade fixture: **http://127.0.0.1:8788**

Keduanya memakai **satu database fixture sementara**, tanpa saldo bayangan. Demo ini tidak menghubungi ekonomi Arcade aktif. Ctrl+C menghentikan kedua aplikasi dan membersihkan database sementara yang dibuat oleh proses demo.

### Alur saldo → main → hasil → receipt

1. Masuk demo lokal dari wallet. Saldo tersedia awal adalah 500 VAL.
2. Tekan **Buka Arcade**. Browser memakai sesi yang sama; tidak perlu membuat akun kedua.
3. Buka **Classic Match**, lalu tekan **SPIN NOW** satu kali. Tunggu hasil server.
4. Kembali ke wallet. Fokus halaman memicu refresh; tombol **Segarkan** juga tersedia.
5. Buka transaksi taruhan atau hasil permainan. Receipt menampilkan ID, waktu WIB, referensi, dan status tercatat. Jika taruhan terkait tersedia, receipt memisahkan total stake, payout, dan hasil bersih yang sudah posted.
6. Buka **Riwayat transaksi** untuk pagination dan filter jenis transaksi pada halaman yang sudah dimuat.
7. Di **Kendali bermain**, aktifkan batas sesi atau blokir mandiri. Taruhan berikutnya melalui Web maupun konektor WA fixture ditolak saat blokir aktif; payout/refund yang sudah menjadi hak tetap diproses.

Label ACR yang tersisa pada Arcade fixture adalah kompatibilitas tampilan lama. Angkanya identik 1:1 dengan VAL Arcade; tidak ada penukaran atau penerbitan kredit karena pergantian nama.

## Pemeriksaan

```powershell
npm test
npm run test:integration
npm run test:arcade-regression
npm run check
npm run build
npm run test:browser
npm run test:lab:browser
```

Tes integrasi/regresi/browser memerlukan `arcade:prepare` terlebih dahulu. Tes browser menggunakan Playwright Chromium, atau Microsoft Edge yang sudah terpasang di Windows jika Chromium Playwright belum tersedia. Alternatif:

```powershell
npx playwright install chromium
```

Screenshot dan hasil browser berada di `test-results/`. Seluruh tes ledger memakai in-memory atau fixture sementara, bukan database pemain. Rincian hasil aktual: [IMPLEMENTATION-STATUS](docs/waw/IMPLEMENTATION-STATUS.md).

## Struktur dan batas tanggung jawab

| Lokasi | Tanggung jawab |
|---|---|
| `src/server.mjs` | Server wallet, autentikasi, origin check, rate limit, asset web |
| `src/session.mjs` | Membaca sesi Arcade; login fixture hanya lokal |
| `src/db.mjs`, `src/rc-schema.mjs` | Skema kompatibel ledger Arcade; inisialisasi fixture |
| `src/val/ledger.mjs` | Transfer internal, posted/held/available, histori dan receipt |
| `src/val/commands.mjs` | Fingerprint payload bisnis dan guard retry legacy |
| `src/val/reserves.mjs` | Perlindungan cadangan treasury dengan aritmetika integer |
| `src/val/play-safety.mjs` | Blokir mandiri dan sesi/anggaran opsional lintas kanal |
| `src/val/schema.mjs` | Migrasi additive, opening balances, rekonsiliasi, fence writer |
| `web/` | UI wallet React, terpisah dari UI Arcade |
| `src/platform/` | Server VAL Lab persisten: akun, session, perangkat, ledger, intent, API integrasi |
| `mobile/` | SDK React Native, adapter biometrik/Keychain/NFC, contoh layar |
| `web/LabApp.jsx` | Console pengujian individual di `/lab` |
| `docs/api/` | Kontrak OpenAPI dan ekspor skema SQLite Lab |
| `integrations/arcade/` | Kontrak dan generator konektor fixture yang tidak menulis source referensi |
| `docs/archive/arcade-prototype/` | Arsip percobaan awal; bukan source runtime |

Ledger tetap memakai `accounts`, `transfers`, dan `entries`. Dua entry per transfer berjumlah nol. Receipt merupakan proyeksi journal yang sudah committed, bukan tabel saldo baru. Transfer, state game, reserve dan outbox tetap satu transaksi `BEGIN IMMEDIATE`.

Pada pocket Arcade, frontend tidak boleh memilih payout atau penerima arbitrer; API hanya mengekspos pembacaan dompet dan pengaturan keselamatan milik sesi terautentikasi. Pocket Lab menyediakan transfer ke akun uji melalui intent dan konfirmasi signature, dengan otorisasi pengirim dari sesi server. Nominal kontrak VAL memakai string integer; adapter ledger memeriksa overflow.

## Migrasi dan koneksi staging

Migrasi tidak dijalankan terhadap data aktif selama pengembangan ini. Lihat [runbook migrasi](docs/waw/MIGRATION.md) sebelum mencoba database staging.

```powershell
npm run migrate:val -- 'C:\path\staging.sqlite' --dry-run
```

Default dry-run membuat backup SQLite ke lokasi sementara dan memigrasi salinan tersebut. `--apply` adalah langkah operasional terpisah setelah review/backup. Writer Arcade lama ditolak setelah migrasi, sehingga konektor harus dipasang bersamaan dengan cutover; jangan menunjuk Arcade asli ke database yang telah dimigrasi.

Untuk staging yang **sudah dimigrasi dan memakai konektor yang kompatibel**, `VAL_DATABASE` menunjuk database bersama dan `VAL_ARCADE_URL` menunjuk aplikasi Arcade. Mode ini tidak membuat schema, akun demo, atau grant awal. Hosting lintas host, session handoff lintas domain, dan microservice ledger belum diterapkan.

## Keterbatasan

Ini fondasi lokal yang dapat dijalankan dan diuji, **belum rilis beta publik**. Kontrol Arcade untuk sesi 15 menit/anggaran 100 VAL masih opt-in; kuota harian, jeda minimum antar taruhan, aturan perubahan batas 24 jam, dan penyelesaian bonus noninteraktif saat blokir belum lengkap. Autoplay pada UI fixture dinonaktifkan. QR/P2P hanya aktif pada server Lab terpisah; pocket World, top-up dan integrasi pembayaran uang nyata belum tersedia.

Konektor WA diuji melalui adapter dan HTTP lokal; dua akun WA nyata dan jaringan WA live **belum diuji**. Integrasi WA-WORLD menjadi tahap berikutnya setelah kontrak identitas, ekonomi, dan lifecycle transaksi ditinjau.
# waw-ev-wallet
