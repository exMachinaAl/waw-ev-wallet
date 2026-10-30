# Konektor WORLD Arcade Engine

EV-wallet VAL adalah proyek terpisah. Direktori source Arcade hanya dibaca oleh `prepare.mjs`; tidak ada file referensi yang ditulis, database pemain yang dibuka, atau `.env`/sesi WA yang disalin.

## Model integrasi lokal

- Server dan UI wallet konektor berada di proyek ini, pada port 3213. Server e-wallet utama tetap 3212. Port diatur melalui `config/ports.json`.
- Arcade fixture yang dibangkitkan berada di `.local/arcade`, pada port 8788.
- Kedua aplikasi memakai satu database fixture SQLite. Wallet tidak membuat saldo bayangan.
- Adapter mengganti impor writer ledger di fixture dengan modul VAL dari proyek ini. Debit, payout, reserve, state game dan outbox tetap berada dalam transaksi database Arcade yang sama.
- Session browser Arcade dibaca wallet dari `browser_sessions`; demo lokal berbagi cookie host `127.0.0.1` lintas port. Tidak ada login produksi kedua atau kredensial layanan di browser.
- Pemisahan host/deployment produksi memerlukan rancangan session handoff/reverse proxy dan belum diterapkan.

## Menyiapkan fixture

```powershell
npm run arcade:prepare -- "C:\Program Files X\WORLD-Arcade-Engine-Main"
npm run demo:arcade
```

Prepare menerima versi `1.0.0-rc.3` dan memverifikasi anchor patch. Perubahan source yang tidak kompatibel membuat proses gagal; jangan memaksa patch pada versi lain. Manifest SHA-256 mencatat source yang disalin. Artefak `.local/` dapat dibangkitkan ulang dan tidak merupakan fork aplikasi wallet.

Demo membuat database sementara baru setiap kali dijalankan. Buka wallet, masuk demo, lalu buka Arcade melalui kartu aplikasi. Kedua layar melihat akun dan histori yang sama. Mengakhiri demo menghapus hanya direktori fixture sementara yang dibuat oleh proses tersebut.

## Batas saat ini

Ini integrasi lokal yang diuji, bukan pemasangan pada Arcade aktif. Penerapan ke staging/live memerlukan backup, rekonsiliasi, migrasi eksplisit, penghentian writer lama, pemasangan konektor dan pengujian ulang. SQLite bersama mengasumsikan kedua proses berada di host yang sama. Ekstraksi ledger melalui HTTP belum tersedia; pemisahan transaksi ke dua database tidak didukung.

Writer lama diblokir oleh trigger SQLite setelah migrasi VAL. Jangan menjalankan Arcade asli terhadap database yang sudah dimigrasi tanpa konektor. API ACR lama tetap kompatibel secara angka dan respons dasar; UI Arcade fixture masih menampilkan beberapa label ACR selama transisi.
