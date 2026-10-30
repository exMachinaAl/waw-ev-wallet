# Kontrak EV-wallet VAL v1

Server wallet membaca session Arcade melalui cookie HttpOnly `wae_session` / `__Host-wae_session`. Pemilik, tenant `wa-world`, dan scope aplikasi berasal dari sesi server. Tenant bernama `wa-world` di skema Arcade lama **bukan** izin mengakses ekonomi WA-WORLD.

| Method/path | Perilaku |
|---|---|
| `GET /api/health` | Mode wallet dan konfigurasi link Arcade; bukan pemeriksaan kesehatan jaringan Arcade |
| `POST /api/demo-login` | Hanya demo localhost, akun fixture; tidak tersedia pada mode connected |
| `GET /api/me` | Identitas internal dan expiry sesi aktif |
| `POST /api/logout` | Mencabut sesi aktif yang dipakai wallet/Arcade |
| `GET /api/val/v1/snapshot?cursor=&limit=` | Saldo, halaman histori dan status keselamatan dalam satu snapshot SQLite |
| `GET /api/val/v1/wallets` | Satu pocket aktif: Arcade |
| `GET /api/val/v1/transactions?cursor=&limit=` | Pagination keyset; limit 1–100, default 20 |
| `GET /api/val/v1/transactions/{id}` | Receipt milik akun; akun lain mendapat 404 |
| `GET /api/val/v1/play-safety` | Status sesi, anggaran, jeda dan blokir |
| `POST /api/val/v1/play-safety` | `START_SESSION` dengan budget integer 1–100 atau `EXCLUDE` selama 1/7/30 hari |

Mutasi browser memerlukan Origin yang sesuai. Tidak ada endpoint public untuk debit, payout, mint/grant tambahan, transfer antarpemain atau penggantian penerima.

Contoh wallet:

```json
{"currency":"VAL","pocket":"arcade","app_id":"world-arcade","posted":"500","held":"0","available":"500","legacy_currency":"ACR"}
```

Saldo pemain tidak memiliki hold aktif pada model Arcade saat ini; stake langsung menjadi debit. Reserve kewajiban payout berada pada treasury. Tampilan held pemain 0 tidak berarti treasury bebas dari kewajiban.

Receipt menampilkan jenis `INITIAL_CREDIT`, `STAKE`, `PAYOUT`, `REFUND`, atau `CORRECTION`, `amount`, `delta`, timestamp UTC milidetik, status `POSTED`, ID jurnal dan referensi bisnis. UI memformat waktu dalam Asia/Jakarta.

Jika referensi game diketahui, receipt menyertakan entries terkait milik pemain yang sama dan `summary.net_posted`. Angka ini hanya menghitung entry yang telah posted. Bonus/payout yang belum diselesaikan tidak diprediksi dan tidak diklaim sudah sukses. Keterangan payout tidak sama dengan keuntungan bersih.

## Kontrak server internal

`postTransfer(db,{tenant,from,to,amount,eventKey,reason,kind})` hanya dipakai game/admin terotorisasi dalam transaksi database yang sudah dibuka. Fungsi ini menolak write di luar transaksi, nilai pecahan/tidak aman, saldo tidak cukup, saldo treasury yang masih dicadangkan, dan transfer langsung pemain-ke-pemain.

`eventKey` yang sama dibandingkan dengan jurnal/entries lama; payload sama mengembalikan ID jurnal lama, payload berbeda menghasilkan conflict. `kind=CORRECTION` adalah opsi internal admin, bukan input browser bebas. Tidak boleh dipakai untuk menghindari kontrol stake.

`reserve/releaseReserve` juga beroperasi pada transaksi caller. Game mengunci cadangan yang tepat, mencatat hasil, melepaskan kewajiban yang diselesaikan, lalu memposting payout dalam satu commit. Pelepasan reserve bukan endpoint browser.

World, Lab, QR VAL Demo dan layanan wallet jarak jauh merupakan extension point yang belum aktif. Memindahkan kontrak ini melalui HTTP memerlukan protokol prepare/settle/outbox/inbox dan pemulihan crash yang belum diimplementasikan.
