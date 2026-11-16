// Authoring utility: stores initial level data only. Algorithms execute in the browser.
import fs from "node:fs/promises";
import { themeIds } from "../game/themes";
import { levelSchema, type LevelDefinition, type Point, type Terrain } from "../game/schema";
const maps = [
  ["#########", "#......G#", "#..##...#", "#.......#", "#.##....#", "#S::::..#", "#########"],
  ["###########", "#..#.....G#", "#..#.####.#", "#..#......#", "#..####.#.#", "#.......#.#", "#.#####...#", "#S........#", "###########"],
  ["############", "#......mmmG#", "#..###.mm..#", "#....#.mm..#", "#....#.....#", "#.~~~=~~~~.#", "#..........#", "#..mm###...#", "#S:mm......#", "############"],
  // Competing branches: Greedy follows a tempting dead end, while A* spends
  // longer proving the route. Weighted A* can balance the two costs here.
  ["############", "#.....#..G.#", "#..###.....#", "#....#..##.#", "#.##.#.....#", "#....#####.#", "#.....#....#", "#..##....#.#", "#S...#.....#", "############"],
  ["############", "#.........G#", "#..###.....#", "#..........#", "#..#..###..#", "#..........#", "#....###...#", "#..........#", "#S.........#", "############"],
  ["#############", "#.....#....G#", "#.###.#.###.#", "#...#...#...#", "###.#####.#.#", "#...#.....#.#", "#.###.#####.#", "#...........#", "#S#########.#", "#############"],
  [
    "#############",
    "##mG..#.m..m#",
    "#....#m...S.#",
    "#m.m....#m..#",
    "##.m.....m#m#",
    "#m#.....##m.#",
    "#....#####.m#",
    "#..m..#.##.m#",
    "#.##.m..#m..#",
    "#....m.m..m.#",
    "#############",
  ],
];
const names: Record<string, Terrain> = { "#": "wall", ".": "ground", ":": "path", m: "slow", "~": "water", "=": "bridge-h", S: "path", G: "path" };
function boardFrom(rows: string[]) {
  const width = rows[0].length,
    height = rows.length;
  let spawn: Point = { x: 1, y: height - 2 },
    goal: Point = { x: width - 2, y: 1 };
  if (rows.some((r) => r.length !== width)) throw new Error("Map rows must have equal width");
  const terrain = rows.flatMap((r, y) =>
    [...r].map((c, x) => {
      if (c === "S") spawn = { x, y };
      if (c === "G") goal = { x, y };
      return names[c];
    })
  );
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
  };
}
function gemBoard(index: number) {
  const [width, height] = [
    [11, 9],
    [13, 11],
    [17, 13],
    [21, 15],
    [25, 17],
    [29, 21],
    [31, 23],
  ][index];
  let seed = index === 3 ? 42 : 713 + index * 97;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const terrain: Terrain[] = Array.from({ length: width * height }, (_, i) => {
    const x = i % width,
      y = Math.floor(i / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 || random() < (index ? 0.2 : 0.1)
      ? "wall"
      : index === 2 || index === 6
        ? random() < 0.17
          ? "slow"
          : "ground"
        : "ground";
  });
  const regions: number[][] = [],
    seen = new Set<number>();
  for (let i = 0; i < terrain.length; i++)
    if (terrain[i] !== "wall" && !seen.has(i)) {
      const region = [i];
      seen.add(i);
      for (let head = 0; head < region.length; head++) {
        const c = region[head],
          x = c % width,
          y = Math.floor(c / width);
        for (const [nx, ny] of [
          [x + 1, y],
          [x, y - 1],
          [x - 1, y],
          [x, y + 1],
        ]) {
          const n = ny * width + nx;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && terrain[n] !== "wall" && !seen.has(n)) {
            seen.add(n);
            region.push(n);
          }
        }
      }
      regions.push(region);
    }
  const region = regions.sort((a, b) => b.length - a.length)[0];
  const keep = new Set(region);
  terrain.forEach((_, i) => {
    if (!keep.has(i)) terrain[i] = "wall";
  });
  const spawnCell = [...region].sort((a, b) => (a % width) + height - Math.floor(a / width) - ((b % width) + height - Math.floor(b / width)))[0];
  const spawn = { x: spawnCell % width, y: Math.floor(spawnCell / width) };
  terrain[spawnCell] = "path";
  const candidates = region.filter((i) => Math.abs((i % width) - spawn.x) + Math.abs(Math.floor(i / width) - spawn.y) >= 3);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const gems: Point[] = [];
  for (const c of candidates) {
    const p = { x: c % width, y: Math.floor(c / width) };
    if (gems.every((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y) >= 2)) gems.push(p);
    if (gems.length >= 7 + index) break;
  }
  return {
    width,
    height,
    terrain,
    spawn,
    gems,
    decorations: [
      { x: 0, y: 0 },
      { x: width - 1, y: height - 1 },
    ],
  };
}
const raceTitles = ["Langkah pertama", "Belokan gurun", "Jalan berakar", "Jejak di salju", "Rute berubah", "Lorong mesin", "Lintasan terakhir"];
const gemTitles = ["Panen gem", "Harta di pasir", "Kilau rimba", "Gem di salju", "Perebutan kawah", "Perburuan pabrik", "Ekspedisi bintang"];
const levels: LevelDefinition[] = [];
await fs.mkdir("content/levels", { recursive: true });
for (const [index, theme] of themeIds.entries()) {
  levels.push(
    levelSchema.parse({
      schemaVersion: 2,
      id: `navigation-${index + 1}`,
      sectionId: "navigation",
      order: index + 1,
      title: raceTitles[index],
      mission: "Capai garis finis lebih dulu.",
      theme,
      mode: "race",
      seed: 1001 + index,
      timeLimit: 1200,
      board: boardFrom(maps[index]),
      changes: index === 4 ? [{ tick: 40, x: 5, y: 8, terrain: "wall" }] : [],
    })
  );
  levels.push(
    levelSchema.parse({
      schemaVersion: 2,
      id: `gems-${index + 1}`,
      sectionId: "gems",
      order: index + 1,
      title: gemTitles[index],
      mission: "Ambil gem sebanyak mungkin.",
      theme,
      mode: "gems",
      seed: 2001 + index,
      timeLimit: 1200,
      board: gemBoard(index),
      changes: [],
    })
  );
}
for (const level of levels) await fs.writeFile(`content/levels/${level.id}.json`, JSON.stringify(level, null, 2) + "\n");
const sections = [
  { id: "navigation", order: 1, title: "Balap rute", subtitle: "Capai finis lebih dulu dari lawan.", levelIds: themeIds.map((_, i) => `navigation-${i + 1}`) },
  { id: "gems", order: 2, title: "Perebutan gem", subtitle: "Ambil gem sebanyak mungkin.", levelIds: themeIds.map((_, i) => `gems-${i + 1}`) },
];
await fs.writeFile("content/sections.json", JSON.stringify(sections, null, 2) + "\n");
console.log("Authored 14 initial level definitions across 7 themes. No algorithm output was generated.");
