# Evaluasi 16 AI

5.492 pertandingan, 4 seed per arena yang didukung, rulesVersion 5. Setiap AI mendapat 64 operasi pencarian per tick. Posisi awal diputar melalui empat tempat; waktu berpikir masuk waktu pertandingan. Hasil di bawah berasal dari simulasi langsung, tanpa rute atau pemenang yang disimpan di level.

Lawan adalah dua AI pertama dari A*, Greedy dan Weighted A* setelah mengecualikan AI yang sedang diuji. Karena roster baseline berbeda untuk ketiganya, ini evaluasi terhadap lawan acuan, bukan klasemen round-robin. Satu seed dipasangkan dengan satu rotasi posisi; efek seed dan tempat belum diisolasi secara statistik.

## Hasil keseluruhan

| AI                      | Pertandingan | Menang tunggal | Seri tertinggi | Tanpa perpindahan | Median gerak pertama |
| ----------------------- | -----------: | -------------: | -------------: | ----------------: | -------------------: |
| A*                      |          364 |     97 (26.6%) |             50 |                 3 |             0.55 dtk |
| Weighted A*             |          364 |    103 (28.3%) |             42 |                 3 |             0.55 dtk |
| Greedy Best-First       |          364 |    105 (28.8%) |             36 |                 3 |             0.55 dtk |
| Depth-First Search      |          364 |      14 (3.8%) |              2 |                58 |             1.40 dtk |
| Bidirectional BFS       |           32 |      7 (21.9%) |              0 |                 0 |             0.85 dtk |
| Breadth-First Search    |          364 |     53 (14.6%) |             28 |                18 |             0.90 dtk |
| Dijkstra                |          364 |     55 (15.1%) |             34 |                17 |             0.95 dtk |
| D* Lite                 |          364 |     81 (22.3%) |             35 |                22 |             0.90 dtk |
| Random Walk             |          364 |      21 (5.8%) |             20 |                 1 |             0.25 dtk |
| Monte Carlo Tree Search |          364 |     42 (11.5%) |             17 |                 1 |             0.55 dtk |
| Beam Search             |          364 |     84 (23.1%) |             38 |                 3 |             0.75 dtk |
| Real-Time Adaptive A*   |          364 |    114 (31.3%) |             45 |                 3 |             0.50 dtk |
| Anytime Repairing A*    |          364 |     91 (25.0%) |             46 |                 3 |             0.65 dtk |
| Maxⁿ Search             |          364 |     54 (14.8%) |             22 |                 2 |             0.45 dtk |
| Paranoid Search         |          364 |     51 (14.0%) |             22 |                 2 |             0.45 dtk |
| Utility AI + A*         |          364 |    105 (28.8%) |             50 |                 3 |             0.60 dtk |

“Tanpa perpindahan” berarti pertandingan berakhir sebelum bot berpindah; dapat mencerminkan pencarian lama, eliminasi atau objektif yang lebih dulu direbut lawan. Median hanya memakai bot yang sempat bergerak. Menang tunggal dipisahkan dari seri supaya bug atau hasil bersama tidak menggelembungkan klaim kekuatan.

## Evaluasi tiap AI

Kategori terbaik/terlemah memakai rasio menang tunggal pada sampel ini. Jika seri, hanya satu contoh ditampilkan. Empat seed bukan estimasi populasi yang presisi.

| AI                      | Contoh hasil terbaik      | Contoh hasil terlemah    | Penilaian dan batas                                                                                                                                                   |
| ----------------------- | ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A*                      | Perburuan Bergerak: 12/28 | Arus Paksa: 3/28         | Baseline rute yang seimbang. Tidak mengoptimalkan interaksi lawan secara mendalam.                                                                                    |
| Weighted A*             | Zona Bom: 10/28           | Perburuan Bergerak: 5/28 | Mengutamakan keputusan cepat, dengan kemungkinan rute lebih mahal.                                                                                                    |
| Greedy Best-First       | Sambung Sirkuit: 10/28    | Dorong Peti: 6/28        | Cepat mengejar tujuan; mudah terpengaruh perkiraan yang mengabaikan jalan memutar.                                                                                    |
| Depth-First Search      | Lantai Runtuh: 11/28      | Labirin Kabut: 0/28      | Lemah untuk kompetisi berwaktu. Cabang panjang menghabiskan waktu sebelum gerak; dipertahankan sebagai pembanding pendidikan.                                         |
| Bidirectional BFS       | Perburuan Bergerak: 4/16  | Labirin Kabut: 3/16      | Hanya delapan arena berbiaya seragam yang memenuhi syarat. Persentase ini tidak dapat dirangking langsung terhadap AI yang memainkan 91 arena.                        |
| Breadth-First Search    | Lantai Runtuh: 9/28       | Sambung Sirkuit: 0/28    | Meminimalkan banyaknya aksi. Biaya energi dan durasi berbeda membuat rute sedikit aksi belum tentu cepat.                                                             |
| Dijkstra                | Lantai Runtuh: 9/28       | Sambung Sirkuit: 0/28    | Acuan minimum biaya pada graph yang diberikan. State sumber daya memperbesar pencarian; waktu menghitung tetap bisa membuatnya kalah.                                 |
| D* Lite                 | Zona Bom: 11/28           | Dorong Peti: 1/28        | Pemakaian ulang membantu ketika tujuan stabil. Perubahan jaringan portal atau ekor mengharuskan reset; pergantian subtujuan sering mengurangi manfaat incremental.    |
| Random Walk             | Zona Bom: 8/28            | Labirin Kabut: 0/28      | Segera bergerak, tetapi eksplorasi tidak terarah membuat perolehan objektif rendah. Bias keselamatan tidak menjamin selamat.                                          |
| Monte Carlo Tree Search | Zona Bom: 11/28           | Jembatan Rakitan: 0/28   | Simulasi membantu interaksi lokal. Horizon pendek dan biaya rollout membatasi perencanaan sumber daya serta rangkaian dorongan panjang.                               |
| Beam Search             | Ekspedisi Energi: 11/28   | Ular Arena: 3/28         | Lebar terbatas mengendalikan percabangan puzzle. Kandidat yang terbuang tidak dipulihkan, sehingga solusi tidak dijamin.                                              |
| Real-Time Adaptive A*   | Sambung Sirkuit: 16/28    | Arus Paksa: 6/28         | Pencarian lokal dan pembelajaran menjaga respons. Rute total bisa memutar; pembelajaran dihapus saat tujuan atau graph berubah.                                       |
| Anytime Repairing A*    | Jembatan Rakitan: 10/28   | Ular Arena: 2/28         | Rute pertama tersedia sebelum perbaikan selesai. Tambahan waktu mencari harus dibayar dalam balapan; manfaat terbesar ketika kualitas rute mengimbangi jeda tersebut. |
| Maxⁿ Search             | Zona Bom: 13/28           | Sambung Sirkuit: 0/28    | Memodelkan kepentingan tiap lawan pada satu putaran komitmen aksi. Kandidat dan horizon terbatas; tidak menyelesaikan game serentak secara sempurna.                  |
| Paranoid Search         | Zona Bom: 13/28           | Sambung Sirkuit: 0/28    | Mengasumsikan respons lawan paling merugikan pemain. Dapat terlalu konservatif ketika lawan saling bersaing.                                                          |
| Utility AI + A*         | Lantai Runtuh: 14/28      | Sambung Sirkuit: 4/28    | Pilihan objektif mempertimbangkan hadiah, waktu tiba, persaingan dan risiko. Penyetelan utility memengaruhi hasil; navigasinya tetap A*.                              |

## Mekanisme benar-benar dijalankan

Aksi dari bot yang sedang dievaluasi mencakup 1925 pemasangan bom, 598 pemasangan pagar, 378 pengalih perhatian, dan 277 teleportasi. Angka ini mengecualikan aksi lawan acuan dan berasal dari event engine, bukan gambar pratinjau.

## Perbaikan yang diverifikasi

- Bot terakhir yang hidup pada Lantai Runtuh mendapatkan kemenangan, bukan seri dengan bot yang baru tereliminasi pada tick sama.
- MCTS menerima kumpulan aksi kosong dengan aman. Model lawan menilai objektifnya sendiri.
- Transisi arus/es/portal dan graph balik memakai aksi serta durasi yang sama. Heuristic portal memperhitungkan rantai teleportasi pada graph pad kecil; tidak memindai ulang seluruh peta untuk setiap perkiraan.
- D* Lite dan RTAA* menghapus informasi yang tidak valid ketika jaringan global berubah.
- Rencana keluar dari area bom menggunakan keterhubungan sebenarnya, bukan hanya jarak Manhattan.
- RTAA* diuji mencapai tujuan melalui pencarian lokal berulang; ARA* diuji terhadap oracle berbobot independen; pembagian anggaran 1/7/64/256 tidak mengubah hasil pencarian.

## Reproduksi

```sh
npx tsx scripts/benchmark-solvers.ts --seeds=4
npx tsx scripts/write-evaluation.ts
```

[Ringkasan 208 kombinasi AI/kategori](algorithm-evaluation.json) menyertakan kategori yang tidak didukung. Data pertandingan lengkap berada di artifacts/algorithm-audit/matches.csv. Source SHA-256: `53debc7271db24e08e555bdf070f7a00486228a5db28c7ca075bfb2b1ce37a68`. Script menolak hasil jika sumber berubah selama benchmark.
