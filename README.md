# Grid Puzzle

Arena petualang berbahasa Indonesia: **tujuh jenis game, 49 level, dan sepuluh algoritma**. Tujuh dunia tetap mengikuti pixel art kebun, gurun, hutan, salju, vulkanik, pabrik, dan luar angkasa. Dibangun dengan vinext, React, dan PixiJS v8 di Cloudflare Workers.

## Jalankan

```sh
npm install
npm run dev
```

Buka URL Vite. Setiap masuk halaman level, popup Pilih peserta menampilkan algoritmamu dan satu sampai tiga lawan. Tekan Save untuk menyimpan pilihan, lalu Mulai untuk bermain. Tombol Peserta membuka kembali pengaturan; Save saat pertandingan berlangsung mengembalikan arena ke kondisi siap mulai. Menang atau kalah tetap membuka level berikutnya.

Kategori dibuka berurutan, masing-masing dengan tujuh level:

| Game            | Tujuan                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Balap rute      | Aktifkan tiga atau empat pos dalam urutan bebas, hadapi gerbang berjadwal, lalu capai finis.     |
| Perebutan gem   | Rebut emas/safir/rubi bernilai 1/3/5, antisipasi gelombang dan kedaluwarsa, manfaatkan bonus ×2. |
| Kurir kargo     | Tas memuat tiga barang; poin baru dihitung ketika disetor ke depot.                              |
| Rebut wilayah   | Petak yang dimasuki menjadi milik bot dan bisa direbut kembali.                                  |
| Zona selamat    | Hindari gelombang bahaya dan bertahan paling lama.                                               |
| Kunci dan pintu | Kumpulkan semua kunci pribadi, buka pintu yang cocok, lalu capai keluar.                         |
| Rebut pos       | Kuasai tiga pos selama delapan tick tanpa kontestan; setiap pos memberi satu poin tiap 20 tick.  |

## Simulasi langsung

JSON dalam `content/levels` hanya berisi kondisi awal: peta, tema, spawn, finis atau gem, seed, batas waktu, serta jadwal perubahan medan. Tidak ada rekaman pertandingan, jalur, metrik hasil, atau jawaban yang disimpan sebagai konten.

`game/search.ts` menjalankan A*, Weighted A* (bobot 1,5), Greedy Best-First, DFS, Bidirectional BFS, BFS, Dijkstra, dan D* Lite secara bertahap. D* Lite menyimpan `g`, `rhs`, dan antrean untuk memperbaiki pencarian setelah perubahan medan atau posisi; tujuan baru menginisialisasi pencarian balik baru. Bidirectional BFS membutuhkan biaya medan seragam. BFS meminimalkan jumlah langkah, sehingga tidak menjamin biaya minimum di medan lambat.

`game/decisions.ts` menjalankan Random Walk dengan memori satu petak dan MCTS dengan UCT, delapan rollout berkedalaman empat tindakan, maksimal 512 operasi per keputusan (32 tick). MCTS memakai aturan transisi dan pemenang yang sama dengan engine. Lawan dalam rollout dimodelkan sebagai tindakan acak legal. Heuristik penilaian sesuai mode membantu menilai simulasi pendek. Algoritma berbasis rute mendapat tujuan dari aturan mode bersama. Setiap bot hanya menjalankan algoritma yang dipilih; katalog dan peserta pertandingan harus unik. Dijkstra/UCS adalah satu pilihan bernama Dijkstra.

Play membuat Web Worker dan state pencarian baru. Main thread meminta batch kecil, maksimal delapan tick, sesuai waktu berjalan; worker tidak menghitung seluruh pertandingan di awal. Pause menghentikan permintaan baru. Langkah manual benar-benar menghitung satu tick. Riwayat RAM hanya mencakup tick yang sudah dihitung. Play setelah melihat riwayat mengejar ujung riwayat lalu melanjutkan engine. Mulai ulang menginisialisasi kembali algoritma. Pergantian tab menjeda permainan; pergantian level menghentikan worker.

Satu tick adalah 50 ms. Setiap penjelajah mendapat anggaran yang sama: 16 operasi per tick. Akses dan perbandingan antrean, pemeriksaan tetangga, penilaian rute, serta penyusunan jalur menghabiskan operasi; satu node bisa membutuhkan beberapa tick. Model ini menghitung pekerjaan algoritma, bukan waktu CPU perangkat. Bergerak satu petak normal memerlukan empat tick; medan lambat enam belas tick. Waktu balapan mencakup pencarian ditambah perjalanan. Setelah seluruh peserta menyelesaikan tick finis pertama, balapan berhenti dan peserta lain ditandai belum finis. Batas pertandingan 1.200 tick. Hasil seed dan peserta yang sama dapat direproduksi pada seluruh kecepatan playback.

Penjelajah tidak saling menghalangi. Setiap gem memiliki satu pemilik. Emas bernilai 1, safir 3, dan rubi 5 poin; periode Gem ganda mengalikan nilai saat pengambilan. Tick kemunculan, kedaluwarsa, dan perolehan poin dicatat pada state pertandingan. Gem diambil sesudah semua peserta menjalankan tick yang sama; kedatangan serentak memakai prioritas hash seed, ID gem, dan algoritma, tanpa menguntungkan urutan peserta atau bot pemain. Target yang diambil lawan dihitung ulang dan menghabiskan anggaran komputasi baru. Penutupan rintangan menunggu petak kosong. Jalan terputus dan batas waktu memiliki status tersendiri. Pertandingan tanpa finis atau tanpa poin tidak memiliki pemenang.

Popup langsung mengumumkan algoritma pemenang, pemilik bot, serta waktu finis atau perolehan poin. Hasil seri ditampilkan secara eksplisit. Main lagi mempertahankan peserta; Ganti algoritma membuka pilihan peserta. Popup otomatis muncul sekali per pertandingan, dapat ditutup dengan Escape, dan dapat dibuka kembali lewat Lihat hasil tanpa menggandakan progres.

## Progres

Empat belas arena Balap rute dan Perebutan gem memakai aturan revisi 2. Level terbuka, jumlah main, dan kemenangan tetap dipertahankan. Saat pertama dimainkan kembali, rekor dua mode itu dimulai dari aturan baru agar tidak dibandingkan dengan arena lama yang lebih singkat. Penggabungan progres antar-tab mengutamakan revisi aturan terbaru untuk rekor.

Pilihan algoritma dan lawan tersimpan terpisah di `grid-puzzle.participants.v1` dan digunakan kembali setelah pindah level atau membuka ulang browser. Seed tetap mengikuti level. Pilihan yang tidak mendukung medan disesuaikan otomatis dengan pemberitahuan; perubahan baru tersimpan setelah Save. X, Escape, atau klik di luar popup membatalkan perubahan. Jika penyimpanan diblokir, pilihan tetap diingat selama tab aktif.

Browser menyimpan ringkasan progres dan rekor melalui `grid-puzzle.progress.v4`; riwayat pertandingan tidak dipersistenkan. Progres v3, termasuk kemenangan, jumlah pertandingan, waktu, dan gem, tetap dibawa. Rekor baru menyimpan jenis metrik waktu, skor, atau durasi bertahan. Migrasi v2 tetap membawa penyelesaian dan riwayat, dengan rekor lama dimulai kembali sesuai perubahan aturan sebelumnya. Data versi lama tetap tersedia di key lamanya. Penyimpanan membaca progres terbaru dan menggunakan Web Locks ketika tersedia, serta menyinkronkan perubahan antar-tab. Penyimpanan yang diblokir memakai memori tab.

## Kontrol

- Musik chiptune diputar saat pertandingan berjalan, dengan efek arcade untuk interaksi, langkah bot pemain, objektif, bahaya, dan hasil pertandingan. Tombol speaker di beranda dan arena mematikan/menyalakan semua suara; pilihannya disimpan di `grid-puzzle.audio.v1`.
- Audio aktif setelah interaksi pertama. Musik berhenti saat jeda, tab tersembunyi, atau meninggalkan arena. Langkah manual dan pemutaran riwayat tidak mengulang efek aksi atau nada hasil. Musik dan efek dibuat langsung dengan Web Audio API, tanpa unduhan audio tambahan.
- Play/jeda, langkah sebelumnya/berikutnya, mulai ulang, dan kecepatan 0,5×–4×.
- Statistik membuka metrik dan timeline riwayat yang sudah dihitung.
- Sentuh peserta untuk mengamati frontier, petak diperiksa, dan rutenya.
- Seluruh papan menyesuaikan lebar serta tinggi layar. Level lanjutan berisi lebih banyak petak, hingga 23 × 17 pada mode lanjutan.
- Spasi mengatur Play/jeda dan panah kiri/kanan mengubah langkah ketika fokus berada di luar kontrol formulir. Escape menutup dialog.
- Reduced motion, fokus keyboard, nomor peserta, dan label melengkapi warna.

## Konten dan aset

Balapan memakai pos pribadi berurutan bebas dan gerbang berjadwal dengan rute alternatif permanen. Pencarian yang sedang berlangsung memakai snapshot; langkah ke rintangan yang baru tertutup ditolak dan dihitung ulang. Perubahan gerbang di luar rute tidak membatalkan perjalanan. Jadwal pembukaan terbaru menggantikan penutupan tertunda pada petak berpenghuni.

Arena gem memakai empat gelombang, nilai berbeda, batas waktu, dan periode bonus ganda. Pemilihan target bersama mempertimbangkan nilai, perkiraan jarak, bonus saat perkiraan tiba, dan tenggat. Ketika arena kosong sementara, bot dapat menyiapkan posisi di pedestal gelombang berikutnya. Semua mekanik juga berjalan dalam simulasi MCTS.

Edit definisi level lalu jalankan `npm run content:build`. `npm run content:generate` membangun ulang 49 level bawaan dari sumber authoring; perintah ini menimpa definisi bawaan tersebut. Level baru memakai schema versi 3; schema versi 2 tetap dapat dibaca.

Semua tema memakai aturan terrain yang sama. Setiap tema memiliki atlas delapan frame medan dan atlas 24 pose karakter manusia: petani, sherif, penjaga hutan, pendaki salju, penjelajah vulkanik, mekanik, dan astronaut dengan wajah manusia. Atlas bersama memuat 25 frame objek permainan: 17 frame sebelumnya tetap identik, ditambah delapan sprite untuk pos lintasan, gerbang berjam, safir, rubi, pedestal, dan Gem ganda. Hanya empat belas PNG terpisah yang dipakai UI: tujuh dekor dunia dan tujuh potret karakter.

Sprite dibuat dengan **imagegen built-in**, lalu dikemas dengan crop, normalisasi nearest-neighbor, alpha tegas, palet terbatas, serta baseline penjelajah yang konsisten. Sumber dan prompt tersimpan di [public/assets/game/source](public/assets/game/source). `npm run assets:build` membangun ulang atlas. Geist disertakan secara lokal bersama lisensinya.

`node scripts/pack-assets.mjs --shared-only` hanya membangun ulang atlas objek. `source/modes-source.png` dan `source/classic-source.png` dibuat memakai aset lama sebagai referensi gaya; prompt lengkap dan parameter pemrosesan dicatat di `source/prompts.json`.

## Pemeriksaan

`npm run test:participants -- http://127.0.0.1:5173` memeriksa teks di dalam setiap kolom peserta, pemisahan nama dan metrik, tujuh mode, enam ukuran layar, 2–4 bot, nama panjang, isi tas, dan skor panjang. Screenshot berada di `artifacts/participant-review`.

| Perintah                                       | Fungsi                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `npm test`                                     | Kebenaran pencarian, simulasi, kontrol worker, progres, dan UI                                |
| `npm run typecheck`                            | Pemeriksaan TypeScript                                                                        |
| `npm run validate:levels`                      | 49 level, tujuh tema, keterjangkauan kunci/tujuan, seluruh frame, roster unik, dan aset yatim |
| `npm run test:visual -- http://127.0.0.1:5173` | Chromium/WebGL, 49 papan, mobile, landscape, semua mode/tema, dan worker nyata                |
| `npm run build`                                | Build produksi                                                                                |

`npx tsx scripts/audit-classic.ts` membandingkan waktu, pemenang, penyelesaian pos, poin, dan gem kedaluwarsa dari 14 arena yang dirombak. `npm run test:visual -- http://127.0.0.1:5173 --classic` memeriksa dua mode tersebut termasuk gerbang dan bonus saat pertandingan berlangsung.

Jalankan server sebelum pemeriksaan visual. Screenshot dan laporannya berada di `artifacts/arena-review`. Pengujian menggunakan konteks browser tersendiri.
