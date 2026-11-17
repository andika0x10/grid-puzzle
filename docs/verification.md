# Verifikasi kampanye

- 345 tes pada 11 suite lulus, termasuk aturan setiap mekanisme baru, pencarian berbobot, rencana RTAA*, anggaran komputasi, replay deterministik, progres kategori dan hasil pemenang.
- TypeScript, content build, validator 91 level dan production build lulus. Peringatan sourcemap/dynamic import dari toolchain vinext masih muncul tanpa menggagalkan build.
- Audit membandingkan seluruh 49 map sebelumnya terhadap commit `6f545d7`; 91 topologi baru unik, dan kemiripan dalam kategori berada di bawah ambang 90%.
- 5.492 pertandingan mengevaluasi seluruh 16 AI; seed dan tempat awal diputar. SHA-256 sumber yang diuji cocok dengan sumber akhir engine dan katalog.
- 312 pemeriksaan papan/worker: semua 91 arena pada lebar 390 dan 1440 px, ditambah level pertama seluruh kategori pada 320 px dan lanskap 844 px. Termasuk Play, jeda, langkah, restart, hasil, rasio papan dan jangkauan kontrol.
- 276 pemeriksaan peserta pada enam viewport: 13 kategori, dua sampai empat bot, label panjang dan nilai stres.
- 18 pemeriksaan tambahan menjalankan keenam AI baru melalui Web Worker browser sebenarnya pada 320 px, masing-masing sampai hasil pertandingan.

Hasil dan batas perbandingan: [evaluasi AI](algorithm-evaluation.md). Bukti perubahan geometri dan posisi: [audit map](map-review.md).

Artefak rinci tetap di direktori `artifacts/`: `algorithm-audit`, `campaign-review`, `arena-review` dan `participant-review`. Script pemeriksaan tersedia di `scripts/` sehingga hasil dapat diulang.
