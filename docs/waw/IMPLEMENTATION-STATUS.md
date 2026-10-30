# Status implementasi EV-wallet VAL

Tanggal: **30 Oktober 2026**. Proyek aktif: **`C:\Program Files X\waw-ev-wallet`**.

**Fondasi wallet mandiri dan integrasi Arcade lokal berjalan dan diuji.** Integrasi dibuktikan pada fixture terisolasi, bukan pemasangan ke Arcade aktif. Belum siap beta publik.

## Penambahan server mobile dan Lab

Permintaan terbaru mengaktifkan VAL virtual dan akun uji terlebih dahulu. Server baru `src/platform/server.mjs` berjalan pada port **3212**, API `/api/mobile/v1`, console `/lab`, dengan database persisten `.local/val-lab.sqlite`. Seluruh perubahan tetap di proyek wallet ini.

- Akun individual `alice.test`, `bob.test`, `merchant.test`, `operator.test`, 1.000 VAL per akun dari faucet saat init pertama; password acak di `.local/test-accounts.json`. Init ulang tidak mereset saldo/kredensial.
- Delapan belas tabel SQLite untuk akun, ledger double-entry, session, perangkat, challenge, payment intent, idempotency, refund, notifikasi, integrasi, audit dan outbox; [ekspor SQL](../api/mobile.schema.sql).
- Transfer P2P, request pembayaran, QR SVG nyata dan URI NFC NDEF; preview tidak mendebit, konfirmasi signature memindahkan saldo secara atomik, receipt/histori privat.
- Login password scrypt, lockout, access/refresh token berotasi, enrollment/revoke perangkat, challenge login dan konfirmasi RSA yang terikat transaksi. Data sidik jari tidak dikirim ke server.
- SDK React Native dengan secure-store injection, adapter Keychain/biometrik/NFC dan contoh layar; [panduan native](../../mobile/README.md). Sensor sidik jari, NFC fisik, build native dan kamera konkret belum diuji/disertakan sebagai aplikasi lengkap.
- Service credential merchant dengan receiver terikat dan outbox polling terisolasi app. Tidak mengakses saldo/kredensial Arcade atau menggabungkan ekonomi.
- Console browser untuk menguji akun terpisah, transfer, QR, retry setelah respons hilang, riwayat dan receipt. Kunci browser berlabel software; bukan sensor biometrik.

QRIS/EMV, uang nyata dan transfer antarpocket nonaktif. Hardware attestation, recovery operator/support produksi, distribusi app native dan kesiapan operasional produksi belum selesai. Rincian kontrak dan batas implementasi: [MOBILE-SERVER.md](MOBILE-SERVER.md).

## Tahap 1 akun dan keamanan pengguna

Selesai untuk environment Lab pada 30 Oktober 2026:

- Schema platform versi 2 dimigrasikan secara additive. `users.role`, undangan registrasi, hash recovery code dan konteks sesi ditambahkan tanpa reset saldo/password.
- `operator.test` membuat undangan satu kali untuk role USER atau MERCHANT. Pendaftar tidak dapat mengirim atau mengubah role sendiri.
- Pendaftar memilih handle/nama/password dan menerima delapan recovery code offline sekali pakai. Server menyimpan SHA-256 hash kode, bukan nilai asli.
- Profil hanya mengubah nama tampilan. Ganti password memerlukan password saat ini dan mencabut sesi lain.
- Recovery code mengganti password, mengonsumsi kode, mencabut seluruh sesi dan perangkat, serta menerbitkan kode baru.
- Daftar sesi memberi label klien dan aktivitas terakhir; pengguna dapat mencabut satu sesi, perangkat lain, atau semuanya.
- API, SDK React Native, OpenAPI dan console `/lab` mencakup seluruh alur tersebut. Service integration tetap memakai credential dan scope terpisah.

Pemeriksaan tahap 1 menambah tiga kelompok tes: registrasi USER/MERCHANT dan role enforcement; profil/password/recovery/session/device revocation; alur HTTP melalui SDK termasuk logout-all. Kanal recovery Lab adalah kode offline, belum email/SMS OTP. Pemulihan operator oleh administrator, verifikasi identitas eksternal dan support workflow produksi tetap bagian kesiapan operasional tahap selanjutnya.

## Tahap 2 transaksi pengguna sehari-hari

Selesai untuk environment Lab pada 30 Oktober 2026. Schema platform versi 3 menambahkan `refunds` dan `notifications` secara additive.

- History difilter server berdasarkan jenis dan arah sebelum pagination; wallet snapshot membawa jumlah notifikasi belum dibaca.
- Settlement, pembatalan intent pending dan refund membuat notifikasi privat. Pengguna dapat menandai satu atau semua notifikasi dibaca.
- Receipt menampilkan lawan transaksi, transaksi asal refund, total sudah direfund dan sisa yang masih dapat dikembalikan.
- Refund hanya dapat dimulai penerima entry positif transaksi awal, memerlukan challenge signature perangkat, dan menjadi jurnal `REFUND` baru. Jumlah kumulatif tidak dapat melebihi pembayaran awal; saldo pemberi refund tidak boleh negatif.
- Refund merchant menulis `payment.refunded` ke outbox integration dalam transaksi SQLite yang sama. Fault injection pada outbox membatalkan proof, saldo, jurnal, refund, notifikasi dan command.
- SDK menyimpan ID, proof dan idempotency key konfirmasi per akun melalui secure store. Instance client baru dapat enquiry atau retry request yang sama setelah restart tanpa debit ganda.
- Console `/lab` menyediakan notifikasi, cancel, signed refund, receipt berelasi dan filter history. QRIS/uang nyata tetap nonaktif.

## Pembaruan port dan roadmap

Port runtime kini terpusat di `config/ports.json`: e-wallet utama 3212, wallet konektor Arcade opsional 3213, Arcade fixture 8788, Vite opsional 5173. `npm start`/`npm run dev` menjalankan server utama persisten; `server:lab` tetap alias. Tidak ada listener/proxy aplikasi aktif pada port lama yang bentrok.

Validasi terbaru: `npm test` **32/32**, syntax **38 modul**, build dan ekspor OpenAPI lulus. Smoke test memastikan override/validasi port, startup dua wallet bersamaan, proses duplikat ditolak tanpa mengganggu server pertama, proxy Vite GET/POST/OpenAPI dan penolakan Origin asing. Demo Arcade yang gagal bind wallet menutup listener Arcade miliknya dan membersihkan fixture sementara. Tes memakai proses milik pemeriksaan sendiri, tanpa menghentikan layanan pengguna.

Tahapan berikutnya dan syarat selesai per fitur tercatat di [ROADMAP-EWALLET.md](ROADMAP-EWALLET.md). Roadmap belum merupakan implementasi fitur tersebut.

## Lokasi dan baseline

Pengguna menegaskan wallet adalah aplikasi tersendiri; Arcade hanya referensi integrasi. Pekerjaan awal yang salah ditempatkan di Arcade sudah dikembalikan dan disimpan di [arsip prototipe](../archive/arcade-prototype/README.md). Source aktif tidak mengimpor arsip tersebut.

Folder wallet awalnya hanya berisi arsip dan catatan, tanpa package/source aktif atau repository Git. Tidak ada perubahan aplikasi pengguna yang ditimpa. Source referensi Arcade tetap `1.0.0-rc.3`; status Git referensi sama seperti awal (`README.md` dimodifikasi dan `docs/waw/` belum dilacak, keduanya perubahan pengguna). Generator fixture memverifikasi hash source yang dibaca.

Baseline historis Arcade pada percobaan awal: 107/108 tes. Satu tes admin gagal karena import server membaca `.env` lokal dan mengaktifkan admin. Fixture baru tidak memanggil pembaca `.env`; 108/108 tes regresi Arcade lulus. Tidak ada `.env`, database pemain atau sesi WA yang disalin ke fixture.

## Fitur Arcade yang berjalan

- Aplikasi React/Vite dan server konektor Arcade sendiri pada default port 3213 (`npm run server:arcade` atau `npm run demo:arcade`). Server e-wallet utama memakai 3212 melalui `npm start`. Semua port runtime terpusat di `config/ports.json`.
- Identitas visual VAL, saldo tersedia/tercatat/ditahan, loading, error, retry, refresh, empty state, dan layout mobile.
- Histori dengan pagination keyset dan filter jenis pada halaman yang telah dimuat.
- Receipt privat: ID, referensi, waktu WIB, status posted, nominal; payout dibedakan dari hasil bersih entry terkait yang sudah tercatat.
- Snapshot saldo + histori + keselamatan dalam satu transaksi server. Frontend tidak menghitung saldo otoritatif sendiri.
- Server Arcade hanya mengaktifkan pocket `arcade`. Lab berjalan di server/database terpisah seperti di atas. Tidak ada saldo World, transfer antarpocket, top-up, cash-out, pembelian VAL atau koneksi uang nyata.
- Login demo lokal; mode connected membaca sesi Arcade terverifikasi, tanpa grant demo atau login produksi kedua.
- Konektor fixture mengarahkan writer game/admin ke modul VAL di proyek ini. Debit/payout benar-benar melewati wallet; API ACR legacy tetap kompatibel secara angka.
- Transfer dua sisi, fingerprint command, retry tanpa debit/payout ganda, konflik payload, validasi integer/overflow, penolakan overdraft, tenant scope dan reserve treasury.
- Blokir mandiri 1/7/30 hari serta sesi opsional 15 menit, anggaran bruto maksimal 100 VAL, dan jeda 15 menit. Keputusan tersimpan di backend lintas Web/WA; payout/refund tidak diblokir.
- Autoplay disembunyikan pada UI Arcade fixture. RNG, paytable dan hak payout tidak diubah.
- Migrasi additive, dry-run, opening balances eksplisit, rekonsiliasi semua akun dan fence writer lama. Apply hanya diuji pada fixture.

## Arsitektur dan file penting

| File | Tanggung jawab |
|---|---|
| `src/server.mjs`, `src/session.mjs` | App wallet sendiri; sesi server, Origin, rate limit, login demo loopback |
| `src/db.mjs`, `src/rc-schema.mjs` | Ledger/schema kompatibel Arcade; satu database bersama ketika terhubung |
| `src/val/ledger.mjs` | Transfer internal dan proyeksi saldo/receipt, tanpa endpoint payout bebas |
| `src/val/commands.mjs` | Fingerprint payload bisnis; precondition versi WA tidak mengubah identitas retry |
| `src/val/reserves.mjs` | Reserve treasury integer, write dalam transaksi caller |
| `src/val/play-safety.mjs` | Enforcement stake bersama dan audit tanpa identitas WA penuh |
| `src/val/schema.mjs` | Opening balances, metadata VAL, rekonsiliasi, guard writer lama |
| `web/App.jsx`, `web/styles.css` | UI mandiri, modal receipt dengan fokus keyboard, mobile |
| `integrations/arcade/prepare.mjs` | Membaca referensi, menghasilkan konektor di `.local/arcade` |
| `scripts/demo-arcade.mjs` | Dua app dengan satu database sementara baru |
| `scripts/migrate-val.mjs` | Dry-run default; apply eksplisit terpisah |

Integrasi Arcade tidak memakai microservice ledger atau dual-write. SQLite bersama memungkinkan transfer, state game, reserve dan outbox satu commit. Wallet memproyeksikan ledger yang sama melalui koneksi sendiri. Server Lab menyediakan API remote untuk ekonomi ujinya sendiri; ekstraksi settlement game lintas host masih memerlukan protokol pemulihan transaksi terdistribusi yang belum tersedia.

## Inventaris jalur ekonomi

| Jalur Arcade | Integrasi |
|---|---|
| Starter player | Faucet ke pemain; hanya saat identitas baru dibuat |
| A1-01..05, roulette solo, blackjack solo | Transfer VAL dalam transaksi game, fingerprint action, creation key pada klien fixture |
| Free spin dan guci | Payout/reserve lama dipertahankan; replay choice tidak membayar ulang |
| Dice Duel | Semua peserta melewati guard stake; kegagalan satu peserta membatalkan settlement |
| Blackjack multiplayer | Reserve, entry, payout dan state meja tetap atomik |
| Lottery | Entry, refund/cancel, payout dan scheduler memakai ledger yang sama |
| Roulette bersama | Stake slip, refund dan settlement memakai ledger yang sama |
| Admin correction / funding treasury | Memindahkan saldo yang sudah ada, tanpa mint baru |
| Adapter WA Arcade | Command ID stabil; tidak menulis V/VCUR; diuji melalui HTTP lokal |

## Pemeriksaan aktual

Lingkungan: Node **24.21.0**, npm **11.19.0**, Windows, Playwright dengan **Microsoft Edge headless**.

| Perintah | Hasil |
|---|---|
| `npm test` | **32/32 lulus**, core Arcade + server Lab/SDK/native adapter, tahap 1 dan tahap 2 |
| `npm run test:platform` | **22/22 lulus**, subset server Lab/SDK + adapter, tahap 1 dan tahap 2 (termasuk dalam 32 di atas) |
| `npm run test:integration` | **9/9 lulus**, engine Arcade fixture serta dua server/koneksi database |
| `npm run test:arcade-regression` | **108/108 lulus**, salinan suite Arcade RC3 |
| `npm run check` | Lulus syntax dan versi Node |
| `npm run build` | Lulus build React/CSS production |
| `npm run test:browser` | **12 skenario lulus**, tanpa page error |
| `npm run test:lab:browser` | **13 skenario lulus**, akun, sesi/recovery, transfer, retry, QR, signed refund, cancel, notifikasi, filter, mobile, QRIS ditolak, rekonsiliasi |

Total tes Node: **149 lulus**; browser **25 skenario lulus**. Browser Arcade memeriksa login, saldo server, receipt/keyboard, main di UI Arcade lalu refresh wallet, payout/net, pagination, filter kosong, kegagalan API/retry, reload, mobile 390/320 px, self-exclusion wallet yang menolak taruhan Arcade, dan rekonsiliasi semua akun.

Screenshot: `test-results/val-desktop.png`, `val-mobile.png`, `val-receipt-mobile.png`. Ringkasan: `test-results/browser-results.json`. Artefak lokal ini tidak dilacak.

Screenshot Lab: `test-results/val-lab-desktop.png`, `val-lab-mobile.png`; hasil `test-results/lab-browser-results.json`. Pengujian adapter biometrik/NFC memakai mock; bukan hasil perangkat fisik.

Tes penting lain:

- Lab: dua koneksi worker SQLite bersamaan membelanjakan 700 dari saldo 1.000; hanya satu commit, saldo 300 setelah reopen.
- Lab: fault injection pada outbox membatalkan semua debit/intent/proof, retry sukses setelah fault dihapus. Respons HTTP hilang setelah commit diuji di browser; retry tidak menambah debit.
- Lab: expired/replayed challenge, perangkat dicabut, sesi logout, login keluarga lain, nominal berubah dan receipt milik orang lain ditolak. Rotasi refresh pada keluarga sesi yang sama tetap mendukung konfirmasi.
- Lab: hash token, lockout password bersamaan, normalisasi kunci RSA, scope service merchant, isolasi cookie Arcade dan penolakan QRIS diuji.
- Dua worker SQLite bersamaan membelanjakan 400 dari saldo 500: satu berhasil, satu ditolak; saldo 100. Retry setelah reopen menunjuk jurnal lama.
- Fault injection sebelum commit outbox membatalkan state game, ledger, command dan reserve dalam transaksi yang sama.
- Dua server memakai file ledger bersama melalui dua koneksi; transaksi WA terbaca di wallet, blokir wallet berlaku di WA, retry committed tetap terbaca.
- Migrasi fixture mempertahankan ID/saldo/sesi/entries/reserve; run kedua tidak menambah perubahan; writer tanpa fungsi VAL ditolak.
- Treasury dan faucet direkonsiliasi dengan opening balance, bukan hanya pemain.

## Migrasi dan status penerapan

Versi metadata `val-arcade-1`. Ledger lama dipertahankan; metadata/tabel kontrol ditambahkan. Genesis yang didukung: treasury 800.000, faucet 2.000.000, pemain 0 sebelum entries.

**Tidak diterapkan ke database pemain atau Arcade aktif.** Dry-run/apply hanya pada fixture sintetis. Jika genesis + entries tidak cocok atau reserve defisit, migrasi berhenti. Tidak dibuat entry penyeimbang untuk menyembunyikan selisih.

Panduan: [MIGRATION.md](MIGRATION.md). Replay command legacy tanpa fingerprint ditolak aman; histori/receipt tetap terbaca. Pembuatan sesi dari klien legacy tanpa command ID masih mempunyai keterbatasan retry; klien fixture sudah mengirim ID.

## Blocker beta publik

1. Batas sesi masih **opt-in**, belum syarat semua taruhan. Kuota waktu/ronde harian WIB, jeda antar taruhan, perubahan limit tertunda 24 jam dan hide-casino belum lengkap.
2. Bonus interaktif saat self-exclusion masih mengikuti game legacy. Penyelesaian noninteraktif/timeout yang mempertahankan hak payout perlu diselesaikan sebelum beta.
3. Konektor produksi belum dipasang; backup/restore data aktif, drain writer, cutover, forward repair dan observability belum dijalankan.
4. Session handoff lintas host/domain belum ada. Demo berbagi cookie host 127.0.0.1; produksi memerlukan reverse proxy/scope cookie atau handoff terverifikasi.
5. Kalibrasi probabilitas, usability, audit keamanan menyeluruh, load test dan crash lintas proses produksi belum dilakukan. Lulus ledger bukan bukti siap publik.
6. Dua akun WA nyata / koneksi WA live: **BELUM DIJALANKAN**. Tes adapter lokal bukan pengganti.

## Selanjutnya: WA-WORLD

- Audit ekonomi, ledger, issuance dan identitas WA-WORLD sebelum menentukan adapter.
- Mapping identitas harus memakai bukti kendali, app scope dan lifecycle session; jangan menggabungkan akun dari nama/nomor saja.
- V/VCUR tetap terpisah. Pocket World belum diaktifkan atau diisi saldo.
- Selesaikan blocker keselamatan dan prosedur staging Arcade sebelum memperluas integrasi.
- **QR VAL Demo** dan P2P Lab kini berjalan melalui server terpisah; QRIS/DANA, koneksi uang nyata, dan ekstraksi settlement Arcade remote belum diimplementasikan.
