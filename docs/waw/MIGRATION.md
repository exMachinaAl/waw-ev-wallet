# Migrasi VAL Arcade — prosedur staging

Migrasi ini mempertahankan ledger lama, bukan mengonversi saldo ke ledger kedua. Semua nominal ACR tetap sama secara integer; ID akun, transfer, entries, histori, sesi, reserve dan outbox tidak ditulis ulang.

## Yang tersedia

`scripts/migrate-val.mjs` menyediakan:

- Dry-run default: membuka sumber read-only, membuat backup SQLite konsisten ke database sementara, lalu menjalankan migrasi pada backup itu.
- `--apply`: migrasi eksplisit pada file yang diberikan operator.
- Rekonsiliasi sebelum migrasi, pencatatan opening balances, metadata `currency=VAL`, `pocket=arcade`, `app_id=world-arcade`, tabel fingerprint dan kebijakan bermain.
- Trigger yang memerlukan fungsi koneksi `val_writer_v1()` pada writer. Binary Arcade lama tidak menyediakan fungsi itu dan gagal menulis.
- Pengulangan migrasi tidak membuat jurnal, grant, atau opening balance tambahan.

Skema genesis RC3 yang didukung: faucet 2.000.000, treasury 800.000, pemain 0 sebelum entries. Akun yang tidak cocok dengan genesis + entries membuat migrasi **ditolak**. Jangan menebak opening balance dari selisih yang tidak dijelaskan; audit dan manifest impor khusus diperlukan untuk data legacy dengan genesis berbeda.

## Urutan operasional

1. Siapkan salinan staging yang diotorisasi dari backup SQLite konsisten. Uji pembacaan/restore backup, catat hash file, versi source, waktu dan jumlah akun/jurnal.
2. Jalankan dry-run pada salinan tersebut. Periksa `reconciliation.ok`, seluruh akun pemain/treasury/faucet, dan reserve aktif. Defisit harus diselesaikan dengan prosedur ekonomi terotorisasi, bukan mengubah angka agar tes lulus.
3. Pastikan seluruh sumber writer diketahui: Web, WA, scheduler lottery/roulette, bonus, multiplayer, admin. Hentikan writer sebelum cutover.
4. Tinjau pemasangan konektor VAL dari proyek ini. Generator `arcade:prepare` hanya membuat fixture; ia bukan alat deployment produksi.
5. Ambil backup cutoff; jalankan `npm run migrate:val -- <staging.sqlite> --apply` pada target staging yang telah diperiksa.
6. Mulai hanya writer yang menyediakan kontrak VAL. Pastikan proses lama gagal tertutup. Hubungkan server wallet ke file staging yang sama; autentikasi membaca sesi Arcade.
7. Uji saldo lama, histori/receipt, sesi aktif, reserve, retry, settlement, outbox dan rekonsiliasi ulang. Pastikan tidak ada grant starter baru karena unit berubah.

**Sesudah write baru**, restore snapshot sebelum migrasi bukan rollback yang sah: ia menghapus transaksi. Gunakan versi kode kompatibel dan perbaikan ke depan; semua delta harus dipertahankan. Fence writer tidak boleh dihapus hanya agar kode lama dapat berjalan.

## Retry sebelum dan sesudah migrasi

- Transfer lama dapat dibandingkan melalui kedua entries, akun, nominal dan alasan; key sama/payload berbeda ditolak.
- Perintah game lama tertentu tidak menyimpan request fingerprint. Receipt/histori tetap dapat dibaca, tetapi replay perintah yang fingerprint-nya tidak dapat dibuktikan ditolak dengan `LEGACY_COMMAND_UNVERIFIABLE`. Baca state/receipt lama; jangan membuat ID perintah baru untuk mencoba ulang taruhan yang belum pasti.
- Perintah baru menyimpan fingerprint dalam transaksi yang sama. `expected_version` merupakan precondition untuk perintah baru, bukan bagian payload bisnis pada game/room/blackjack legacy, karena konektor WA mengambil ulang versi ketika pesan diterima lagi. Game, aksi, stake, pilihan, identitas dan referensi tetap terikat.
- API pembuatan sesi legacy tanpa `command_id` tetap diterima untuk kompatibilitas; klien tersebut tidak boleh mengulang pembuatan blackjack secara otomatis. UI dan konektor fixture yang disediakan mengirim key.

## Batas audit

Trigger writer fence melindungi terhadap binary lama, bukan administrator database yang memiliki akses penuh. Database audit tidak diklaim tahan modifikasi oleh host administrator. Backup/restore pada database pemain, cutover aktif, load test multi-process produksi dan publikasi **belum dilakukan**.
