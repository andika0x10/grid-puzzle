import fs from "node:fs/promises";
import path from "node:path";
import { levelSchema, sectionSchema, validateTrace, type LevelDefinition } from "../game/schema";
const read = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const sections = (await read("content/sections.json")).map((s: unknown) => sectionSchema.parse(s));
const levels: LevelDefinition[] = await Promise.all(
  (await fs.readdir("content/levels")).filter((f) => f.endsWith(".json")).map(async (f) => levelSchema.parse(await read(path.join("content/levels", f))))
);
const ensure = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
ensure(new Set(sections.map((s: { id: string }) => s.id)).size === sections.length, "Duplicate section ID");
ensure(new Set(sections.map((s: { order: number }) => s.order)).size === sections.length, "Duplicate section order");
ensure(new Set(levels.map((l) => l.id)).size === levels.length, "Duplicate level ID");
const listed: string[] = sections.flatMap((s: { levelIds: string[] }) => s.levelIds);
ensure(new Set(listed).size === listed.length, "A level is listed more than once");
ensure(listed.length === levels.length, "All levels must be listed in a section");
const atlases = new Map();
let frameCount = 0;
for (const theme of ["farm", "desert"]) {
  const atlas = await read(`public/assets/game/${theme}/atlas.json`);
  const atlasBytes = await fs.readFile(`public/assets/game/${theme}/atlas.png`);
  const atlasImage = { width: atlasBytes.readUInt32BE(16), height: atlasBytes.readUInt32BE(20) };
  for (const [name, item] of Object.entries(atlas.frames) as [string, { frame: { x: number; y: number; w: number; h: number } }][]) {
    const f = item.frame;
    ensure(f.w === 32 && f.h === 32 && f.x >= 0 && f.y >= 0 && f.x + f.w <= atlasImage.width! && f.y + f.h <= atlasImage.height!, `Invalid ${theme} atlas frame ${name}`);
  }
  for (const dir of ["down", "left", "right", "up"]) {
    for (const [animation, length] of [
      ["idle", 2],
      ["walk", 4],
    ] as const) {
      const frames = atlas.animations[`actor-${dir}-${animation}`];
      ensure(frames?.length === length, `Invalid ${theme} ${dir} ${animation} animation`);
      for (const frame of frames) ensure(atlas.frames[frame], `Missing ${theme} frame ${frame}`);
    }
  }
  frameCount += Object.keys(atlas.frames).length;
  atlases.set(theme, atlas);
}
let count = 0;
for (const section of sections) {
  await fs.access(path.join("public", section.illustration));
  for (const [index, id] of section.levelIds.entries()) {
    const level = levels.find((l) => l.id === id);
    ensure(level, `Missing level ${id}`);
    ensure(level!.sectionId === section.id && level!.order === index + 1, `Incorrect order or section for ${id}`);
  }
}
for (const level of levels) {
  const atlas = atlases.get(level.theme);
  ensure(atlas, `Missing atlas for ${level.theme}`);
  for (const asset of [...level.board.terrain, ...level.board.objects.map((o) => o.asset)]) ensure(atlas.frames[asset], `Missing asset ${asset}`);
  await fs.access(`public/demo/thumbnails/${level.id}.png`);
  let hasPass = false;
  for (const option of level.options) {
    const ref = level.traceRefs[option.id];
    ensure(/^\/demo\/traces\/[a-z0-9.-]+\.json$/.test(ref), `Invalid trace path ${ref}`);
    const trace = validateTrace(level, await read(path.join("public", ref)));
    hasPass ||= trace.result.passed;
    count++;
  }
  ensure(hasPass, `No passing option in ${level.id}`);
}
const catalog = await read("content/catalog.json");
ensure(JSON.stringify(catalog.sections) === JSON.stringify(sections), "Catalog is stale: run npm run content:build");
const sourceMap = new Map(levels.map((l) => [l.id, JSON.stringify(l)]));
ensure(
  catalog.levels.length === levels.length && catalog.levels.every((l: LevelDefinition) => sourceMap.get(l.id) === JSON.stringify(levelSchema.parse(l))),
  "Level catalog is stale: run npm run content:build"
);
console.log(`Validated ${sections.length} sections, ${levels.length} levels, ${count} traces, ${atlases.size} biomes, ${frameCount} atlas frames, and all asset references.`);
