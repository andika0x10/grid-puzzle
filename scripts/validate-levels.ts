import fs from "node:fs/promises";
import { levelSchema, sectionSchema, gameModes, terrainIds, type SectionDefinition } from "../game/schema";
import { themeIds } from "../game/themes";
import { cellOf } from "../game/modes";
import { MatchEngine } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { layoutFingerprint, objectivePoints, reachableCells, circuitReachable, weightedDistances } from "./level-checks";
function ensure(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const read = async (p: string) => JSON.parse(await fs.readFile(p, "utf8"));
const sections: SectionDefinition[] = (await read("content/sections.json")).map((s: unknown) => sectionSchema.parse(s));
const files = (await fs.readdir("content/levels")).filter((f) => f.endsWith(".json"));
const levels = await Promise.all(files.map(async (f) => levelSchema.parse(await read(`content/levels/${f}`))));
ensure(levels.length === 49 && sections.length === 7, "Expected seven new games and 49 arenas");
ensure(new Set(levels.map((l) => l.id)).size === 49, "Duplicate IDs");
const fingerprints = new Map<string, string>();
for (const l of levels) {
  const fp = layoutFingerprint(l);
  ensure(!fingerprints.has(fp), `Repeated topology: ${l.id} / ${fingerprints.get(fp)}`);
  fingerprints.set(fp, l.id);
  const seen = reachableCells(l);
  for (const p of objectivePoints(l)) ensure(seen.has(cellOf(p, l.board.width)), `Unreachable object ${l.id} at ${p.x},${p.y}`);
  ensure(circuitReachable(l), `Unreachable switch configuration ${l.id}`);
  if (l.mode === "energy") {
    const ds = l.energy.chargers.map((p) => weightedDistances(l, cellOf(p, l.board.width)));
    for (const p of l.energy.beacons) {
      const d = Math.min(...ds.map((a) => a[cellOf(p, l.board.width)]));
      ensure(d * 2 + 5 <= 24, `Unsafe energy return ${l.id} at ${p.x},${p.y}: ${d}`);
    }
  }
  const engine = new MatchEngine(l, defaultConfig(l.seed));
  let f = engine.snapshot();
  while (f.phase !== "finished") f = engine.step();
  ensure(f.winners.length > 0, `No objective outcome ${l.id}`);
}
for (const [order, mode] of gameModes.entries()) {
  const section = sections.find((s) => s.id === mode);
  ensure(section?.order === order + 1, `Wrong order ${mode}`);
  ensure(new Set(levels.filter((l) => l.mode === mode).map((l) => l.theme)).size === themeIds.length, `Missing worlds ${mode}`);
  ensure(
    section.levelIds.every((id: string, i: number) => levels.some((l) => l.id === id && l.mode === mode && l.order === i + 1)),
    `Wrong progression ${mode}`
  );
}
const catalog = await read("content/catalog.json");
ensure(JSON.stringify(catalog.sections) === JSON.stringify(sections), "Stale sections");
ensure(
  catalog.levels.length === 49 && catalog.levels.every((l: { id: string }) => JSON.stringify(l) === JSON.stringify(levels.find((source) => source.id === l.id))),
  "Stale catalog"
);
for (const theme of themeIds) {
  const atlas = await read(`public/assets/game/themes/${theme}/atlas.json`);
  ensure(
    terrainIds.every((t) => atlas.frames[t]),
    `Missing terrain frames ${theme}`
  );
  const characters = await read(`public/assets/game/characters/${theme}/atlas.json`);
  for (const direction of ["up", "down", "left", "right"]) for (let i = 0; i < 4; i++) ensure(characters.frames[`actor-${direction}-walk-${i}`], `Missing actor ${theme}`);
}
console.log("Validated 49 distinct topologies, 7 shared games, reachable objectives, energy returns, live outcomes, catalog and theme assets.");
