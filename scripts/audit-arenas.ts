import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { levels } from "../game/provider";
import { adjacent, cellOf } from "../game/modes";
import { isWalkable, type LevelDefinition } from "../game/schema";
import { allOpenTerrain, layoutFingerprint, objectivePoints } from "./level-checks";
import { extraTokens } from "../game/extra-modes";

// Compare normalized occupancy under all eight rotations/reflections. This is
// intentionally approximate: it detects resized lookalikes, not graph isomorphism.
function raster(l: LevelDefinition) {
  const t = allOpenTerrain(l),
    size = 24;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => {
      const xx = 1 + Math.min(l.board.width - 3, Math.floor((x / size) * (l.board.width - 2))),
        yy = 1 + Math.min(l.board.height - 3, Math.floor((y / size) * (l.board.height - 2)));
      return Number(isWalkable(t[yy * l.board.width + xx]));
    })
  );
}
function variants(rows: number[][]) {
  const out: number[][] = [];
  for (let i = 0; i < 4; i++) {
    out.push(rows.flat(), rows.map((r) => [...r].reverse()).flat());
    rows = rows[0].map((_, x) => rows.map((r) => r[x]).reverse());
  }
  return out;
}
const cached = new Map<string, number[][]>();
function similarity(a: LevelDefinition, b: LevelDefinition) {
  const key = `${b.id}:${b.seed}`;
  if (!cached.has(key)) cached.set(key, variants(raster(b)));
  const r = raster(a).flat();
  return Math.max(...cached.get(key)!.map((v) => v.reduce((n, c, i) => n + Number(c === r[i]), 0) / r.length));
}
function graph(l: LevelDefinition) {
  const t = allOpenTerrain(l),
    cells = t.flatMap((v, i) => (isWalkable(v) ? [i] : []));
  const degrees = cells.map((c) => adjacent(c, l.board.width, l.board.height).filter((n) => isWalkable(t[n])).length);
  return {
    floor: cells.length,
    deadEnds: degrees.filter((d) => d === 1).length,
    junctions: degrees.filter((d) => d >= 3).length,
    loops: degrees.reduce((a, b) => a + b, 0) / 2 - cells.length + 1,
  };
}
const before = JSON.parse(execFileSync("git", ["show", "6f545d7:content/catalog.json"], { encoding: "utf8", maxBuffer: 10_000_000 })).levels as LevelDefinition[];
function primaryTargets(l: LevelDefinition) {
  const xy = (p: { x: number; y: number }) => [p.x, p.y];
  switch (l.mode) {
    case "fog":
      return [l.board.goal!].map(xy);
    case "hunt":
      return l.hunt.targets.map((t) => t.route.map(xy));
    case "circuit":
      return l.circuit.contracts.map(xy);
    case "energy":
      return l.energy.beacons.map(xy);
    case "bridge":
      return [...l.bridge.markers, l.board.goal!].map(xy);
    case "crates":
      return l.crates.docks.map(xy);
    case "collapse":
      return l.collapse.waves.map((wave) => ({ tick: wave.tick, cells: wave.cells.map(xy) }));
    default:
      return extraTokens(l).map(xy);
  }
}
const report = levels.map((l) => {
  const old = before.find((b) => b.id === l.id),
    peers = levels
      .filter((p) => p.mode === l.mode && p.id !== l.id)
      .map((p) => ({ id: p.id, similarity: similarity(l, p) }))
      .sort((a, b) => b.similarity - a.similarity);
  const normalized = (p: { x: number; y: number }, board: LevelDefinition["board"]) => `${(p.x / (board.width - 1)).toFixed(2)},${(p.y / (board.height - 1)).toFixed(2)}`;
  return {
    id: l.id,
    size: `${l.board.width}x${l.board.height}`,
    ...graph(l),
    spawn: normalized(l.board.spawn, l.board),
    targets: objectivePoints(l).map((p) => cellOf(p, l.board.width)),
    nearestInCategory: peers[0],
    prior: old
      ? {
          exactSameTopology: layoutFingerprint(old) === layoutFingerprint(l),
          occupancySimilarity: similarity(l, old),
          spawnChanged: l.board.spawn.x !== old.board.spawn.x || l.board.spawn.y !== old.board.spawn.y,
          normalizedSpawnChanged: normalized(l.board.spawn, l.board) !== normalized(old.board.spawn, old.board),
          targetLayoutChanged: JSON.stringify(primaryTargets(l)) !== JSON.stringify(primaryTargets(old)),
          dimensionsChanged: l.board.width !== old.board.width || l.board.height !== old.board.height,
          graph: graph(old),
        }
      : null,
  };
});
const oldSpawnPositions = new Set(before.map((l) => `${l.board.spawn.x <= 1 ? "left" : "other"}:${l.board.spawn.y >= l.board.height - 2 ? "bottom" : "other"}`));
const summary = {
  comparedCommit: "6f545d7",
  arenas: levels.length,
  exactUniqueTopologies: new Set(levels.map(layoutFingerprint)).size,
  oldArenaCount: before.length,
  oldSpawnCornerPatterns: [...oldSpawnPositions],
  changedPreviousTopologies: report.filter((r) => r.prior && !r.prior.exactSameTopology).length,
  changedPreviousSpawns: report.filter((r) => r.prior?.spawnChanged).length,
  changedPreviousObjectives: report.filter((r) => r.prior?.targetLayoutChanged).length,
  worstCategorySimilarity: Math.max(...report.map((r) => r.nearestInCategory.similarity)),
  note: "Normalized occupancy similarity is a visual heuristic. Graph counts and spawn/target locations are reported separately; uniqueness alone does not establish enjoyable gameplay.",
  report,
};
await fs.mkdir("artifacts/campaign-review", { recursive: true });
await fs.writeFile("artifacts/campaign-review/map-audit.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, report: undefined }, null, 2));
