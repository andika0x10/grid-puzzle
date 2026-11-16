import fs from "node:fs/promises";
import path from "node:path";
import { sectionSchema, levelSchema } from "../game/schema";
const dir = path.resolve("content");
const sections = JSON.parse(await fs.readFile(path.join(dir, "sections.json"), "utf8")).map((s: unknown) => sectionSchema.parse(s));
const files = (await fs.readdir(path.join(dir, "levels"))).filter((f) => f.endsWith(".json"));
const levels = await Promise.all(files.map(async (f) => levelSchema.parse(JSON.parse(await fs.readFile(path.join(dir, "levels", f), "utf8")))));
// Filesystem enumeration is alphabetical; the learning path follows section and level order.
levels.sort((a, b) => {
  const sectionA = sections.find((s: { id: string }) => s.id === a.sectionId)?.order ?? Infinity;
  const sectionB = sections.find((s: { id: string }) => s.id === b.sectionId)?.order ?? Infinity;
  return sectionA - sectionB || a.order - b.order;
});
await fs.writeFile(path.join(dir, "catalog.json"), JSON.stringify({ sections, levels }, null, 2) + "\n");
console.log(`Bundled ${sections.length} sections and ${levels.length} levels.`);
