# Tahapan EV-wallet VAL menuju aplikasi lengkap

Tanggal: 30 Oktober 2026. Proyek: `C:\Program Files X\waw-ev-wallet`.

Tujuan produk: e-wallet mandiri untuk keluarga WAW, dengan akun individual, transfer, permintaan pembayaran, QR, NFC, autentikasi perangkat dan integrasi aplikasi eksternal. Ruang lingkup yang disetujui saat ini tetap VAL virtual dan akun uji. Arcade hanya integrasi; saldo Lab, Arcade dan World tidak boleh otomatis digabung.

## Kondisi saat ini

Sudah berjalan: SQLite persisten, akun uji, ledger double-entry, transfer dengan idempotensi, histori/receipt privat, QR VAL Demo, kontrak challenge biometrik, SDK React Native, adapter NFC NDEF, request merchant dan polling outbox. **Tahap 1 selesai pada 30 Oktober 2026**: undangan registrasi satu kali oleh operator, role USER/MERCHANT/OPERATOR, profil, ganti password, recovery code sekali pakai, daftar/pencabutan sesi dan logout seluruh perangkat. **Tahap 2 juga selesai untuk Lab**: pembatalan intent pending, refund parsial/penuh bertanda tangan, notifikasi, filter riwayat server, receipt berelasi, dan pemulihan konfirmasi tersimpan setelah client restart. Console web membuktikan alur akun dan transaksi, belum merupakan aplikasi mobile lengkap. Sensor biometrik dan tag NFC fisik belum diuji.

Fondasi runtime kini memakai satu konfigurasi port: server utama **3212**, wallet konektor Arcade **3213**, Arcade fixture **8788**, Vite opsional **5173**. `npm start` menjalankan server utama. Semua angka dapat ditetapkan di `config/ports.json`; server tidak mengganti port diam-diam saat bentrok. Pengujian terisolasi tetap memakai port ephemeral.

## Urutan implementasi dan syarat selesai

| Tahap | Pekerjaan | Bukti selesai |
|---|---|---|
| 1. Akun dan keamanan pengguna — **SELESAI (Lab)** | Registrasi terkontrol untuk uji, profil, perubahan password, recovery terverifikasi, daftar sesi dan logout seluruh perangkat. Kanal pemulihan tahap Lab adalah delapan recovery code offline sekali pakai; tidak ada OTP email/SMS. Akun operator, merchant, pengguna dan service integration dipisahkan. | Tes membuat dua akun dengan password pilihan sendiri, login/pulih tanpa kredensial fixture, mencabut sesi/perangkat lama, dan menolak kenaikan role dari input pengguna. |
| 2. E-wallet pengguna sehari-hari — **SELESAI (Lab)** | Beranda saldo, kirim/terima, pencarian penerima, konfirmasi, receipt, filter riwayat server dan notifikasi status. Konfirmasi belum pasti disimpan di secure store per akun dan dipulihkan setelah client restart. Pembatalan intent pending dan refund bertanda tangan menjadi jurnal baru dengan referensi transaksi asal. | Tes membuktikan transfer/cancel/refund/retry/restart tidak menggandakan debit atau refund; dua writer refund tidak melebihi pembayaran; receipt/notifikasi privat; outbox merchant atomik dengan refund. |
| 3. Aplikasi React Native nyata | Bangun aplikasi Android terlebih dahulu dengan navigasi lengkap; sambungkan SDK, secure storage dan endpoint HTTPS. Enrollment kunci, sidik jari/biometrik, kamera QR, app lock dan alur perangkat hilang. iOS menyusul dengan build dan pengujian tersendiri. | Dua perangkat fisik dapat login dan transfer; pembatalan biometrik tidak membayar; token tidak tersimpan di storage biasa; transaksi tetap dapat diperiksa setelah aplikasi dibunuh. |
| 4. Pembayaran QR/NFC dan merchant | Scan kamera ke preview server; QR dinamis, expiry, status pembayaran merchant. Uji baca/tulis tag NFC NDEF, pembatalan dan tag rusak. Siapkan pending invoice merchant dan penanganan pembayaran terlambat. | Scan/tap tidak langsung mendebit; satu request hanya settled sekali; dua ponsel/tag fisik diuji, termasuk NFC tidak tersedia dan koneksi putus. |
| 5. Integrasi WAW dan operasional | Provision/rotasi credential per aplikasi, webhook bertanda tangan dengan retry/deduplikasi, dashboard operator, pencarian audit, rekonsiliasi terjadwal, limit transaksi, backup/restore. Lanjutkan Arcade staging sebelum mapping identitas WA-WORLD. | Callback berulang tidak menggandakan pesanan; merchant hanya melihat scope sendiri; restore mempertahankan saldo/jurnal; seluruh writer Arcade tetap menjaga reserve dan settlement atomik. |
| 6. Beta terbatas | HTTPS, monitoring, pemulihan insiden, uji beban berdasarkan target pengguna, audit akses, retensi data dan pengujian pemulihan. Pertahankan SQLite dahulu; evaluasi migrasi database dari kebutuhan concurrency/deployment yang terukur. Selesaikan blocker keselamatan Arcade sebelum memperluas integrasi tersebut. | Uji perangkat, rekonsiliasi, restore dan skenario gagal lulus; tersedia prosedur pemulihan; rilis hanya ke kelompok uji yang ditentukan. |

Urutan berikutnya adalah **tahap 3**, aplikasi Android React Native nyata di atas kontrak API yang kini stabil. Tahap 3–6 tetap backlog, bukan klaim telah diimplementasikan. Tidak ditetapkan estimasi kalender sebelum target perangkat dan tim pengujian diketahui.

## QRIS resmi dan uang nyata: jalur keputusan terpisah

QR VAL Demo tidak berubah menjadi QRIS hanya dengan format gambar. [Bank Indonesia menjelaskan QRIS sebagai standar pembayaran dan penggunaan melalui penyelenggara yang sesuai ketentuan](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/default.aspx). Jika kelak target berubah menjadi uang rupiah, tentukan model produk, mitra/provider dan ketentuan yang berlaku terlebih dahulu; selanjutnya kerjakan sandbox provider, verifikasi callback, rekonsiliasi settlement dan pengujian sebelum live.

Top-up rupiah, cash-out, transfer bank dan QRIS resmi belum menjadi tahap VAL virtual yang telah disetujui. Ledger/kredensial uang nyata harus dipisahkan dari kredit simulasi; tidak membuat kurs atau jembatan saldo kasino. NFC NDEF saat ini juga bukan pembayaran terminal bank atau emulasi kartu. Pilihan NFC antardua ponsel/terminal perlu evaluasi kemampuan platform dan integrasi tersendiri.

## Referensi implementasi

- [Server, database dan API](MOBILE-SERVER.md)
- [SDK, biometrik dan NFC React Native](../../mobile/README.md)
- [Status pemeriksaan dan blocker Arcade](IMPLEMENTATION-STATUS.md)
- [React Native: penyimpanan token, kunci dan keamanan aplikasi](https://reactnative.dev/docs/security)

Dokumentasi React Native menjelaskan bahwa AsyncStorage tidak tepat untuk token/secret; gunakan secure storage dan pengelolaan kunci perangkat pada implementasi native. Service credential merchant tetap di server.
