// Reproducible, authored DEMO storyboards. These are not production algorithm runners.
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await fs.mkdir(path.join(root, "content/levels"), { recursive: true });
await fs.mkdir(path.join(root, "public/demo/traces"), { recursive: true });
const write = (file, data) => fs.writeFile(path.join(root, file), JSON.stringify(data, null, 2) + "\n");
const navOptions = [
  {
    id: "bfs",
    name: "Breadth-First Search",
    description: "Menjelajah selapis demi selapis.",
    detail: "Antrean membantu memeriksa semua tetangga terdekat sebelum melangkah lebih jauh.",
  },
  {
    id: "dfs",
    name: "Depth-First Search",
    description: "Ikuti satu cabang sampai ujung.",
    detail: "Tumpukan menyimpan cabang yang akan dikunjungi ketika petani menemui jalan buntu.",
  },
  {
    id: "dijkstra",
    name: "Dijkstra",
    description: "Dahulukan biaya perjalanan terkecil.",
    detail: "Setiap jalur dibandingkan berdasarkan biaya yang sudah dikeluarkan.",
  },
  {
    id: "astar",
    name: "A* Search",
    description: "Gabungkan biaya dan perkiraan jarak.",
    detail: "Perkiraan jarak Manhattan membantu mengarahkan pencarian menuju tujuan.",
  },
  {
    id: "greedy",
    name: "Greedy Best-First",
    description: "Dahulukan yang tampak dekat tujuan.",
    detail: "Mengikuti perkiraan jarak tanpa memperhitungkan seluruh biaya yang sudah ditempuh.",
  },
];
const clusterOptions = [
  {
    id: "kmeans",
    name: "K-means",
    description: "Pusat kelompok bergerak mengikuti titik.",
    detail: "Jumlah kelompok ditetapkan oleh level. Titik dan pusat kelompok diperbarui bergantian.",
  },
  {
    id: "dbscan",
    name: "DBSCAN",
    description: "Hubungkan tetangga yang cukup rapat.",
    detail: "Memperluas kelompok berdasarkan radius dan kepadatan; titik tertentu dapat menjadi pencilan.",
  },
  {
    id: "agglomerative",
    name: "Agglomerative",
    description: "Gabungkan kelompok kecil bertahap.",
    detail: "Membangun hierarki dari titik-titik terpisah hingga menjadi kelompok yang lebih besar.",
  },
  {
    id: "meanshift",
    name: "Mean Shift",
    description: "Bergerak menuju pusat kepadatan.",
    detail: "Jendela pencarian bergerak mengikuti konsentrasi titik dalam lingkungan sekitarnya.",
  },
  {
    id: "optics",
    name: "OPTICS",
    description: "Telusuri struktur kepadatan titik.",
    detail: "Mengurutkan keterjangkauan titik untuk membantu menemukan struktur kelompok pada beberapa skala.",
  },
];
const maps = [
  ["#########", "#......G#", "#..##...#", "#.......#", "#.##....#", "#S::::..#", "#########"],
  ["###########", "#..#.....G#", "#..#.####.#", "#..#......#", "#..####.#.#", "#.......#.#", "#.#####...#", "#S........#", "###########"],
  ["############", "#......mmmG#", "#..###.mm..#", "#....#.mm..#", "#....#.....#", "#.~~~=~~~~.#", "#..........#", "#..mm###...#", "#S:mm......#", "############"],
  ["############", "#........G.#", "#..###.....#", "#....#..##.#", "#.##.#.....#", "#....#####.#", "#..........#", "#..##...##.#", "#S.........#", "############"],
  ["############", "#.........G#", "#..###.....#", "#..........#", "#..#..###..#", "#..........#", "#....###...#", "#..........#", "#S.........#", "############"],
];
const navTitles = ["Kenali medan", "Jalan buntu", "Medan berbobot", "Memori terbatas", "Rute berubah"];
const navDescriptions = [
  "Antar hasil kebun ke gerobak panen.",
  "Jalan yang menjanjikan belum tentu membawa ke tujuan.",
  "Rute pendek bisa menghabiskan lebih banyak energi.",
  "Ruang penyimpanan pencarian kali ini terbatas.",
  "Sebuah jalan tertutup. Ekspedisi tetap berlanjut.",
];
const metric = (id, label, unit, description, goal = "lower", required = false, limit) => ({
  id,
  label,
  unit,
  description,
  goal,
  required,
  ...(limit === undefined ? {} : { limit }),
});
const key = (p) => `${p.x},${p.y}`;
function readMap(rows) {
  const width = rows[0].length,
    height = rows.length;
  if (rows.some((r) => r.length !== width)) throw new Error("Map rows must have equal width");
  let robot, goal;
  const names = {
    "#": "wall",
    ".": "grass",
    ":": "path",
    m: "mud",
    "~": "water",
    "=": "bridge-h",
    "|": "bridge-v",
    S: "path",
    G: "path",
  };
  const terrain = rows.flatMap((r, y) =>
    [...r].map((c, x) => {
      if (c === "S") robot = { x, y };
      if (c === "G") goal = { x, y };
      return names[c];
    })
  );
  return {
    width,
    height,
    terrain,
    robot,
    goal,
    objects: [
      { id: "start", asset: "start", ...robot },
      { id: "goal", asset: "goal", ...goal },
    ],
  };
}
function solve(board, algorithm, start = board.robot) {
  const open = [{ ...start, g: 0, path: [start] }],
    seen = new Set(),
    logs = [];
  let work = 0,
    memory = 1;
  const h = (p) => Math.abs(p.x - board.goal.x) + Math.abs(p.y - board.goal.y);
  while (open.length) {
    if (["dijkstra", "astar", "greedy"].includes(algorithm))
      open.sort((a, b) => {
        work++;
        const score = (p) => (algorithm === "dijkstra" ? p.g : algorithm === "astar" ? p.g + h(p) : h(p));
        return score(a) - score(b);
      });
    const p = algorithm === "dfs" ? open.pop() : open.shift();
    if (seen.has(key(p))) continue;
    seen.add(key(p));
    work++;
    logs.push({
      point: { x: p.x, y: p.y },
      work,
      memory,
      frontier: open.slice(0, 12).map((n) => ({ x: n.x, y: n.y })),
    });
    if (p.x === board.goal.x && p.y === board.goal.y) return { path: p.path, cost: p.g, work, memory, logs };
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ]) {
      work++;
      const x = p.x + dx,
        y = p.y + dy,
        t = board.terrain[y * board.width + x];
      if (x < 0 || y < 0 || x >= board.width || y >= board.height || !t || ["wall", "water"].includes(t) || seen.has(`${x},${y}`)) continue;
      const candidate = { x, y, g: p.g + (t === "mud" ? 4 : 1), path: [...p.path, { x, y }] };
      const existing = open.findIndex((n) => n.x === x && n.y === y);
      if (existing >= 0) {
        if (["dijkstra", "astar"].includes(algorithm) && candidate.g < open[existing].g) open[existing] = candidate;
        continue;
      }
      open.push(candidate);
    }
    memory = Math.max(memory, open.length + seen.size);
  }
  return { path: [], cost: 0, work, memory, logs };
}
const initial = (level) => ({
  cells: {},
  entities: level.board.robot ? { robot: { ...level.board.robot, facing: "down" } } : {},
  path: [],
  centroids: [],
  metrics: Object.fromEntries(level.metrics.map((m) => [m.id, 0])),
  note: "Pilih algoritma, lalu amati apa yang terjadi.",
});
const face = (a, b) => (b.x > a.x ? "right" : b.x < a.x ? "left" : b.y < a.y ? "up" : "down");
const stepsFor = (level, solution, algorithm) => {
  const steps = [];
  const note =
    algorithm === "dfs"
      ? "Memeriksa cabang berikutnya."
      : algorithm === "bfs"
        ? "Mengambil sel berikutnya dari antrean."
        : algorithm === "greedy"
          ? "Memeriksa sel dengan perkiraan jarak terdekat."
          : "Membandingkan kandidat berdasarkan prioritasnya.";
  for (const log of solution.logs)
    steps.push({
      events: [
        ...log.frontier.map((p) => ({ kind: "cell", ...p, state: { status: "frontier" } })),
        { kind: "cell", ...log.point, state: { status: "visited" } },
        { kind: "metric", id: "work", value: log.work },
        { kind: "metric", id: "memory", value: log.memory },
        { kind: "note", text: note },
      ],
    });
  let cost = 0;
  solution.path.forEach((p, i) => {
    if (i) cost += level.board.terrain[p.y * level.board.width + p.x] === "mud" ? 4 : 1;
    steps.push({
      events: [
        { kind: "entity", id: "robot", ...p, facing: face(solution.path[Math.max(0, i - 1)], p) },
        { kind: "path", points: solution.path.slice(0, i + 1) },
        { kind: "metric", id: "cost", value: cost },
        {
          kind: "note",
          text: i === solution.path.length - 1 ? "Petani sudah mencapai gerobak panen." : "Petani mengikuti rute yang ditemukan.",
        },
      ],
    });
  });
  return steps;
};
const allLevels = [];
for (let i = 0; i < 5; i++) {
  const board = readMap(maps[i]),
    id = `navigation-${i + 1}`;
  const solutions = Object.fromEntries(navOptions.map((o) => [o.id, solve(board, o.id)]));
  const bestCost = Math.min(
    ...Object.values(solutions)
      .filter((s) => s.path.length)
      .map((s) => s.cost)
  );
  const bestMemory = Math.min(
    ...Object.values(solutions)
      .filter((s) => s.path.length)
      .map((s) => s.memory)
  );
  const limit = bestMemory + 4;
  const level = {
    schemaVersion: 1,
    id,
    sectionId: "navigation",
    order: i + 1,
    title: navTitles[i],
    description: navDescriptions[i],
    mission:
      i === 2
        ? `Capai gerobak panen dengan biaya paling banyak ${bestCost} energi.`
        : i === 3
          ? `Capai gerobak panen dengan menyimpan paling banyak ${limit} state.`
          : i === 4
            ? "Temukan kembali rute setelah jalan berubah."
            : "Bantu petani mencapai gerobak panen.",
    tip:
      i === 2
        ? "Lumpur memerlukan 4 energi. Medan lain yang bisa dilalui memerlukan 1 energi."
        : i === 3
          ? "State adalah informasi sel yang disimpan saat pencarian."
          : "Empat arah gerak. Saluran air dan pagar tanaman tidak dapat dilalui.",
    mechanic: "navigation",
    theme: "farm",
    board,
    options: navOptions,
    metrics: [
      metric("cost", "Biaya rute", "energi", "Energi yang dipakai petani sepanjang rute.", "lower", i === 2, i === 2 ? bestCost : undefined),
      metric("work", "Kerja komputasi", "operasi", "Ilustrasi biaya pemeriksaan dan persiapan pencarian."),
      metric("memory", "Puncak memori", "state", "Ilustrasi jumlah state yang disimpan bersamaan.", "lower", i === 3, i === 3 ? limit : undefined),
    ],
    traceRefs: Object.fromEntries(navOptions.map((o) => [o.id, `/demo/traces/${id}.${o.id}.json`])),
  };
  for (const option of navOptions) {
    let s = solutions[option.id],
      steps = stepsFor(level, s, option.id);
    if (i === 4) {
      const blocked = s.path[Math.min(4, s.path.length - 2)];
      const updated = { ...board, terrain: [...board.terrain] };
      updated.terrain[blocked.y * board.width + blocked.x] = "wall";
      const revised = solve(updated, option.id);
      const revisedSteps = stepsFor({ ...level, board: updated }, revised, option.id).map((step) => ({
        events: step.events.map((event) =>
          event.kind === "metric" && event.id === "work"
            ? { ...event, value: s.work + event.value }
            : event.kind === "metric" && event.id === "memory"
              ? { ...event, value: Math.max(s.memory, event.value) }
              : event
        ),
      }));
      steps = [
        ...steps.slice(0, s.logs.length),
        {
          events: [
            { kind: "cell", ...blocked, state: { terrain: "wall" } },
            {
              kind: "note",
              text: "Batu menutup jalur. Pencarian dimulai kembali dengan peta yang diperbarui.",
            },
          ],
        },
        ...revisedSteps,
      ];
      s = { ...revised, work: s.work + revised.work, memory: Math.max(s.memory, revised.memory) };
    }
    const values = { cost: s.cost, work: s.work, memory: s.memory };
    const passed = s.path.length > 0 && (i !== 2 || s.cost <= bestCost) && (i !== 3 || s.memory <= limit);
    const efficient = passed && s.cost <= bestCost && option.id !== "dfs";
    const reason = !passed
      ? i === 3
        ? "Petani mencapai tujuan, tetapi kapasitas penyimpanan pencarian terlampaui. Coba pendekatan yang memeriksa lebih sedikit state."
        : "Rute ini menghabiskan terlalu banyak energi. Perhatikan bagaimana biaya lumpur diperhitungkan."
      : efficient
        ? "Tujuan tercapai dengan rute hemat. Bandingkan juga pekerjaan pencarian dan memori yang digunakan."
        : "Tujuan tercapai. Ada kesempatan menghemat rute atau pekerjaan pencarian dengan pilihan lain.";
    steps.push({
      events: [...Object.entries(values).map(([id, value]) => ({ kind: "metric", id, value })), { kind: "note", text: reason }],
    });
    await write(`public/demo/traces/${id}.${option.id}.json`, {
      schemaVersion: 1,
      levelId: id,
      optionId: option.id,
      initial: initial(level),
      steps,
      result: {
        passed,
        tier: passed ? (efficient ? "efficient" : "passed") : "failed",
        reason,
        metrics: values,
      },
    });
  }
  await write(`content/levels/${id}.json`, level);
  allLevels.push(level);
}
const pointSets = [
  [
    [1, 1, 0],
    [2, 1, 0],
    [1, 2, 0],
    [2, 3, 0],
    [3, 2, 0],
    [8, 1, 1],
    [9, 1, 1],
    [8, 2, 1],
    [10, 2, 1],
    [9, 3, 1],
    [4, 6, 2],
    [5, 6, 2],
    [4, 7, 2],
    [6, 7, 2],
    [5, 8, 2],
  ],
  [
    [1, 1, 0],
    [2, 1, 0],
    [3, 2, 0],
    [3, 3, 0],
    [2, 4, 0],
    [1, 4, 0],
    [7, 4, 1],
    [8, 4, 1],
    [9, 5, 1],
    [9, 6, 1],
    [8, 7, 1],
    [7, 7, 1],
  ],
  [
    [1, 2, 0],
    [2, 2, 0],
    [1, 3, 0],
    [2, 3, 0],
    [3, 3, 0],
    [8, 5, 1],
    [9, 5, 1],
    [8, 6, 1],
    [9, 6, 1],
    [10, 6, 1],
    [5, 1, -1],
    [5, 8, -1],
  ],
  [
    [1, 1, 0],
    [2, 1, 0],
    [1, 2, 0],
    [2, 2, 0],
    [1, 3, 0],
    [2, 3, 0],
    [7, 2, 1],
    [9, 2, 1],
    [8, 4, 1],
    [10, 4, 1],
    [7, 6, 1],
    [9, 6, 1],
  ],
  [
    [1, 1, 0],
    [2, 1, 0],
    [1, 2, 0],
    [3, 4, 0],
    [4, 4, 0],
    [3, 5, 0],
    [8, 1, 1],
    [9, 1, 1],
    [8, 2, 1],
    [8, 6, 1],
    [9, 6, 1],
    [9, 7, 1],
  ],
];
const clusterTitles = ["Kelompok terpisah", "Pola melengkung", "Titik pencilan", "Kepadatan berbeda", "Kelompok bertingkat"];
const clusterDescriptions = [
  "Bantu sherif memetakan bijih emas di gurun.",
  "Kelompok tidak selalu berbentuk bulat.",
  "Beberapa titik bijih emas terpisah dari kelompoknya.",
  "Satu radius belum tentu pas untuk semua.",
  "Lihat kelompok kecil sebagai bagian dari kelompok besar.",
];
for (let i = 0; i < 5; i++) {
  const id = `clustering-${i + 1}`,
    points = pointSets[i],
    count = new Set(points.filter((p) => p[2] >= 0).map((p) => p[2])).size;
  const board = {
    width: 12,
    height: 10,
    terrain: Array(120).fill("grass"),
    robot: { x: 0, y: 9 },
    objects: points
      .map(([x, y, g], n) => ({ id: `crystal-${n}`, asset: "crystal", x, y }))
      .concat([
        { id: "crate", asset: "crate", x: 0, y: 8 },
        { id: "bush", asset: "bush", x: 11, y: 0 },
        { id: "cactus", asset: "tree", x: 11, y: 9 },
      ]),
  };
  const level = {
    schemaVersion: 1,
    id,
    sectionId: "clustering",
    order: i + 1,
    title: clusterTitles[i],
    description: clusterDescriptions[i],
    mission: "Kelompokkan bijih emas dengan kecocokan pola minimal 90%.",
    tip: "Kecocokan dihitung dari hubungan antartitik pada pola contoh. Parameter metode sudah ditetapkan dalam rekaman demo.",
    mechanic: "clustering",
    theme: "desert",
    board,
    options: clusterOptions,
    metrics: [
      metric("quality", "Kecocokan pola", "%", "Hubungan pasangan titik yang sesuai dengan pola contoh.", "higher", true, 90),
      metric("groups", "Kelompok", "grup", "Jumlah kelompok yang terbentuk; pencilan tidak dihitung.", "exact", false, count),
      metric("work", "Kerja komputasi", "operasi", "Ilustrasi pekerjaan yang direkam pada storyboard ini."),
    ],
    traceRefs: Object.fromEntries(clusterOptions.map((o) => [o.id, `/demo/traces/${id}.${o.id}.json`])),
  };
  for (const [oi, option] of clusterOptions.entries()) {
    const groups = points.map((p, n) => {
      if (i === 1 && option.id === "kmeans") return p[1] < 4 ? 0 : 1;
      if (i === 2 && ["kmeans", "agglomerative", "meanshift"].includes(option.id) && p[2] === -1) return n % 2;
      if (i === 3 && option.id === "dbscan" && p[2] === 1) return (n % 3) + 1;
      if (i === 4 && option.id === "meanshift") return p[2] * 2 + (p[1] > 3 ? 1 : 0);
      return p[2];
    });
    let correct = 0,
      total = 0;
    for (let a = 0; a < points.length; a++)
      for (let b = a + 1; b < points.length; b++) {
        total++;
        const expected = points[a][2] >= 0 && points[a][2] === points[b][2];
        const actual = groups[a] >= 0 && groups[a] === groups[b];
        if (expected === actual) correct++;
      }
    let quality = Math.round((correct / total) * 100);
    // Noise identification is an additional authored relation in the outlier lesson.
    if (i === 2) quality = Math.round((quality + (points.filter((p, n) => (p[2] === -1) === (groups[n] === -1)).length / points.length) * 100) / 2);
    const groupCount = new Set(groups.filter((g) => g >= 0)).size;
    const steps = [],
      rounds = option.id === "kmeans" ? 3 : option.id === "meanshift" ? 2 : 1;
    let work = 0;
    for (let round = 0; round < rounds; round++)
      for (let n = 0; n < points.length; n++) {
        const [x, y] = points[n];
        work += option.id === "kmeans" ? count : option.id === "agglomerative" ? points.length - n : option.id === "optics" ? 6 : 4;
        const group = round < rounds - 1 && n % 4 === 0 ? (groups[n] + 1) % count : groups[n];
        const events = [
          { kind: "cell", x, y, state: { group } },
          { kind: "metric", id: "groups", value: groupCount },
          { kind: "metric", id: "work", value: work },
          {
            kind: "note",
            text:
              group === -1
                ? "Bijih emas ini ditandai sebagai pencilan."
                : option.id === "agglomerative"
                  ? "Menggabungkan bagian kelompok pada hierarki contoh."
                  : round > 0
                    ? "Memperbarui penempatan kelompok dan pusatnya."
                    : "Memeriksa hubungan bijih emas dengan kelompok di sekitarnya.",
          },
        ];
        if (["kmeans", "meanshift"].includes(option.id))
          events.push({
            kind: "centroids",
            points: Array.from({ length: count }, (_, g) => {
              const set = points.filter((p, j) => groups[j] === g);
              return {
                x: Math.round(set.reduce((s, p) => s + p[0], 0) / set.length),
                y: Math.round(set.reduce((s, p) => s + p[1], 0) / set.length),
              };
            }).filter((p) => Number.isFinite(p.x)),
          });
        steps.push({ events });
      }
    const passed = quality >= 90,
      efficient = passed && quality === 100;
    const reason = !passed
      ? i === 2
        ? "Sebagian pencilan ikut dimasukkan ke kelompok. Coba metode yang dapat menandai noise."
        : i === 3
          ? "Kelompok yang renggang terpecah. Perhatikan pengaruh kepadatan dan parameter metode."
          : "Bentuk kelompok pada rekaman ini belum sesuai dengan pola misi. Coba pendekatan lain."
      : "Pola kelompok memenuhi misi. Bandingkan cara setiap metode membentuk kelompok dan pekerjaan yang dibutuhkan.";
    const values = { quality, groups: groupCount, work };
    steps.push({
      events: [...Object.entries(values).map(([id, value]) => ({ kind: "metric", id, value })), { kind: "note", text: reason }],
    });
    await write(`public/demo/traces/${id}.${option.id}.json`, {
      schemaVersion: 1,
      levelId: id,
      optionId: option.id,
      initial: initial(level),
      steps,
      result: {
        passed,
        tier: passed ? (efficient ? "efficient" : "passed") : "failed",
        reason,
        metrics: values,
      },
    });
  }
  await write(`content/levels/${id}.json`, level);
  allLevels.push(level);
}
const sections = [
  {
    id: "navigation",
    order: 1,
    title: "Navigasi kebun",
    subtitle: "Bantu petani menemukan jalan",
    description: "Lewati kebun, pilih jalan, dan antar hasil panen dengan energi yang cukup.",
    color: "green",
    illustration: "/demo/thumbnails/navigation-1.png",
    levelIds: allLevels.filter((l) => l.sectionId === "navigation").map((l) => l.id),
  },
  {
    id: "clustering",
    order: 2,
    title: "Pengelompokan sumber daya",
    subtitle: "Petakan gurun bersama sherif",
    description: "Kenali kelompok bijih emas, bentuk yang berbeda, dan titik yang berdiri sendiri.",
    color: "green",
    illustration: "/demo/thumbnails/clustering-1.png",
    levelIds: allLevels.filter((l) => l.sectionId === "clustering").map((l) => l.id),
  },
];
await write("content/sections.json", sections);
await write("content/catalog.json", { sections, levels: allLevels });
await fs.mkdir(path.join(root, "content/templates"), { recursive: true });
await write("content/templates/navigation.json", {
  ...allLevels[0],
  id: "my-navigation-level",
  title: "Judul level baru",
  traceRefs: Object.fromEntries(navOptions.map((o) => [o.id, `/demo/traces/my-navigation-level.${o.id}.json`])),
});
await write("content/templates/clustering.json", {
  ...allLevels[5],
  id: "my-clustering-level",
  title: "Judul level baru",
  traceRefs: Object.fromEntries(clusterOptions.map((o) => [o.id, `/demo/traces/my-clustering-level.${o.id}.json`])),
});
console.log("Created 2 sections, 10 level definitions, 50 demo traces, and 2 authoring templates.");
