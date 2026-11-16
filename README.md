# Grid Puzzle

Arena petualang berbahasa Indonesia: adu algoritma dalam **Balap rute** dan **Perebutan gem**. Ada 14 level dan tujuh dunia: kebun, gurun, hutan, salju, vulkanik, pabrik, dan luar angkasa. Dibangun dengan vinext, React, dan PixiJS v8 di Cloudflare Workers.

## Jalankan

```sh
npm install
npm run dev
```

Buka URL Vite. Pilih algoritmamu dan satu sampai tiga lawan, lalu tekan Play. Tombol Peserta membuka daftar lengkap algoritma. Menang atau kalah tetap membuka level berikutnya.

## Simulasi langsung

JSON dalam `content/levels` hanya berisi kondisi awal: peta, tema, spawn, finis atau gem, seed, batas waktu, serta jadwal perubahan medan. Tidak ada rekaman pertandingan, jalur, metrik hasil, atau jawaban yang disimpan sebagai konten.

`game/search.ts` menjalankan A*, Weighted A* (bobot 1,5), Greedy Best-First, DFS, dan Bidirectional BFS secara bertahap. Bidirectional BFS membutuhkan biaya medan seragam. Semua nama dan deskripsi berasal dari katalog algoritma yang dapat ditambah.

Play membuat Web Worker dan state pencarian baru. Main thread meminta batch kecil, maksimal delapan tick, sesuai waktu berjalan; worker tidak menghitung seluruh pertandingan di awal. Pause menghentikan permintaan baru. Langkah manual benar-benar menghitung satu tick. Riwayat RAM hanya mencakup tick yang sudah dihitung. Play setelah melihat riwayat mengejar ujung riwayat lalu melanjutkan engine. Mulai ulang menginisialisasi kembali algoritma. Pergantian tab menjeda permainan; pergantian level menghentikan worker.

Satu tick adalah 50 ms. Setiap penjelajah dapat memeriksa satu node per tick. Bergerak satu petak normal memerlukan empat tick; medan lambat enam belas tick. Pemenang balapan ditentukan oleh pencarian ditambah perjalanan. Batas pertandingan 1.200 tick. Angka ini merupakan waktu simulasi yang konsisten antarperangkat. Hasil seed dan peserta yang sama dapat direproduksi.

Penjelajah tidak saling menghalangi. Gem diambil sesudah semua penjelajah menjalankan tick yang sama; kedatangan serentak memberi satu poin kepada setiap penjelajah yang tiba. Target yang diambil lawan dihitung ulang. Penutupan rintangan menunggu petak kosong. Jalan terputus dan batas waktu memiliki status tersendiri.

## Progres

Browser menyimpan ringkasan progres dan rekor melalui `grid-puzzle.progress.v2`; riwayat pertandingan tidak dipersistenkan. Penyimpanan membaca progres terbaru dan menggunakan Web Locks ketika tersedia, serta menyinkronkan perubahan antar-tab. Penyimpanan yang diblokir memakai memori tab. Progres navigasi versi lama dimigrasikan menjadi level selesai, tanpa mempertahankan hasil ilustratifnya.

## Kontrol

- Play/jeda, langkah sebelumnya/berikutnya, mulai ulang, dan kecepatan 0,5×–4×.
- Statistik membuka metrik dan timeline riwayat yang sudah dihitung.
- Sentuh peserta untuk mengamati frontier, petak diperiksa, dan rutenya.
- Seluruh papan menyesuaikan lebar serta tinggi layar. Level lanjutan berisi lebih banyak petak, hingga 31 × 23 pada arena gem.
- Spasi mengatur Play/jeda dan panah kiri/kanan mengubah langkah ketika fokus berada di luar kontrol formulir. Escape menutup dialog.
- Reduced motion, fokus keyboard, nomor peserta, dan label melengkapi warna.

## Konten dan aset

Edit definisi level lalu jalankan `npm run content:build`. `npm run content:generate` membangun ulang 14 level bawaan dari sumber authoring; perintah ini menimpa definisi bawaan tersebut.

Semua tema memakai aturan terrain yang sama. Setiap tema memiliki atlas delapan frame medan dan atlas 24 pose karakter manusia: petani, sherif, penjaga hutan, pendaki salju, penjelajah vulkanik, mekanik, dan astronaut dengan wajah manusia. Atlas bersama memuat lima frame objek permainan. Hanya empat belas PNG terpisah yang dipakai UI: tujuh dekor dunia dan tujuh potret karakter.

Sprite dibuat dengan **imagegen built-in**, lalu dikemas dengan crop, normalisasi nearest-neighbor, alpha tegas, palet terbatas, serta baseline penjelajah yang konsisten. Sumber dan prompt tersimpan di [public/assets/game/source](public/assets/game/source). `npm run assets:build` membangun ulang atlas. Geist disertakan secara lokal bersama lisensinya.

## Pemeriksaan

| Perintah                                       | Fungsi                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `npm test`                                     | Kebenaran pencarian, simulasi, kontrol worker, progres, dan UI             |
| `npm run typecheck`                            | Pemeriksaan TypeScript                                                     |
| `npm run validate:levels`                      | 14 level, tujuh tema, seluruh frame, peluang menang roster, dan aset yatim |
| `npm run test:visual -- http://127.0.0.1:5173` | Chromium/WebGL, mobile, landscape, semua tema, dan worker nyata            |
| `npm run build`                                | Build produksi                                                             |

Jalankan server sebelum pemeriksaan visual. Screenshot dan laporannya berada di `artifacts/arena-review`. Pengujian menggunakan konteks browser tersendiri.
