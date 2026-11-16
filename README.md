# Grid Puzzle

Game edukasi algoritma berbahasa Indonesia dengan dunia pixel art, UI lapang, dan engine replay PixiJS v8. Dibangun di atas vinext + React + Cloudflare Workers.

## Jalankan

```sh
npm install
npm run dev
```

Buka URL yang dicetak Vite. Beranda langsung menampilkan perjalanan: dua section, sepuluh level, dan lima pilihan pada setiap level. Konfirmasi pilihan untuk memutar rekaman dan membandingkan hasilnya.

**Versi ini adalah demo visual.** Lima puluh replay dan metrik merupakan contoh ilustrasi. Progres disimpan di browser dan dapat diulang dari beranda. Pemeriksaan jawaban server, cookie anonim, D1, dan Durable Objects disiapkan sebagai tahap berikutnya melalui kontrak provider; belum diimplementasikan.

## Perintah

| Perintah                  | Kegunaan                                                 |
| ------------------------- | -------------------------------------------------------- |
| `npm run validate:levels` | Validasi section, level, 50 replay, aset, dan atlas      |
| `npm test`                | Tes engine, progres, dan interaksi komponen              |
| `npm run test:visual`     | Review Chromium, WebGL, screenshot, dan layout responsif |
| `npm run typecheck`       | Pemeriksaan TypeScript                                   |
| `npm run build`           | Build Worker dan aset produksi                           |
| `npm run start`           | Preview build produksi secara lokal                      |
| `npm run content:build`   | Bangun katalog dari JSON sumber level                    |
| `npm run assets:build`    | Kemas sumber gambar menjadi atlas, sprite, dan thumbnail |

## Dokumentasi

- [Konsep algoritma dan metrik](docs/algorithm-concepts.md)
- [Panduan engine dan template level](docs/level-authoring.md)
- [Design system dan spesifikasi pixel art](docs/design-system.md)
- [Riset game pixel dan arah aset kebun/gurun](docs/pixel-art-direction.md)
- [Revisi layout dan referensi Duolingo](docs/layout-revision.md)
- [Prompt aset dan provenance](public/assets/game/source/prompts.json)

Sumber level ada di `content/levels`, template di `content/templates`, replay di `public/demo/traces`. Primitive replay dan schema bersifat terpisah dari renderer. Menambah level untuk mekanik yang tersedia tidak membutuhkan perubahan komponen UI.

## Kontrol dan aksesibilitas

Gunakan kontrol HTML untuk putar/jeda, satu langkah, timeline, dan kecepatan. Di luar kontrol formulir: Spasi mengatur play/pause, panah kiri/kanan mengubah langkah, A–E membuka pilihan. Escape membatalkan dialog. Pergantian tab menjeda simulasi. Papan besar dapat digeser di dalam area papan. Reduced motion mematikan animasi dekoratif; angka kelompok melengkapi warna.

## Aset

Aset dunia dibuat dengan imagegen built-in: **kebun dengan petani** dan **gurun dengan sherif**. Sumber PNG serta prompt disimpan di `public/assets/game/source`. Masing-masing biome memiliki atlas 40 frame 32 × 32 di `public/assets/game/farm` dan `public/assets/game/desert` (80 frame total). `scripts/pack-assets.mjs` memotong, menormalkan nearest-neighbor, membatasi palet, menyamakan baseline karakter, dan mengemas alpha tegas. Thumbnail memakai definisi papan dan sprite yang sama. Geist disertakan secara lokal dengan lisensi OFL.

## Verifikasi

Tes mencakup seluruh replay pada empat kecepatan, seeking, progres, data rusak, konfirmasi, error/retry, dan perpindahan section. Tes DOM menggunakan happy-dom dan mock canvas. Review visual terpisah memakai Chromium dan renderer PixiJS nyata pada viewport 320/390/768/1024/1440 px, termasuk kedua biome, konfirmasi, replay, dan progres. Screenshot dan laporan berada di `artifacts/layout-revision/`.

Untuk mengulang review: jalankan aplikasi, lalu `npm run test:visual -- http://127.0.0.1:5173` (sesuaikan URL server). Jika browser Playwright belum terpasang, jalankan `npx playwright install chromium` sekali. Pengujian memakai konteks browser terpisah.

`scripts/create-demo.mjs` membangun ulang sepuluh level dan lima puluh storyboard bawaan. Menjalankannya menimpa konten demo bawaan; gunakan template untuk menulis level baru.
