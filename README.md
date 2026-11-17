# Grid Puzzle

13 permainan taktik berbahasa Indonesia, **91 arena** dan **16 pilihan AI**. Semua peserta berinteraksi dengan dunia yang sama. Setiap kategori tersedia mulai level pertama, tanpa menyelesaikan kategori lain; progres level di dalam kategori tetap berurutan.

## Jalankan

```sh
npm install
npm run dev
```

Pilih algoritma dan satu sampai tiga lawan, simpan dengan **Save**, lalu **Mulai pertandingan**. Tidak ada pertandingan yang dihitung sebelum Play. Menang, seri, maupun kalah membuka level berikutnya dalam kategori tersebut.

## Permainan

| Kategori           | Mekanisme                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Labirin Kabut      | Pengetahuan pribadi, pemindai radius dua, pertama mencapai keluar menang.                                                                                                      |
| Lantai Runtuh      | Jejak runtuh setelah 24 tick dan gelombang menyapu arena. Bot terakhir bertahan menang; eliminasi serentak dapat seri.                                                         |
| Perburuan Bergerak | Cegat target di lintasan bersiku, bercabang ulang, dan berputar. Tangkapan +1; respawn 20 tick.                                                                                |
| Sambung Sirkuit    | Ubah saklar dan gerbang bersama, cocokkan pola, klaim kontrak +3.                                                                                                              |
| Ekspedisi Energi   | Baterai 24; gerak memakai energi, aktivasi suar memakai lima untuk +3. Charger berbagi stok 40, pulih satu dan mengisi maksimal empat per tick.                                |
| Jembatan Rakitan   | Kumpulkan maksimal tiga bahan, bangun bentang +2, rebut pulau +3. Setelah seluruh penanda diklaim, keluar +5 mengakhiri pertandingan.                                          |
| Dorong Peti        | Kotak dan ruang dorong bersama; peti di tujuan terkunci dan memberi pendorong +1. Dorongan ke sudut mati ditolak.                                                              |
| Zona Bom           | Sumbu 36 tick, jangkauan tiga, tembok kayu hancur +1, permata +2, eliminasi lawan +3. Ledakan berantai dan mengenai pemasang.                                                  |
| Ular Arena         | Ekor menghalangi semua bot, bertambah saat makan buah +1. Buah kembali setelah 100 tick. Bot tanpa langkah aman tereliminasi.                                                  |
| Arus Paksa         | Panah mendorong satu sampai tiga petak; es meluncurkan bot sampai keluar es atau terhalang. Token +2.                                                                          |
| Portal Berantai    | Pemakaian portal menggeser tujuan seluruh jaringan. Nomor kecil menunjukkan identitas, nomor tengah tujuan. Token +2.                                                          |
| Pagar Taktis       | Maksimal tiga pagar per bot, bertahan 100 tick; semua bot harus tetap bisa menjangkau setiap objektif. Token +2.                                                               |
| Operasi Senyap     | Patroli, kerucut pandangan, semak, dokumen +3. Terlihat terus 20 tick menyebabkan tertangkap. Pengalih perhatian menghentikan penjaga dekat selama 36 tick, cooldown 100 tick. |

Zona Bom dan Ular memberi kemenangan kepada satu-satunya bot yang bertahan; pada akhir lainnya skor menentukan pemenang. Mode skor lain memakai skor tertinggi. Satu tick = 50 ms; perburuan dan ular dibatasi 900 tick, lainnya 1.200 tick.

Setiap kategori mempunyai tujuh tema: kebun, gurun, hutan, salju, vulkanik, pabrik dan luar angkasa. Papan memiliki ukuran serta rasio yang berbeda. Empat posisi awal tersedia; benchmark memutar posisi agar keunggulan tempat tidak disalahartikan sebagai keunggulan algoritma. Bot dapat saling melewati; ekor dan peti tetap menghalangi.

Perebutan serentak diputuskan sesudah semua intent terkumpul, memakai hash seed, tick, objek dan algoritma. Status pemain dan urutan intent tidak memberi prioritas. Pembangunan bersama hanya membayar satu bahan; satu objektif hanya memiliki satu pemilik.

## Algoritma

Semua bot mendapat **64 operasi pencarian per tick** dan waktu berpikir tetap masuk waktu pertandingan. Operasi merupakan model pekerjaan pencarian, bukan waktu CPU identik: pemrosesan objek, cloning dan kebijakan objektif juga mempunyai biaya perangkat yang berbeda.

| AI                   | Implementasi dan batas                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A*                   | Biaya tindakan dan heuristic sesuai domain; gerbang, energi dan peti masuk state.                                                                     |
| Weighted A*          | Heuristic berbobot 1,5.                                                                                                                               |
| Greedy Best-First    | Mengutamakan heuristic.                                                                                                                               |
| Depth-First Search   | Menjelajahi satu cabang; kualitas rute tidak dijamin.                                                                                                 |
| Breadth-First Search | Meminimalkan jumlah tindakan, termasuk saat biaya tindakan berbeda.                                                                                   |
| Bidirectional BFS    | Khusus Kabut dan Perburuan dengan biaya seragam; alasan ketidaktersediaan tampil di pemilih peserta.                                                  |
| Dijkstra             | Antrean bucket biaya integer; minimum biaya pada graph perencanaan saat itu.                                                                          |
| D* Lite              | g/rhs, indexed queue, pemakaian ulang dan perbaikan graph. Tujuan atau jaringan global berubah menyebabkan reset.                                     |
| Random Walk          | Acak berbobot tujuan, keselamatan dan memori kunjungan, eksplorasi seragam 15%.                                                                       |
| MCTS                 | UCT dan transisi aturan sebenarnya; maksimal 32 rollout, kedalaman delapan, 1.024 operasi per keputusan. Hanya rollout selesai memperbarui statistik. |
| Beam Search          | Delapan kandidat per kedalaman, maksimal 192 lapisan; pemangkasan bisa membuang solusi.                                                               |
| RTAA*                | Maksimal 24 state lokal per pencarian; heuristic dipelajari antar pencarian dengan tujuan dan graph yang sama.                                        |
| ARA*                 | Mulai bobot 2,5, turunkan menuju satu, gunakan ulang g/OPEN/INCONS; maksimal 512 operasi tambahan setelah solusi pertama.                             |
| Maxⁿ                 | Pencarian komitmen aksi serentak: empat kandidat sendiri, dua per lawan, vector utility setiap pemain, maksimal 2.048 operasi.                        |
| Paranoid             | Graph keputusan yang sama, dengan respons lawan yang meminimalkan utility pemain.                                                                     |
| Utility AI + A*      | Pemilihan objektif memakai hadiah, waktu tiba, persaingan, energi dan risiko; navigasi memakai A*.                                                    |

Maxⁿ dan Paranoid memakai horizon terbatas pada komitmen aksi berikutnya, bukan solusi sempurna game serentak. MCTS memakai model lawan sederhana; ketiganya tetap memvalidasi aksi terhadap dunia langsung. Kabut hanya memberikan observasi yang diketahui, termasuk kepada simulasi.

Transisi arus, es, portal, bom, pagar, ekor dan patroli dipakai bersama oleh engine dan simulasi. Rencana yang menjadi tidak legal karena aksi lawan dibuang. Energi menyisakan cadangan sembilan setelah aktivasi. Puzzle peti direncanakan melalui subtujuan dorongan dan diverifikasi dengan tindakan langsung.

[Evaluasi setiap AI](docs/algorithm-evaluation.md) memuat hasil dan keterbatasan; [audit perubahan map](docs/map-review.md) memuat perbandingan terhadap commit sebelumnya.

## Kontrol dan penyimpanan

Web Worker menghitung maksimal delapan tick per batch playback. Jeda menghentikan permintaan, langkah manual menghitung satu tick, riwayat memuat hasil yang sudah dihitung. Kecepatan playback tidak mengubah hasil seed yang sama. Restart dan pergantian level membuang worker lama.

Spasi: Play/jeda. Panah kiri/kanan: riwayat saat fokus di luar formulir. Escape: tutup dialog. Statistik menampilkan operasi, ekspansi, memori, biaya tindakan dan waktu cari/gerak. Fokus peserta mengubah tampilan pengetahuan kabut dan rute.

Progres tetap memakai `grid-puzzle.progress.v5`, pilihan peserta `grid-puzzle.participants.v1`, suara `grid-puzzle.audio.v1`. Aturan kampanye baru memakai rulesVersion 5 sehingga metrik hasil lama dibedakan saat hasil baru disimpan. Storage yang diblokir memakai memori tab; sinkronisasi antar-tab dan Web Locks tetap tersedia.

## Konten dan verifikasi

`scripts/campaign-design.ts` membangun konten deterministik pada waktu build dari tujuh jenis arsitektur, konfigurasi kategori dan seed tetap. `scripts/author-arenas.ts` menyusun bagian. JSON berisi kondisi awal, tanpa jawaban atau rekaman pertandingan. Map tidak dibuat acak saat Play.

```sh
npm run content:generate
npm run content:build
npm run validate:levels
npm test
npm run typecheck
npm run build
npx tsx scripts/audit-arenas.ts
npx tsx scripts/review-maps.ts
npx tsx scripts/benchmark-solvers.ts --seeds=4
npm run test:visual -- http://127.0.0.1:5173
npm run test:participants -- http://127.0.0.1:5173
```

Validator memeriksa duplikat termasuk rotasi/refleksi, kemiripan setelah resize, objektif terhubung, pola sirkuit, cadangan energi, katalog, aset dan hasil simulasi. Tes memeriksa solusi peti, batas komputasi, replay deterministik, aturan bersama, dan transisi khusus setiap kategori baru.

Artefak lokal: `artifacts/arena-review` untuk screenshot, `artifacts/campaign-review` untuk audit, `artifacts/algorithm-audit` untuk seluruh pertandingan dan ringkasan per kategori. Persentase kemenangan tergantung roster, mode, posisi dan seed; algoritma yang lebih rumit tidak otomatis lebih kuat.

Renderer memakai PixiJS v8 dengan atlas pixel art yang tersedia dan glyph GraphicsContext. Aplikasi tetap memakai React, vinext dan konfigurasi Cloudflare Workers proyek ini.
