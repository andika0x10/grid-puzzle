import { gameModes, levelSchema, isWalkable, type GameMode, type LevelDefinition, type Point, type Terrain } from "../game/schema";
import { adjacent, cellOf, modeInfo, pointOf, seededHash } from "../game/modes";
import { themeIds } from "../game/themes";
import { randomSource } from "../game/decisions";

export const architectureNames = ["Pelataran bercabang", "Lorong berjalin", "Gua berongga", "Distrik berpintu", "Gugus ruang", "Sekat bersilang", "Cincin bersimpang"];
const sizes = [
  [13, 11],
  [11, 17],
  [19, 13],
  [15, 19],
  [23, 15],
  [19, 23],
  [25, 21],
];
const arenaNames: Partial<Record<GameMode, string[]>> = {
  collapse: ["Pelataran pecah", "Suaka berlapis", "Retak dari timur", "Pulau terakhir", "Dua jalur pelarian", "Sektor berguguran", "Pusat yang tenggelam"],
  hunt: ["Tikungan kebun", "Pencegat di lorong", "Buruan di ceruk", "Dua jalur bersilang", "Belokan buta", "Tiga arah kejar", "Pertemuan orbital"],
  circuit: ["Panel di tengah", "Gerbang samping", "Saklar yang jauh", "Sambungan lintas ruang", "Rangkaian bercabang", "Empat pemutus", "Pola balik terakhir"],
  energy: ["Stasiun di ceruk", "Suar lintas halaman", "Baterai di gua", "Rantai pengisian", "Kunjungan balik", "Sembilan suar", "Distribusi orbital"],
  bridge: ["Dua tepi sungai", "Selat dua petak", "Pulau dalam parit", "Empat kuadran", "Tiga daratan", "Percabangan delta", "Kepulauan silang"],
  crates: ["Kiriman ke utara", "Dorong lewat ceruk", "Gudang bersekat", "Dua ruang bongkar", "Jalur peti silang", "Rak yang terbuka", "Tiga pengiriman"],
  bomb: ["Kayu di halaman", "Ledakan berantai", "Lindungan bebatuan", "Bom antar distrik", "Sudut tanpa jalan", "Dua sumbu menyala", "Perebutan reruntuhan"],
  snake: ["Ekor di gerbang", "Buah dalam gua", "Lingkaran terpotong", "Simpul di tengah", "Ekormu penghalangku", "Panjang di koridor", "Kepungan terakhir"],
  flow: ["Belok setelah es", "Angin dari barat", "Lintasan meluncur", "Arus antar ruang", "Tiga dorongan", "Pulau beku", "Arus berlawanan"],
  portal: ["Empat pintu asing", "Pasangan berpindah", "Lompatan di pelataran", "Enam simpul", "Pintu ke ceruk", "Rantai yang berubah", "Transit terakhir"],
  tactical: ["Pagar di simpang", "Rute memutar", "Sekat di halaman", "Tiga pagar bergerak", "Akses tetap terbuka", "Perebutan jalan", "Benteng sementara"],
  stealth: ["Patroli kebun", "Semak di pintu", "Pengalih di gua", "Dua penjaga", "Arsip lintas sektor", "Jalur bayangan", "Tiga pengawas"],
};
const fogNames = ["Simpang pertama", "Ruang tersembunyi", "Ujung yang menipu", "Cincin terputus", "Pintu rimba", "Sektor tak terlihat", "Jejak di kehampaan"];
export function designCampaign(): LevelDefinition[] {
  return gameModes.flatMap((mode, mi) => themeIds.map((theme, order) => designArena(mode, mi, order, theme)));
}
function designArena(mode: GameMode, mi: number, order: number, theme: (typeof themeIds)[number]): LevelDefinition {
  const seed = 920003 + mi * 7919 + order * 104729,
    random = randomSource(seed);
  let [width, height] = sizes[order];
  if ((mi + order) % 3 === 1) [width, height] = [height, width];
  if (mi % 3 === 2) width += 2;
  const n = width * height,
    style = (order + mi * 3) % 7,
    terrain: Terrain[] = Array(n).fill("wall");
  const at = (x: number, y: number) => y * width + x;
  const inside = (x: number, y: number) => x > 0 && y > 0 && x < width - 1 && y < height - 1;
  const put = (x: number, y: number, t: Terrain = "ground") => {
    if (inside(x, y)) terrain[at(x, y)] = t;
  };
  const rect = (x: number, y: number, w: number, h: number, t: Terrain = "ground") => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, t);
  };
  const md = (a: number, b: number) => Math.abs((a % width) - (b % width)) + Math.abs(Math.floor(a / width) - Math.floor(b / width));
  const line = (a: number, b: number, wide = false) => {
    let x = a % width,
      y = Math.floor(a / width);
    const bx = b % width,
      by = Math.floor(b / width);
    const step = (axis: number) => {
      while ((axis ? y : x) !== (axis ? by : bx)) {
        if (axis) y += Math.sign(by - y);
        else x += Math.sign(bx - x);
        put(x, y);
        if (wide) put(x + axis, y + 1 - axis);
      }
    };
    put(x, y);
    const first = random() < 0.5 ? 0 : 1;
    step(first);
    step(1 - first);
  };
  if (style === 0) {
    rect(1, 1, width - 2, height - 2);
    for (let y = 2; y < height - 3; y += 4)
      for (let x = 2; x < width - 3; x += 5) {
        rect(x, y, 2 + Math.floor(random() * 2), 2 + Math.floor(random() * 2), "wall");
        if (random() < 0.5) put(x, y);
      }
  } else if (style === 1) {
    const stack = [at(1, 1)],
      visited = new Set(stack);
    terrain[stack[0]] = "ground";
    while (stack.length) {
      const c = stack.at(-1)!,
        x = c % width,
        y = Math.floor(c / width),
        choices = [
          [x + 2, y],
          [x - 2, y],
          [x, y + 2],
          [x, y - 2],
        ].filter(([xx, yy]) => inside(xx, yy) && !visited.has(at(xx, yy)));
      if (!choices.length) {
        stack.pop();
        continue;
      }
      const [xx, yy] = choices[Math.floor(random() * choices.length)],
        next = at(xx, yy);
      put((x + xx) / 2, (y + yy) / 2);
      terrain[next] = "ground";
      visited.add(next);
      stack.push(next);
    }
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) if (terrain[at(x, y)] === "wall" && random() < 0.19) put(x, y);
    rect(Math.floor(width / 2) - 1, Math.floor(height / 2) - 1, 3, 3);
  } else if (style === 2) {
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (random() > 0.36) put(x, y);
    for (let pass = 0; pass < 2; pass++) {
      const old = [...terrain];
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (old[at(x + dx, y + dy)] === "wall") count++;
          put(x, y, count >= 5 ? "wall" : "ground");
        }
    }
  } else if (style === 3) {
    rect(1, 1, width - 2, height - 2);
    for (let x = 4 + (mi % 2); x < width - 2; x += 5) {
      rect(x, 1, 1, height - 2, "wall");
      for (let j = 0; j < 2; j++) rect(x, 2 + Math.floor(random() * (height - 4)), 1, 2);
    }
    for (let y = 4; y < height - 2; y += 5) {
      rect(1, y, width - 2, 1, "wall");
      for (let x = 2; x < width - 2; x += 4) {
        put(x, y);
        if (random() < 0.6) put(x + 1, y);
      }
    }
  } else if (style === 4) {
    const centers: number[] = [];
    for (let y = 2; y < height - 2; y += 5)
      for (let x = 2; x < width - 2; x += 6) {
        rect(x - 1, y - 1, 3 + Math.floor(random() * 3), 3 + Math.floor(random() * 2));
        centers.push(at(x, y));
      }
    for (let i = 1; i < centers.length; i++) line(centers[i], centers[i - 1], i % 3 === 0);
    if (centers.length > 3) line(centers[0], centers.at(-1)!);
  } else if (style === 5) {
    rect(1, 1, width - 2, height - 2);
    for (let x = 3; x < width - 2; x += 4) {
      const gap = 2 + Math.floor(random() * (height - 5));
      for (let y = 1; y < height - 1; y++) if (y < gap || y > gap + 1) put(x, y, "wall");
      if (x % 8 === 3) put(x, height - 3);
    }
    for (let i = 0; i < order + 2; i++) put(2 + Math.floor(random() * (width - 4)), 2 + Math.floor(random() * (height - 4)), "wall");
  } else {
    rect(1, 1, width - 2, height - 2);
    for (let inset = 3; inset < Math.min(width, height) / 2 - 1; inset += 4) {
      rect(inset, inset, width - inset * 2, 1, "wall");
      rect(inset, height - inset - 1, width - inset * 2, 1, "wall");
      rect(inset, inset, 1, height - inset * 2, "wall");
      rect(width - inset - 1, inset, 1, height - inset * 2, "wall");
      put(inset, inset + 1 + Math.floor(random() * Math.max(1, height - inset * 2 - 2)));
      put(width - inset - 1, height - inset - 2);
      put(inset + 1 + Math.floor(random() * Math.max(1, width - inset * 2 - 2)), inset);
    }
  }
  const floor = () => terrain.flatMap((t, c) => (isWalkable(t) ? [c] : []));
  function connect() {
    if (!floor().length) rect(1, 1, width - 2, height - 2);
    for (;;) {
      const first = floor()[0],
        seen = new Set([first]),
        q = [first];
      for (let i = 0; i < q.length; i++)
        for (const c of adjacent(q[i], width, height))
          if (isWalkable(terrain[c]) && !seen.has(c)) {
            seen.add(c);
            q.push(c);
          }
      const missing = floor().find((c) => !seen.has(c));
      if (missing === undefined) break;
      line(missing, [...seen].sort((a, b) => md(a, missing) - md(b, missing))[0]);
    }
  }
  connect();
  const used = new Set<number>(),
    rank = (c: number) => seededHash(String(c), seed) / 0xffffffff;
  const anchors = [
    [1, 1],
    [width - 2, height - 2],
    [1, height - 2],
    [width - 2, 1],
    [Math.floor(width / 2), Math.floor(height / 2)],
    [width - 2, Math.floor(height / 2)],
    [Math.floor(width / 2), 1],
  ];
  const spawns = Array.from({ length: 4 }, (_, i) => {
    let anchor = (order * 2 + mi + 4 + i * 2) % 7;
    const retiredAnchor = mode === "fog" ? (order === 3 ? 2 : 0) : mode === "crates" && order === 0 ? 4 : 2;
    if (i === 0 && anchor === retiredAnchor) anchor = (anchor + 3) % 7;
    const [x, y] = anchors[anchor],
      c = floor()
        .filter((c) => !used.has(c))
        .sort((a, b) => md(a, at(x, y)) - md(b, at(x, y)))[0];
    used.add(c);
    return pointOf(c, width);
  });
  const pick = (count: number, separation = 4): Point[] =>
    Array.from({ length: count }, () => {
      const value = (c: number) => Math.min(...[...used].map((p) => md(c, p)), separation + 2) + rank(c) * 2;
      const c = floor()
        .filter((c) => !used.has(c))
        .sort((a, b) => value(b) - value(a))[0];
      if (c === undefined) throw Error(`Not enough cells ${mode}`);
      used.add(c);
      return pointOf(c, width);
    });
  function patrol(index: number, wide = 3): Point[] {
    const x = 2 + ((index * 7 + mi + order * 3) % Math.max(1, width - wide - 4)),
      y = 2 + ((index * 5 + order + mi * 2) % Math.max(1, height - 7)),
      cells: number[] = [];
    const shapes = [
      [
        [0, 0],
        [wide, 0],
        [wide, 2],
        [0, 2],
        [0, 0],
      ],
      [
        [0, 0],
        [wide, 0],
        [wide, 2],
        [1, 2],
        [1, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [wide, 1],
        [wide, 4],
        [1, 4],
        [1, 2],
        [0, 2],
        [0, 0],
      ],
      [
        [0, 0],
        [wide, 0],
        [wide, 4],
        [wide - 1, 4],
        [wide - 1, 1],
        [1, 1],
        [1, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [0, 0],
        [wide, 0],
        [wide, 2],
        [0, 2],
        [0, 0],
        [0, 2],
        [wide, 2],
        [wide, 4],
        [0, 4],
        [0, 2],
        [0, 0],
      ],
      [
        [0, 0],
        [wide, 0],
        [wide, 1],
        [1, 1],
        [1, 3],
        [wide, 3],
        [wide, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [0, 0],
        [wide, 0],
        [wide, 4],
        [0, 4],
        [0, 3],
        [wide - 1, 3],
        [wide - 1, 1],
        [0, 1],
        [0, 0],
      ],
    ];
    const corners = shapes[(order + index) % shapes.length].map(([dx, dy]) => [x + dx, y + dy]);
    for (let i = 1; i < corners.length; i++) {
      let [xx, yy] = corners[i - 1];
      const [bx, by] = corners[i];
      while (xx !== bx || yy !== by) {
        cells.push(at(xx, yy));
        put(xx, yy);
        if (xx !== bx) xx += Math.sign(bx - xx);
        else yy += Math.sign(by - yy);
      }
    }
    return cells.map((c) => pointOf(c, width));
  }
  let goal: Point | undefined;
  const extras: Record<string, unknown> = {};
  if (mode === "fog") {
    [goal] = pick(1, 9);
    extras.fog = { radius: 2 };
  }
  if (mode === "collapse") {
    const groups = new Map<number, Point[]>();
    for (const c of floor()) {
      const x = c % width,
        y = Math.floor(c / width),
        cx = width / 2,
        cy = height / 2;
      const ranks = [
        y / height,
        x / width,
        (x + y) / (width + height),
        Math.max(Math.abs(x - cx) / cx, Math.abs(y - cy) / cy),
        (width - x + y) / (width + height),
        ((Math.floor(x / 4) + Math.floor(y / 4)) % 3) / 3,
        Math.abs(x - cx) / width + (height - y) / height,
      ];
      const tick = 160 + Math.min(8, Math.floor(ranks[order] * 8)) * 120,
        group = groups.get(tick) ?? [];
      group.push(pointOf(c, width));
      groups.set(tick, group);
    }
    extras.collapse = { graceTicks: 160, trailTicks: 24, waves: [...groups].sort((a, b) => a[0] - b[0]).map(([tick, cells]) => ({ tick, cells })) };
  }
  if (mode === "hunt")
    extras.hunt = { targets: Array.from({ length: 1 + Math.floor(order / 3) }, (_, i) => ({ route: patrol(i, 2 + (order % 3)), stepTicks: 8 + i * 2 })), respawnTicks: 20 };
  if (mode === "circuit") {
    const terminals = pick(2),
      switches = pick(Math.min(4, 1 + Math.floor(order / 2))).map((p) => {
        const c = floor().find((c) => !used.has(c) && adjacent(c, width, height).filter((n) => isWalkable(terrain[n])).length >= 3 && md(c, cellOf(p, width)) > 2);
        if (c !== undefined) used.add(c);
        return { ...p, gates: c === undefined ? [] : [pointOf(c, width)] };
      });
    extras.circuit = {
      switches,
      initialMask: 0,
      contracts: Array.from({ length: 3 + Math.floor(order / 2) }, (_, i) => ({ ...terminals[(i + order) % 2], mask: [1, 3, 2, 6, 4, 12, 8, 0][i] % (1 << switches.length) })),
    };
  }
  if (mode === "energy") {
    const chargers = pick(2 + Math.floor(order / 2));
    const distances = () => {
      const ds = Array(n).fill(Infinity),
        q = chargers.map((p) => cellOf(p, width));
      for (const c of q) ds[c] = 0;
      for (let i = 0; i < q.length; i++)
        for (const c of adjacent(q[i], width, height))
          if (isWalkable(terrain[c]) && ds[c] > ds[q[i]] + 1) {
            ds[c] = ds[q[i]] + 1;
            q.push(c);
          }
      return ds;
    };
    let ds = distances();
    while (floor().some((c) => ds[c] > 7)) {
      const c = floor().sort((a, b) => ds[b] - ds[a])[0];
      chargers.push(pointOf(c, width));
      used.add(c);
      ds = distances();
    }
    extras.energy = { capacity: 24, chargers, beacons: pick(3 + order) };
  }
  if (mode === "crates") {
    const boxes: Point[] = [],
      docks: Point[] = [],
      count = 1 + Math.floor(order / 3);
    for (let i = 0; i < count; i++) {
      const cx = 3 + i * Math.floor((width - 8) / Math.max(1, count - 1)),
        cy = Math.min(height - 4, 3 + ((order * 3 + i * 5) % (height - 6)));
      rect(cx - 2, cy - 2, 5, 5);
      const d =
        order === 0
          ? [0, -1]
          : [
              [1, 0],
              [0, 1],
              [-1, 0],
              [0, -1],
            ][(order + i) % 4];
      boxes.push({ x: cx, y: cy });
      docks.push({ x: cx + d[0] * 2, y: cy + d[1] * 2 });
    }
    extras.crates = { boxes, docks };
  }
  if (mode === "bridge") {
    rect(1, 1, width - 2, height - 2);
    const mx = Math.floor(width / 2),
      my = Math.floor(height / 2);
    const spans: { banks: [Point, Point]; cells: Point[] }[] = [];
    const span = (x: number, y: number, dx: number, dy: number, length = 1) => {
      const cells = Array.from({ length }, (_, i) => ({ x: x + dx * i, y: y + dy * i })),
        banks: [Point, Point] = [
          { x: x - dx, y: y - dy },
          { x: x + dx * length, y: y + dy * length },
        ];
      for (const p of cells) put(p.x, p.y, "water");
      for (const p of banks) put(p.x, p.y);
      spans.push({ cells, banks });
    };
    if (order === 0) {
      rect(mx, 1, 1, my, "water");
      rect(mx + 2, my, 1, height - my - 1, "water");
      rect(mx, my, 3, 1, "water");
      span(mx, 3, 1, 0);
      span(mx + 2, height - 3, 1, 0);
    }
    if (order === 1) {
      rect(1, my, width - 2, 2, "water");
      span(3, my, 0, 1, 2);
      span(width - 4, my, 0, 1, 2);
    }
    if (order === 2) {
      rect(3, 3, width - 6, 1, "water");
      rect(3, height - 4, width - 6, 1, "water");
      rect(3, 3, 1, height - 6, "water");
      rect(width - 4, 3, 1, height - 6, "water");
      span(mx, 3, 0, 1);
      span(width - 4, my, 1, 0);
      span(3, my, 1, 0);
    }
    if (order === 3 || order === 6) {
      const k = order === 6 ? 2 : 1;
      rect(mx, 1, k, height - 2, "water");
      rect(1, my, width - 2, k, "water");
      span(mx, 3, 1, 0, k);
      span(mx, height - 4, 1, 0, k);
      span(3, my, 0, 1, k);
      span(width - 4, my, 0, 1, k);
      if (order === 6) span(mx, 6, 1, 0, k);
    }
    if (order === 4) {
      const a = Math.floor(width / 3),
        b = Math.floor((width * 2) / 3);
      rect(a, 1, 2, height - 2, "water");
      rect(b, 1, 1, height - 2, "water");
      span(a, 3, 1, 0, 2);
      span(a, height - 4, 1, 0, 2);
      span(b, my, 1, 0);
    }
    if (order === 5) {
      rect(1, my, width - 2, 1, "water");
      rect(mx, 1, 1, my, "water");
      span(3, my, 0, 1);
      span(width - 4, my, 0, 1);
      span(mx, 3, 1, 0);
    }
    for (let i = 0; i < order + 3; i++) {
      const x = 2 + Math.floor(random() * (width - 4)),
        y = 2 + Math.floor(random() * (height - 4));
      if (isWalkable(terrain[at(x, y)]) && !spans.some((s) => s.banks.some((p) => md(cellOf(p, width), at(x, y)) <= 1))) put(x, y, "wall");
    }
    const reserved = new Set(spans.flatMap((s) => [...s.cells, ...s.banks].map((p) => cellOf(p, width))));
    const formations = [
      [
        [2, 2, 2, 2],
        [width - 4, height - 4, 2, 2],
      ],
      [
        [2, 2, 3, 2],
        [width - 5, height - 4, 3, 2],
        [Math.floor(width / 2), 2, 2, 3],
      ],
      [
        [1, 1, 2, 2],
        [width - 3, height - 3, 2, 2],
      ],
      [
        [2, 2, 3, 3],
        [width - 5, height - 5, 3, 3],
      ],
      [
        [2, 3, 2, 5],
        [width - 4, 2, 2, 3],
      ],
      [
        [2, 2, mx - 3, my - 4],
        [mx + 2, my + 3, width - mx - 4, height - my - 5],
        [mx - 4, my + 2, 3, 3],
      ],
      [
        [2, 2, 4, 3],
        [width - 7, height - 5, 5, 3],
        [3, my + 4, 3, 3],
      ],
    ][order];
    for (const [x, y, rw, rh] of formations)
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) if (!reserved.has(at(xx, yy)) && isWalkable(terrain[at(xx, yy)])) put(xx, yy, "wall");
    used.clear();
    const requested = cellOf(spawns[0], width),
      root = floor().sort((a, b) => md(a, requested) - md(b, requested))[0],
      connected = new Set([root]),
      region = [root];
    for (let i = 0; i < region.length; i++)
      for (const c of adjacent(region[i], width, height))
        if (isWalkable(terrain[c]) && !connected.has(c)) {
          connected.add(c);
          region.push(c);
        }
    for (let i = 0; i < 4; i++) {
      const c = i === 0 ? root : region.filter((c) => !used.has(c)).sort((a, b) => Math.min(...[...used].map((p) => md(b, p))) - Math.min(...[...used].map((p) => md(a, p))))[0];
      spawns[i] = pointOf(c, width);
      used.add(c);
    }
    const supplies = [spawns[0], ...pick(Math.min(2, 1 + Math.floor(order / 3)))],
      markers = order === 2 ? [{ x: mx, y: my }] : pick(1 + Math.floor(order / 2));
    for (const p of markers) put(p.x, p.y);
    [goal] = pick(1);
    extras.bridge = { spans, supplies, markers };
  }
  if (mode === "bomb") {
    const gems = pick(4 + order),
      destructible = floor().filter((c) => !used.has(c) && adjacent(c, width, height).filter((n) => isWalkable(terrain[n])).length >= 3 && rank(c) < 0.18);
    if (!destructible.length) destructible.push(floor().find((c) => !used.has(c))!);
    for (const c of destructible) terrain[c] = "wall";
    extras.bomb = { gems, destructible: destructible.map((c) => pointOf(c, width)), fuseTicks: 36 };
  }
  if (mode === "snake") extras.snake = { fruit: pick(3 + Math.floor(order / 2)), initialLength: 3 };
  if (mode === "flow") {
    const currents = pick(4 + order).map((p, i) => ({ ...p, dx: [1, 0, -1, 0][(i + order) % 4], dy: [0, 1, 0, -1][(i + order) % 4], distance: 1 + (i % 3) })),
      ice = pick(2).flatMap((p) =>
        Array.from({ length: 3 + (order % 3) }, (_, i) => ({ x: Math.min(width - 2, p.x + i), y: p.y })).filter((p) => isWalkable(terrain[cellOf(p, width)]))
      );
    extras.flow = { currents, ice, tokens: pick(4 + order) };
  }
  if (mode === "portal") extras.portal = { pads: pick(4 + (order >= 3 ? 2 : 0)), tokens: pick(4 + order) };
  if (mode === "tactical") extras.tactical = { tokens: pick(4 + order), wallTicks: 100 };
  if (mode === "stealth") {
    const guards = Array.from({ length: 1 + Math.floor(order / 3) }, (_, i) => ({ route: patrol(i, 2 + i), stepTicks: 12 + i * 2, range: 3 + Math.floor(order / 4) }));
    extras.stealth = { guards, bushes: pick(5 + order), intel: pick(3 + order) };
  }
  if (mode !== "bridge" && mode !== "bomb") connect();
  if ([2, 4, 6].includes(order) && !["crates", "energy", "bridge"].includes(mode)) for (const c of floor()) if (!used.has(c) && rank(c) < 0.08) terrain[c] = "slow";
  for (const p of spawns) terrain[cellOf(p, width)] = "path";
  try {
    return levelSchema.parse({
      schemaVersion: 5,
      rulesVersion: 5,
      id: `${mode}-${order + 1}`,
      sectionId: mode,
      order: order + 1,
      title: mode === "fog" ? fogNames[order] : arenaNames[mode]![order],
      mission: modeInfo[mode].help.split(".")[0] + ".",
      briefing: `${architectureNames[style]}. ${modeInfo[mode].help}`,
      theme,
      mode,
      seed,
      timeLimit: mode === "snake" || mode === "hunt" ? 900 : 1200,
      board: {
        width,
        height,
        terrain,
        spawn: spawns[0],
        spawns,
        ...(goal ? { goal } : {}),
        decorations: [
          { x: 0, y: 0 },
          { x: width - 1, y: height - 1 },
        ],
      },
      ...extras,
    });
  } catch (error) {
    throw new Error(`${mode}-${order + 1}: ${error}`);
  }
}
