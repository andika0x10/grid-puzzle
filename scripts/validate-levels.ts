import fs from "node:fs/promises";
import path from "node:path";
import { levelSchema, sectionSchema, terrainIds } from "../game/schema";
import { themeIds } from "../game/themes";
import { MatchEngine } from "../game/engine";
import { algorithms, defaultConfig, unavailableReason } from "../game/algorithms";
const read = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const sections = (await read("content/sections.json")).map((s: unknown) => sectionSchema.parse(s));
const levels = await Promise.all(
  (await fs.readdir("content/levels"))
    .filter((f) => f.endsWith(".json"))
    .map(async (f) => {
      const raw = await read(`content/levels/${f}`);
      ensure(!("traceRefs" in raw || "result" in raw || "steps" in raw), `Precomputed data in ${f}`);
      return levelSchema.parse(raw);
    })
);
ensure(levels.length === 14 && sections.length === 2, "Expected 14 initial levels in 2 categories");
const ids = sections.flatMap((s: { levelIds: string[] }) => s.levelIds);
ensure(new Set(ids).size === levels.length && ids.length === levels.length, "Duplicate or unlisted level");
for (const section of sections) {
  ensure(new Set(section.levelIds.map((id: string) => levels.find((l) => l.id === id)?.theme)).size === themeIds.length, `Incomplete theme coverage: ${section.id}`);
  for (const [i, id] of section.levelIds.entries()) {
    const level = levels.find((l) => l.id === id);
    ensure(level && level.sectionId === section.id && level.order === i + 1, `Invalid level order: ${id}`);
  }
}
const expected = new Set<string>(["source/terrain-source.png", "source/objects-source.png", "source/prompts.json"]);
let frames = 0;
const characterNames = ["down", "left", "right", "up"].flatMap((d) => [...[0, 1].map((i) => `actor-${d}-idle-${i}`), ...[0, 1, 2, 3].map((i) => `actor-${d}-walk-${i}`)]);
const sharedNames = ["gem-0", "gem-1", "start", "finish", "pickup"];
for (const theme of themeIds) {
  expected.add(`source/characters/${theme}.png`);
  expected.add(`characters/${theme}/portrait.png`);
}
for (const directory of [...themeIds.map((t) => `themes/${t}`), ...themeIds.map((t) => `characters/${t}`), "shared"]) {
  expected.add(`${directory}/atlas.json`);
  expected.add(`${directory}/atlas.png`);
  if (directory.startsWith("themes/")) expected.add(`${directory}/decor.png`);
  const atlas = await read(`public/assets/game/${directory}/atlas.json`),
    bytes = await fs.readFile(`public/assets/game/${directory}/atlas.png`),
    image = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  const names = directory === "shared" ? sharedNames : directory.startsWith("characters/") ? characterNames : [...terrainIds, "decor"];
  ensure(Object.keys(atlas.frames).length === names.length && names.every((n) => atlas.frames[n]), `Unused or missing atlas frame in ${directory}`);
  if (directory.startsWith("characters/")) {
    for (const direction of ["down", "left", "right", "up"])
      for (const [kind, count] of [
        ["idle", 2],
        ["walk", 4],
      ] as const) {
        const sequence = atlas.animations[`actor-${direction}-${kind}`];
        ensure(sequence?.length === count && sequence.every((name: string) => atlas.frames[name]), `Incomplete human animation: ${directory}/${direction}/${kind}`);
      }
  }
  for (const item of Object.values(atlas.frames) as { frame: { x: number; y: number; w: number; h: number } }[]) {
    const f = item.frame;
    ensure(f.w === 32 && f.h === 32 && f.x >= 0 && f.y >= 0 && f.x + f.w <= image.width! && f.y + f.h <= image.height!, `Invalid frame: ${directory}`);
    frames++;
  }
}
async function walk(directory: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) result.push(...(await walk(path.join(directory, item.name), name + "/")));
    else result.push(name);
  }
  return result;
}
for (const file of await walk("public/assets/game")) ensure(expected.has(file), `Unused game asset: ${file}`);
const catalog = await read("content/catalog.json");
ensure(JSON.stringify(catalog.sections) === JSON.stringify(sections), "Stale category catalog");
ensure(
  catalog.levels.length === levels.length && catalog.levels.every((l: { id: string }) => JSON.stringify(l) === JSON.stringify(levels.find((source) => source.id === l.id))),
  "Stale level catalog"
);
for (const level of levels) {
  const engine = new MatchEngine(level, defaultConfig(level.seed));
  let frame = engine.snapshot();
  while (frame.phase !== "finished") frame = engine.step();
  ensure(frame.winners.length > 0, `No finisher or scoring outcome: ${level.id}`);
}
for (const algorithm of algorithms) {
  ensure(
    levels.some((level) => {
      if (unavailableReason(algorithm.id, level)) return false;
      const opponents = algorithms
        .filter((a) => a.id !== algorithm.id && !unavailableReason(a.id, level))
        .slice(0, 3)
        .map((a) => a.id);
      const engine = new MatchEngine(level, { player: algorithm.id, opponents, seed: level.seed });
      let frame = engine.snapshot();
      while (frame.phase !== "finished") frame = engine.step();
      return frame.winners.length === 1 && frame.winners[0] === "bot-0";
    }),
    `Algorithm has no solo win: ${algorithm.id}`
  );
}
console.log(`Validated ${levels.length} live levels, ${themeIds.length} worlds, ${frames} atlas frames, competitive roster, and zero orphaned game assets.`);
