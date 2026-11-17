# Grid Puzzle

Tujuh permainan taktik berbahasa Indonesia, **49 arena terkurasi**, dan sepuluh algoritma. Seluruh peserta bermain pada arena bersama: perubahan peti, jembatan, saklar, stok, dan lantai ikut memengaruhi lawan.

## Jalankan

```sh
npm install
npm run dev
```

Buka alamat Vite. Setiap kategori langsung bisa dimainkan mulai level pertama, tanpa menyelesaikan kategori lain. Pilih algoritma dan satu sampai tiga lawan, simpan dengan **Save**, lalu **Mulai pertandingan**. Menang, seri, atau kalah tetap membuka level berikutnya dalam kategori tersebut. Tidak ada pertandingan yang dihitung sebelum Play.

## Tujuh permainan

| Permainan          | Cara bermain dan hasil                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Labirin Kabut      | Pemindai radius dua petak membuka pengetahuan pribadi tiap bot. Posisi keluar diketahui; bentuk jalan harus ditemukan. Pertama mencapai keluar menang.                                                                                                                                                 |
| Lantai Runtuh      | Petak runtuh 24 tick setelah ditinggalkan; gelombang keruntuhan menyapu arena. Spawn terlindungi 160 tick. Bot tanpa pijakan berikutnya tereliminasi. Bertahan paling lama menang.                                                                                                                     |
| Perburuan Bergerak | Cegat target pada lintasan bergerak untuk satu poin. Target muncul kembali 20 tick kemudian di titik berikutnya. Skor terbanyak menang.                                                                                                                                                                |
| Sambung Sirkuit    | Cocokkan saklar dengan pola kontrak. Saklar juga mengubah gerbang bersama. Datangi dan klaim terminal yang tersambung untuk tiga poin, lalu kerjakan kontrak berikutnya.                                                                                                                               |
| Ekspedisi Energi   | Energi maksimal 24; langkah biasa memakai satu, medan lambat empat. Aktivasi suar memakai lima energi dan memberi tiga poin. Pengisian bersama memberi maksimal empat per tick, stok 40, pulih satu per tick. Bot kehabisan energi di luar stasiun mogok.                                              |
| Jembatan Rakitan   | Ambil bahan, maksimal tiga. Bentang membutuhkan satu sampai tiga bahan dan memberi dua poin kepada pembangun. Jembatan jadi dapat dipakai semua bot. Penanda pulau memberi tiga poin; setelah seluruh penanda diklaim, keluar memberi lima dan mengakhiri pertandingan. Bahan kembali setelah 80 tick. |
| Dorong Peti        | Peti dan ruang manuver dipakai bersama. Peti yang masuk tujuan terkunci dan memberi satu poin kepada pendorongnya. Sudut mati statis ditolak. Skor terbanyak menang.                                                                                                                                   |

Setiap kategori mengikuti tema kebun, gurun, hutan, salju, vulkanik, pabrik, dan luar angkasa. Level awal memperkenalkan aturan; level lanjut menambah cabang, risiko, ketergantungan tindakan, dan interaksi. Papan terbesar berisi 21 × 15 petak; puzzle peti lebih kecil agar susunannya tetap terbaca.

Bot dapat saling melewati. Perebutan serentak dihitung sesudah semua tindakan pada tick yang sama dikumpulkan. Prioritas memakai hash seed, tick, objek, dan algoritma. Urutan peserta maupun status sebagai pemain tidak memberi hak atas objek. Dua bot yang membangun bentang sama hanya menghasilkan satu pembangunan dan satu pembayaran bahan. Finis kabut serentak dan skor tertinggi sama ditampilkan sebagai seri.

## Algoritma dan simulasi

Satu tick adalah 50 ms. Semua algoritma mendapat **64 operasi per tick**. Perbandingan antrean, pemeriksaan aksi, perluasan state, evaluasi, dan pemulihan rencana menggunakan anggaran. Waktu pertandingan mencakup menghitung dan bertindak. Ini model pekerjaan algoritma, bukan waktu CPU perangkat.

Tindakan mempunyai durasi: langkah biasa empat tick, medan lambat enam belas, mendorong minimal delapan, membangun dua belas, saklar/klaim/pengambilan bahan empat, dan pengisian satu. Batas pertandingan 1.200 tick.

- **A\*** menggunakan perkiraan yang sesuai tindakan dan biaya; **Weighted A\*** memakai bobot 1,5; **Greedy** mengutamakan perkiraan; **DFS** menelusuri cabang; **BFS** meminimalkan jumlah tindakan.
- **Dijkstra** memakai antrean bucket untuk biaya integer dan meminimalkan biaya rencana pada domain yang diberikan.
- **D\* Lite** menyimpan `g`, `rhs`, serta antrean berindeks. Perubahan petak dan pengisian stasiun memperbaiki bagian graph yang terdampak. Pergantian tujuan menginisialisasi pencarian baru. Pembaruan yang datang saat operasi tertunda tidak menerbitkan rencana lama.
- **Random Walk** memakai pilihan acak berbobot, memori kunjungan, bias tujuan dan keselamatan, dengan peluang eksplorasi 15%.
- **MCTS** memakai UCT, bias tujuan, serta rollout terarah. Batasnya 32 rollout, delapan tindakan per rollout, dan 1.024 operasi per keputusan. Pilihan awal dievaluasi dengan simulasi pendek terlebih dahulu; keputusan yang sudah jelas dapat selesai lebih cepat. Hanya rollout selesai yang memperbarui statistik.
- **Bidirectional BFS** tersedia pada navigasi kabut dan perburuan dengan biaya seragam. Domain tindakan lain dan medan lambat menampilkan alasan ketidaktersediaannya.

`PlanningDomain` menghasilkan rencana tindakan eksplisit, termasuk prasyarat sumber daya, saklar, dan posisi peti. Kebijakan objektif dipakai bersama oleh bot rute. Bot energi menyisakan sembilan energi setelah aktivasi; validator memastikan setiap suar mempunyai rute kembali ke stasiun dalam anggaran itu. Bot memilih pengisian ketika perlu. Jembatan direncanakan sebagai tahap pengambilan bahan, pembangunan, dan klaim; puzzle peti memakai subtujuan dorongan yang bisa diuji lalu direncanakan ulang setelah perubahan lawan.

Aturan transisi langsung dan rollout MCTS berada di fungsi yang sama. Model lawan dalam rollout memakai tindakan legal dengan kebijakan sederhana dan seed; hasilnya merupakan perkiraan. Solver kabut hanya menerima observasi yang sudah diketahui, termasuk dalam rollout. Tidak ada akses peta tersembunyi melalui state internal bot lain.

Web Worker menghitung batch maksimal delapan tick mengikuti waktu playback. Jeda menghentikan permintaan baru; langkah manual menghitung satu tick. Riwayat hanya berisi tick yang sudah dihitung. Kecepatan 0,5×–4× tidak mengubah hasil seed yang sama. Pergantian tab menjeda permainan; restart dan pergantian level membuang worker sebelumnya.

## Kontrol dan progres

Pilih peserta yang diamati untuk melihat pengetahuan kabut, kandidat state, dan rencananya. Statistik memisahkan operasi, ekspansi, memori, biaya tindakan, dan waktu cari/gerak. HUD menampilkan objektif serta sumber daya mode aktif.

Spasi mengatur Play/jeda; panah kiri/kanan menelusuri riwayat ketika fokus berada di luar kontrol formulir. Escape menutup dialog. Popup hasil muncul sekali per pertandingan dan dapat dibuka kembali lewat **Lihat hasil**. Suara chiptune mengikuti playback langsung; langkah manual dan pemutaran riwayat tidak mengulang efek aksi.

Perjalanan baru memakai `grid-puzzle.progress.v5`. **Progres kategori lama dihapus**, termasuk key v1–v4 dan key demo lama. Seluruh kategori baru dimulai dari awal. Pilihan algoritma (`grid-puzzle.participants.v1`) dan suara (`grid-puzzle.audio.v1`) tetap disimpan. Storage yang diblokir memakai memori tab. Web Locks serta sinkronisasi antar-tab melindungi progres versi baru.

## Konten dan pemeriksaan

Grid dalam `scripts/arena-layouts.ts` ditulis per arena. `scripts/author-arenas.ts` menambahkan konfigurasi mode; JSON hanya menyimpan kondisi awal. Tidak ada jawaban, rute, hasil solver, atau rekaman pertandingan dalam katalog.

```sh
npm run content:generate
npm run content:build
npm run validate:levels
npm test
npm run typecheck
npm run build
```

`content:generate` mengganti seluruh 49 level bawaan. Validator menolak bentuk jalur identik, termasuk rotasi dan pencerminan, lalu memeriksa objektif, konfigurasi sirkuit, cadangan energi, katalog, aset, dan hasil pertandingan langsung. Tes juga memverifikasi solusi peti melalui tindakan legal.

Pemeriksaan tambahan:

```sh
npx tsx scripts/review-maps.ts
npx tsx scripts/benchmark-solvers.ts --seeds=5
npm run test:visual -- http://127.0.0.1:5173
npm run test:participants -- http://127.0.0.1:5173
```

Pratinjau semua map dan screenshot browser berada di `artifacts/arena-review`; pemeriksaan peserta di `artifacts/participant-review`; benchmark 980 pertandingan empat solver melawan A* dan Greedy di `artifacts/solver-review`. Angka kemenangan mencerminkan interaksi mode dan roster, bukan jaminan satu algoritma selalu lebih kuat.

Renderer memakai PixiJS v8, atlas tema dan karakter yang tersedia, serta simbol mekanik dari GraphicsContext yang dipakai bersama. Bentuk simbol memakai grid pixel dan tidak memerlukan unduhan gambar baru. Aplikasi tetap memakai vinext, React, dan konfigurasi Cloudflare Workers proyek ini.
