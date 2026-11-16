import { levelSchema, type Point, type Terrain } from "../game/schema";
import { themeIds } from "../game/themes";
const raceTitles = ["Tiga arah", "Gerbang gurun", "Rute berbiaya", "Simpang salju", "Sirkuit kawah", "Saklar pabrik", "Orbit tak tetap"];
const gemTitles = ["Kilau pembuka", "Oasis sesaat", "Umpan rubi", "Kilau yang lenyap", "Ledakan permata", "Giliran mesin", "Hujan bintang"];
function arena(index: number, gem = false) {
  const width = [13, 15, 17, 19, 21, 23, 23][index],
    height = [11, 11, 13, 13, 15, 15, 15][index];
  const terrain: Terrain[] = Array.from({ length: width * height }, (_, c) => {
    const x = c % width,
      y = Math.floor(c / width);
    return !x || !y || x === width - 1 || y === height - 1 ? "wall" : "ground";
  });
  const gates: Point[] = [];
  const at = (x: number, y: number, name: Terrain) => {
    terrain[y * width + x] = name;
  };
  if (index === 4) {
    // A permanent southern entrance and two timed shortcuts through a ring.
    for (let x = 3; x <= width - 4; x++) {
      at(x, 3, "wall");
      at(x, height - 4, "wall");
    }
    for (let y = 3; y <= height - 4; y++) {
      at(3, y, "wall");
      at(width - 4, y, "wall");
    }
    at(Math.floor(width / 2), height - 4, "path");
    gates.push({ x: Math.floor(width / 2), y: 3 }, { x: width - 4, y: Math.floor(height / 2) });
  } else if (index === 1 || index === 3 || index === 5) {
    for (let y = 4, stripe = 0; y < height - 3; y += 4, stripe++) {
      const gap = stripe % 2 ? width - 3 : 2;
      for (let x = 1; x < width - 1; x++) if (x !== gap) at(x, y, "wall");
      gates.push({ x: Math.floor(width / 2) + (stripe % 2), y });
    }
  } else {
    for (let x = 4, stripe = 0; x < width - 3; x += 4, stripe++) {
      const gap = stripe % 2 ? height - 3 : 2;
      for (let y = 1; y < height - 1; y++) if (y !== gap) at(x, y, "wall");
      gates.push({ x, y: Math.floor(height / 2) + (stripe % 2) });
    }
  }
  for (const gate of gates) at(gate.x, gate.y, "path");
  if (index === 2 || index === 6) {
    for (let y = 3; y < height - 3; y++)
      for (let x = 2; x < width - 2; x++)
        if (terrain[y * width + x] === "ground" && (index === 6 ? (x + y + (gem ? 1 : 0)) % 3 === 0 : (x + y + (gem ? 1 : 0)) % 3 !== 0)) at(x, y, "slow");
  }
  if (index === 4)
    for (let y = Math.floor(height / 2) - 1; y <= Math.floor(height / 2) + 1; y++) for (let x = 4; x < width - 4; x++) if (terrain[y * width + x] === "ground") at(x, y, "slow");
  if (index === 3 || index === 5)
    for (let x = 4; x < width - 4; x += 6) {
      for (let y = 1; y <= 2; y++) at(x, y, "wall");
      at(x + 1, 2, "wall");
    }
  const spawn = { x: 1, y: height - 2 },
    goal = index === 6 ? { x: width - 2, y: height - 2 } : { x: Math.floor(width / 2), y: 1 };
  at(spawn.x, spawn.y, "path");
  at(goal.x, goal.y, "path");
  const changes = gates
    .flatMap((p, g) => Array.from({ length: 8 }, (_, i) => ({ ...p, tick: 130 + g * 36 + i * 140, terrain: (i % 2 === 0 ? "wall" : "path") as Terrain })))
    .filter((c) => c.tick < 1200)
    .sort((a, b) => a.tick - b.tick);
  return {
    width,
    height,
    terrain,
    spawn,
    goal,
    gems: [] as Point[],
    decorations: [
      { x: 0, y: 0 },
      { x: width - 1, y: height - 1 },
    ],
    gates,
    changes,
  };
}
function reachable(terrain: Terrain[], width: number, height: number, start: Point) {
  const seen = new Set([start.y * width + start.x]),
    q = [...seen];
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % width,
      y = Math.floor(q[h] / width);
    for (const [nx, ny] of [
      [x + 1, y],
      [x, y - 1],
      [x - 1, y],
      [x, y + 1],
    ]) {
      const c = ny * width + nx;
      if (nx > 0 && ny > 0 && nx < width - 1 && ny < height - 1 && !seen.has(c) && terrain[c] !== "wall") {
        seen.add(c);
        q.push(c);
      }
    }
  }
  return seen;
}
function checkpointPoints(board: ReturnType<typeof arena>, index: number) {
  const { width: w, height: h } = board;
  const candidates = [
    { x: w - 3, y: h - 3 },
    { x: 2, y: 2 },
    { x: w - 3, y: 2 },
    { x: Math.floor(w / 2), y: index === 4 ? Math.floor(h / 2) : h - 3 },
  ];
  const seen = reachable(board.terrain, w, h, board.spawn);
  return candidates
    .slice(0, index >= 2 && index !== 6 ? 4 : 3)
    .map((p) => {
      const nearest = [...seen]
        .filter((c) => !board.gates.some((g) => g.y * w + g.x === c) && c !== board.goal.y * w + board.goal.x && c !== board.spawn.y * w + board.spawn.x)
        .sort((a, b) => Math.abs((a % w) - p.x) + Math.abs(Math.floor(a / w) - p.y) - Math.abs((b % w) - p.x) - Math.abs(Math.floor(b / w) - p.y))[0];
      const point = { x: nearest % w, y: Math.floor(nearest / w) };
      board.terrain[nearest] = "path";
      return point;
    })
    .filter((p, i, all) => all.findIndex((q) => q.x === p.x && q.y === p.y) === i);
}
function gemsFor(board: ReturnType<typeof arena>, index: number) {
  const { width: w, height: h } = board,
    seen = reachable(board.terrain, w, h, board.spawn);
  const used = new Set([board.spawn.y * w + board.spawn.x, board.goal.y * w + board.goal.x, ...board.gates.map((g) => g.y * w + g.x)]);
  const takeNear = (p: Point, value: number, spawnTick: number, expireTick: number | null) => {
    const c = [...seen]
      .filter((c) => !used.has(c))
      .sort((a, b) => Math.abs((a % w) - p.x) + Math.abs(Math.floor(a / w) - p.y) - Math.abs((b % w) - p.x) - Math.abs(Math.floor(b / w) - p.y) || a - b)[0];
    used.add(c);
    return { x: c % w, y: Math.floor(c / w), value, spawnTick, expireTick };
  };
  const gems = [
    takeNear({ x: 2, y: h - 3 }, 1, 0, null),
    takeNear({ x: 3, y: h - 2 }, 1, 0, null),
    takeNear({ x: 2, y: h - 4 }, 1, 0, null),
    takeNear({ x: w - 3, y: h - 3 }, 3, 0, null),
    takeNear({ x: Math.floor(w / 2), y: 2 }, 3, 0, null),
  ];
  const waves = [140 + index * 5, 340 + index * 6, 560 + index * 8];
  for (const [wave, tick] of waves.entries()) {
    const focus = wave === 0 ? { x: Math.floor(w / 2), y: Math.floor(h / 2) } : wave === 1 ? { x: w - 3, y: 2 } : { x: 3, y: Math.floor(h / 2) };
    for (let n = 0; n < 3 + Math.floor(index / 3); n++) gems.push(takeNear(focus, n % 3 === 0 ? 5 : n % 3 === 1 ? 3 : 1, tick, Math.min(1190, tick + 180 + index * 12)));
  }
  return gems;
}
export function authorClassicModes() {
  return themeIds.flatMap((theme, index) => {
    const race = arena(index),
      gem = arena(index, true);
    const { changes: raceChanges, ...raceBoard } = race,
      { changes: gemChanges, ...gemBoard } = gem;
    const checkpoints = checkpointPoints(race, index);
    const fever = [170 + index * 5, 370 + index * 6, 590 + index * 8, 910].map((startTick) => ({ startTick, endTick: startTick + 80 }));
    return [
      levelSchema.parse({
        schemaVersion: 3,
        rulesVersion: 2,
        id: `navigation-${index + 1}`,
        sectionId: "navigation",
        order: index + 1,
        title: raceTitles[index],
        mission: "Aktifkan semua pos, lalu capai finis.",
        briefing:
          index === 2 || index === 6
            ? "Jalur tengah berlumpur tampak singkat. Bandingkan biaya memutar, urutan pos, dan jadwal gerbang."
            : index === 4
              ? "Pos di dalam cincin punya satu akses permanen. Gerbang di utara dan timur memberi jalan pintas sementara."
              : "Tentukan urutan posmu. Pintu berjam berganti setiap tujuh detik; rute yang cepat sekarang belum tentu tetap terbuka.",
        theme,
        mode: "race",
        seed: 1001 + index,
        timeLimit: 1200,
        board: { ...raceBoard, checkpoints },
        changes: raceChanges,
      }),
      levelSchema.parse({
        schemaVersion: 3,
        rulesVersion: 2,
        id: `gems-${index + 1}`,
        sectionId: "gems",
        order: index + 1,
        title: gemTitles[index],
        mission: "Buru gem berharga sebelum lenyap.",
        briefing:
          index === 2
            ? "Rubi mahal berada di balik lintasan berlumpur. Memborong emas dekat atau mempertaruhkan waktu untuk rubi?"
            : index === 4
              ? "Kemunculan gem mahal beririsan dengan pergantian gerbang kawah. Siapkan posisi sebelum periode Gem ganda."
              : "Emas dekat cepat diambil. Gelombang berikutnya membawa safir dan rubi bertimer; pedestal menunjukkan tempat kemunculannya.",
        theme,
        mode: "gems",
        seed: 2001 + index,
        timeLimit: 1200,
        board: { ...gemBoard, goal: undefined, gems: gemsFor(gem, index) },
        changes: gemChanges,
        fever,
      }),
    ];
  });
}
export const classicSections = [
  { id: "navigation", order: 1, title: "Balap rute", subtitle: "Pilih urutan pos dan taklukkan gerbang berjadwal.", levelIds: themeIds.map((_, i) => `navigation-${i + 1}`) },
  { id: "gems", order: 2, title: "Perebutan gem", subtitle: "Buru gem berharga, baca gelombang, rebut bonus ganda.", levelIds: themeIds.map((_, i) => `gems-${i + 1}`) },
];
