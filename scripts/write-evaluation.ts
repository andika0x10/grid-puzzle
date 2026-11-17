import fs from "node:fs/promises";
import { algorithms } from "../game/algorithms";
import { modeInfo } from "../game/modes";
import type { GameMode } from "../game/schema";

interface Group {
  algorithm: string;
  mode: GameMode;
  matches: number;
  wins: number;
  soloWins: number;
  neverMoved: number;
  bombsPlaced: number;
  wallsPlaced: number;
  distractions: number;
  teleports: number;
}
const benchmark = JSON.parse(await fs.readFile("artifacts/algorithm-audit/summary.json", "utf8")) as { seeds: number; matches: number; sourceHash: string; summary: Group[] };
const [header, ...lines] = (await fs.readFile("artifacts/algorithm-audit/matches.csv", "utf8")).trim().split("\n"),
  columns = header.split(",");
const rows = lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [columns[i], v])));
const notes: Record<string, string> = {
  astar: "Baseline rute yang seimbang. Tidak mengoptimalkan interaksi lawan secara mendalam.",
  "weighted-astar": "Mengutamakan keputusan cepat, dengan kemungkinan rute lebih mahal.",
  greedy: "Cepat mengejar tujuan; mudah terpengaruh perkiraan yang mengabaikan jalan memutar.",
  dfs: "Lemah untuk kompetisi berwaktu. Cabang panjang menghabiskan waktu sebelum gerak; dipertahankan sebagai pembanding pendidikan.",
  bidirectional: "Hanya delapan arena berbiaya seragam yang memenuhi syarat. Persentase ini tidak dapat dirangking langsung terhadap AI yang memainkan 91 arena.",
  bfs: "Meminimalkan banyaknya aksi. Biaya energi dan durasi berbeda membuat rute sedikit aksi belum tentu cepat.",
  dijkstra: "Acuan minimum biaya pada graph yang diberikan. State sumber daya memperbesar pencarian; waktu menghitung tetap bisa membuatnya kalah.",
  "dstar-lite":
    "Pemakaian ulang membantu ketika tujuan stabil. Perubahan jaringan portal atau ekor mengharuskan reset; pergantian subtujuan sering mengurangi manfaat incremental.",
  random: "Segera bergerak, tetapi eksplorasi tidak terarah membuat perolehan objektif rendah. Bias keselamatan tidak menjamin selamat.",
  mcts: "Simulasi membantu interaksi lokal. Horizon pendek dan biaya rollout membatasi perencanaan sumber daya serta rangkaian dorongan panjang.",
  beam: "Lebar terbatas mengendalikan percabangan puzzle. Kandidat yang terbuang tidak dipulihkan, sehingga solusi tidak dijamin.",
  rtaa: "Pencarian lokal dan pembelajaran menjaga respons. Rute total bisa memutar; pembelajaran dihapus saat tujuan atau graph berubah.",
  ara: "Rute pertama tersedia sebelum perbaikan selesai. Tambahan waktu mencari harus dibayar dalam balapan; manfaat terbesar ketika kualitas rute mengimbangi jeda tersebut.",
  maxn: "Memodelkan kepentingan tiap lawan pada satu putaran komitmen aksi. Kandidat dan horizon terbatas; tidak menyelesaikan game serentak secara sempurna.",
  paranoid: "Mengasumsikan respons lawan paling merugikan pemain. Dapat terlalu konservatif ketika lawan saling bersaing.",
  utility: "Pilihan objektif mempertimbangkan hadiah, waktu tiba, persaingan dan risiko. Penyetelan utility memengaruhi hasil; navigasinya tetap A*.",
};
const percent = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "—");
const median = (values: number[]) => {
  const sorted = values.sort((a, b) => a - b),
    i = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2) : 0;
};
const table = algorithms.map((a) => {
  const groups = benchmark.summary.filter((g) => g.algorithm === a.id && g.matches),
    runs = rows.filter((r) => r.algorithm === a.id),
    n = runs.length;
  const solo = groups.reduce((s, g) => s + g.soloWins, 0),
    joint = groups.reduce((s, g) => s + g.wins - g.soloWins, 0),
    never = groups.reduce((s, g) => s + g.neverMoved, 0);
  const first = median(runs.filter((r) => r.firstMove !== "").map((r) => Number(r.firstMove)));
  return `| ${a.name} | ${n} | ${solo} (${percent(solo, n)}) | ${joint} | ${never} | ${(first * 0.05).toFixed(2)} dtk |`;
});
const modeTable = algorithms.map((a) => {
  const groups = benchmark.summary.filter((g) => g.algorithm === a.id && g.matches).sort((a, b) => b.soloWins / b.matches - a.soloWins / a.matches);
  const top = groups[0],
    bottom = [...groups].sort((a, b) => a.soloWins / a.matches - b.soloWins / b.matches)[0];
  return `| ${a.name} | ${modeInfo[top.mode].title}: ${top.soloWins}/${top.matches} | ${modeInfo[bottom.mode].title}: ${bottom.soloWins}/${bottom.matches} | ${notes[a.id]} |`;
});
const special = benchmark.summary.reduce(
  (s, g) => ({ bombs: s.bombs + g.bombsPlaced, walls: s.walls + g.wallsPlaced, distract: s.distract + g.distractions, portals: s.portals + g.teleports }),
  { bombs: 0, walls: 0, distract: 0, portals: 0 }
);
const report = `# Evaluasi 16 AI\n\n${benchmark.matches.toLocaleString("id-ID")} pertandingan, ${benchmark.seeds} seed per arena yang didukung, rulesVersion 5. Setiap AI mendapat 64 operasi pencarian per tick. Posisi awal diputar melalui empat tempat; waktu berpikir masuk waktu pertandingan. Hasil di bawah berasal dari simulasi langsung, tanpa rute atau pemenang yang disimpan di level.\n\nLawan adalah dua AI pertama dari A*, Greedy dan Weighted A* setelah mengecualikan AI yang sedang diuji. Karena roster baseline berbeda untuk ketiganya, ini evaluasi terhadap lawan acuan, bukan klasemen round-robin. Satu seed dipasangkan dengan satu rotasi posisi; efek seed dan tempat belum diisolasi secara statistik.\n\n## Hasil keseluruhan\n\n| AI | Pertandingan | Menang tunggal | Seri tertinggi | Tanpa perpindahan | Median gerak pertama |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${table.join("\n")}\n\n“Tanpa perpindahan” berarti pertandingan berakhir sebelum bot berpindah; dapat mencerminkan pencarian lama, eliminasi atau objektif yang lebih dulu direbut lawan. Median hanya memakai bot yang sempat bergerak. Menang tunggal dipisahkan dari seri supaya bug atau hasil bersama tidak menggelembungkan klaim kekuatan.\n\n## Evaluasi tiap AI\n\nKategori terbaik/terlemah memakai rasio menang tunggal pada sampel ini. Jika seri, hanya satu contoh ditampilkan. Empat seed bukan estimasi populasi yang presisi.\n\n| AI | Contoh hasil terbaik | Contoh hasil terlemah | Penilaian dan batas |\n| --- | --- | --- | --- |\n${modeTable.join("\n")}\n\n## Mekanisme benar-benar dijalankan\n\nAksi dari bot yang sedang dievaluasi mencakup ${special.bombs} pemasangan bom, ${special.walls} pemasangan pagar, ${special.distract} pengalih perhatian, dan ${special.portals} teleportasi. Angka ini mengecualikan aksi lawan acuan dan berasal dari event engine, bukan gambar pratinjau.\n\n## Perbaikan yang diverifikasi\n\n- Bot terakhir yang hidup pada Lantai Runtuh mendapatkan kemenangan, bukan seri dengan bot yang baru tereliminasi pada tick sama.\n- MCTS menerima kumpulan aksi kosong dengan aman. Model lawan menilai objektifnya sendiri.\n- Transisi arus/es/portal dan graph balik memakai aksi serta durasi yang sama. Heuristic portal memperhitungkan rantai teleportasi pada graph pad kecil; tidak memindai ulang seluruh peta untuk setiap perkiraan.\n- D* Lite dan RTAA* menghapus informasi yang tidak valid ketika jaringan global berubah.\n- Rencana keluar dari area bom menggunakan keterhubungan sebenarnya, bukan hanya jarak Manhattan.\n- RTAA* diuji mencapai tujuan melalui pencarian lokal berulang; ARA* diuji terhadap oracle berbobot independen; pembagian anggaran 1/7/64/256 tidak mengubah hasil pencarian.\n\n## Reproduksi\n\n\`\`\`sh\nnpx tsx scripts/benchmark-solvers.ts --seeds=4\nnpx tsx scripts/write-evaluation.ts\n\`\`\`\n\n[Ringkasan 208 kombinasi AI/kategori](algorithm-evaluation.json) menyertakan kategori yang tidak didukung. Data pertandingan lengkap berada di artifacts/algorithm-audit/matches.csv. Source SHA-256: \`${benchmark.sourceHash}\`. Script menolak hasil jika sumber berubah selama benchmark.\n`;
await fs.mkdir("docs", { recursive: true });
await fs.writeFile("docs/algorithm-evaluation.md", report);
await fs.copyFile("artifacts/algorithm-audit/summary.json", "docs/algorithm-evaluation.json");
const map = JSON.parse(await fs.readFile("artifacts/campaign-review/map-audit.json", "utf8"));
await fs.writeFile(
  "docs/map-review.md",
  `# Audit rombakan map\n\nDibandingkan dengan commit 6f545d7, seluruh **${map.changedPreviousTopologies}/49 topologi**, **${map.changedPreviousSpawns}/49 koordinat spawn utama**, serta **${map.changedPreviousObjectives}/49 susunan objektif atau gelombang** berubah. Kampanye kini berisi 91 arena pada 13 kategori, masing-masing tujuh level. Semua kategori bisa dimulai secara independen.\n\n![Perbandingan map pertama setiap kategori lama](map-changes.png)\n\nGaris pada gambar adalah jalur referensi pada terrain dengan gerbang dan jembatan terbuka. Itu bukan solusi mekanik peti, rencana di bawah kabut, atau hasil pertandingan. Titik mencakup objektif dan prasyarat seperti saklar/stasiun.\n\n## Mengatasi kemiripan\n\nPemeriksaan lama hanya memastikan bentuk tidak identik setelah rotasi/refleksi. Banyak start tetap di pojok yang sama, papan mengikuti ukuran yang serupa, koridor didominasi satu petak, dan lintasan perburuan berupa persegi. Keunikan exact tersebut tidak cukup untuk membuktikan variasi bermain.\n\nKonten baru memakai pelataran, lorong berjalin, gua, distrik, gugus ruang, sekat dan cincin. Bentuk air Jembatan disusun terpisah: sungai berbelok, selat, parit pulau, kuadran, tiga daratan, delta dan kepulauan silang. Lintasan target/patroli juga berubah bentuk per level. Spawn tersebar di beberapa bagian papan; posisi objektif, dimensi dan rasio papan bervariasi.\n\nValidator sekarang menolak pasangan dalam kategori yang mencapai kemiripan 90% setelah resize dan delapan rotasi/refleksi. Nilai tertinggi pada kampanye ini adalah **${(map.worstCategorySimilarity * 100).toFixed(2)}%** pada raster 24 × 24. Ini ukuran kemiripan okupansi, bukan persentase kesamaan gameplay atau bukti bahwa semua arena sudah menyenangkan. Jumlah cabang, jalan buntu, putaran dan koordinat ikut dilaporkan.\n\n[Data audit setiap arena](map-audit.json).\n\n## Seluruh 91 arena\n\n![Pratinjau 91 arena](campaign-maps.png)\n\nAngka hijau adalah tempat awal. Pratinjau ini menampilkan terrain authoring lengkap; permainan Kabut tetap menyembunyikan informasi per peserta. Konten dihasilkan saat build dari konfigurasi dan seed tetap, kemudian disimpan sebagai JSON. Tidak ada pergantian map acak ketika Play.\n\n## Reproduksi\n\n\`\`\`sh\nnpm run content:generate\nnpm run validate:levels\nnpx tsx scripts/audit-arenas.ts\nnpx tsx scripts/review-maps.ts\nnpx tsx scripts/review-map-changes.ts\n\`\`\`\n`
);
console.log(`Wrote evaluation for ${algorithms.length} AI and map audit; ${special.walls} live fence placements.`);
