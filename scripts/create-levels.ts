// Author initial data only. Paths and results are calculated live in the browser.
import fs from "node:fs/promises";
import { authorClassicModes, classicSections } from "./author-classic";
import { authorNewModes, newSections } from "./author-modes";
await fs.mkdir("content/levels", { recursive: true });
for (const level of [...authorClassicModes(), ...authorNewModes()]) {
  const data = JSON.parse(JSON.stringify(level));
  if (data.rulesVersion === 1) delete data.rulesVersion;
  if (!data.fever.length) delete data.fever;
  if (!data.board.checkpoints.length) delete data.board.checkpoints;
  if (!data.board.gates.length) delete data.board.gates;
  await fs.writeFile(`content/levels/${level.id}.json`, JSON.stringify(data, null, 2) + "\n");
}
await fs.writeFile("content/sections.json", JSON.stringify([...classicSections, ...newSections], null, 2) + "\n");
console.log("Authored 49 initial levels: 14 redesigned race/gem arenas and 35 other mode levels. No algorithm output is stored.");
