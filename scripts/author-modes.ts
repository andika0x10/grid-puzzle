import { levelSchema, type GameMode, type Point, type Terrain } from "../game/schema";
import { themeIds } from "../game/themes";
import { modeInfo } from "../game/modes";

export const newModes = ["cargo", "territory", "survival", "keys", "outposts"] as const;
const titles: Record<(typeof newModes)[number], string[]> = {
  cargo: ["Kiriman pertama", "Paket gurun", "Logistik rimba", "Titipan salju", "Kargo kawah", "Antar suku cadang", "Pasokan orbit"],
  territory: ["Kebun berwarna", "Batas pasir", "Wilayah rimba", "Jejak penguasa", "Tanah bara", "Lantai milikmu", "Klaim bulan"],
  survival: ["Air mulai naik", "Badai pasir", "Kabut rimba", "Retakan membesar", "Gelombang lava", "Kebocoran reaktor", "Badai meteor"],
  keys: ["Kunci kebun", "Gerbang gurun", "Rahasia rimba", "Pintu es", "Segel kawah", "Akses mesin", "Gerbang orbit"],
  outposts: ["Pos kebun", "Menara pasir", "Pos penjaga", "Bendera salju", "Pos kawah", "Stasiun mesin", "Suar bulan"],
};
const missions: Partial<Record<GameMode, string>> = {
  cargo: "Antar barang sebanyak mungkin ke depot.",
  territory: "Kuasai petak terbanyak sebelum waktu habis.",
  survival: "Hindari bahaya dan bertahan paling lama.",
  keys: "Kumpulkan semua kunci, lalu capai pintu keluar.",
  outposts: "Kuasai pos dan kumpulkan poin terbanyak.",
};
function arena(index: number) {
  const width = [11, 13, 15, 17, 19, 21, 23][index],
    height = [9, 9, 11, 11, 13, 15, 17][index];
  const terrain: Terrain[] = Array.from({ length: width * height }, (_, c) => {
    const x = c % width,
      y = Math.floor(c / width);
    if (!x || !y || x === width - 1 || y === height - 1) return "wall";
    if (x % 4 === 0 && y > 2 && y < height - 3 && y !== Math.floor(height / 2)) return "wall";
    return index === 2 || index === 6 ? ((x + y * 3) % 11 === 0 ? "slow" : "ground") : "ground";
  });
  const spawn = { x: 1, y: height - 2 };
  terrain[spawn.y * width + spawn.x] = "path";
  return {
    width,
    height,
    terrain,
    spawn,
    gems: [] as Point[],
    decorations: [
      { x: 0, y: 0 },
      { x: width - 1, y: height - 1 },
    ],
  };
}
export function authorNewModes() {
  return newModes.flatMap((mode, modeIndex) =>
    themeIds.map((theme, index) => {
      const board = arena(index),
        { width, height, terrain } = board;
      const clear = (p: Point) => {
        terrain[p.y * width + p.x] = "path";
        return p;
      };
      const extras: Record<string, unknown> = {};
      const fields: Record<string, unknown> = {};
      if (mode === "cargo") {
        fields.depot = board.spawn;
        const candidates = [
          { x: 3, y: height - 2 },
          { x: 2, y: height - 3 },
          { x: 5, y: height - 2 },
          { x: width - 2, y: height - 3 },
          { x: 2, y: 2 },
          { x: width - 3, y: 1 },
          { x: Math.floor(width / 2), y: 2 },
          { x: width - 2, y: Math.floor(height / 2) },
          { x: 3, y: Math.floor(height / 2) },
          { x: Math.floor(width / 2), y: height - 2 },
        ];
        fields.parcels = candidates
          .slice(0, 4 + index)
          .filter((p, i, all) => all.findIndex((q) => q.x === p.x && q.y === p.y) === i)
          .map(clear);
      }
      if (mode === "outposts")
        fields.posts = [
          { x: 3, y: height - 3 },
          { x: width - 3, y: height - 3 },
          { x: Math.floor(width / 2), y: 2 },
        ].map(clear);
      if (mode === "survival") {
        const rings = Math.min(6, Math.floor((height - 2) / 2));
        extras.waves = Array.from({ length: rings }, (_, ring) => ({
          tick: 180 + ring * Math.floor(900 / Math.max(1, rings - 1)),
          cells: terrain.flatMap((t, c) => {
            const x = c % width,
              y = Math.floor(c / width),
              edge = Math.min(x, y, width - x - 1, height - y - 1);
            return t !== "wall" && edge === ring + 1 ? [{ x, y }] : [];
          }),
        }));
      }
      if (mode === "keys") {
        // Rooms form a lock chain: each next key is obtainable only after the
        // previous gate. Other modes use the striped arena above.
        for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) terrain[y * width + x] = "ground";
        const count = Math.min(3, index + 1),
          colors = ["red", "blue", "gold"];
        const gates = Array.from({ length: count }, (_, i) => 1 + Math.floor(((i + 1) * (width - 2)) / (count + 1)));
        fields.keys = gates.map((_, i) => ({ ...clear({ x: (i ? gates[i - 1] : 0) + 1, y: i % 2 ? height - 3 : 2 }), color: colors[i] }));
        fields.doors = gates.map((x, i) => {
          for (let y = 1; y < height - 1; y++) terrain[y * width + x] = "wall";
          return { ...clear({ x, y: i % 2 ? 2 : height - 3 }), color: colors[i] };
        });
        fields.goal = clear({ x: width - 2, y: 1 });
      }
      return levelSchema.parse({
        schemaVersion: 3,
        id: `${mode}-${index + 1}`,
        sectionId: mode,
        order: index + 1,
        title: titles[mode][index],
        mission: missions[mode],
        theme,
        mode,
        seed: 3001 + modeIndex * 1000 + index,
        timeLimit: 1200,
        board: { ...board, ...fields },
        changes: [],
        ...extras,
      });
    })
  );
}
export const newSections = newModes.map((mode, i) => ({
  id: mode,
  order: i + 3,
  title: modeInfo[mode].title,
  subtitle: missions[mode]!,
  levelIds: themeIds.map((_, j) => `${mode}-${j + 1}`),
}));
