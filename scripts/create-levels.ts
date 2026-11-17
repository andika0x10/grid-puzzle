import fs from "node:fs/promises";
import { authorLevels, sections } from "./author-arenas";
const authored = authorLevels();
await fs.mkdir("content/levels", { recursive: true });
// Replace built-in arena definitions and remove retired IDs.
for (const file of await fs.readdir("content/levels")) if (file.endsWith(".json") && !authored.some((l) => `${l.id}.json` === file)) await fs.unlink(`content/levels/${file}`);
for (const level of authored) await fs.writeFile(`content/levels/${level.id}.json`, JSON.stringify(level, null, 2) + "\n");
await fs.writeFile("content/sections.json", JSON.stringify(sections, null, 2) + "\n");
await fs.writeFile("content/catalog.json", JSON.stringify({ sections, levels: authored }, null, 2) + "\n");
console.log("Built 91 arenas in 13 independent categories (schema 5).");
