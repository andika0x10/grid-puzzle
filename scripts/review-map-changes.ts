import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { levels, sections } from "../game/provider";
import { adjacent, cellOf } from "../game/modes";
import { isWalkable, type LevelDefinition } from "../game/schema";
import { allOpenTerrain, objectivePoints } from "./level-checks";

const before = JSON.parse(execFileSync("git", ["show", "6f545d7:content/catalog.json"], { encoding: "utf8", maxBuffer: 10_000_000 })).levels as LevelDefinition[];
const width = 1000,
  rowHeight = 220,
  height = rowHeight * 7 + 70,
  svg: string[] = [];
const colors = { ground: "#d3dfb3", path: "#bdd887", slow: "#bd9c7c", wall: "#354b43", water: "#87b9c8", "bridge-h": "#daba86", "bridge-v": "#daba86" };
svg.push(
  `<rect width="${width}" height="${height}" fill="white"/><text x="20" y="25" font-size="20" font-weight="700">Perbandingan 7 arena pertama: struktur, start, objektif</text><text x="20" y="46" font-size="12">Kiri: commit 6f545d7. Kanan: kampanye baru. Garis: jalur referensi pada terrain dengan akses terbuka.</text>`
);
function panel(l: LevelDefinition, x: number, y: number, label: string) {
  const size = Math.min(13, 300 / l.board.width, 170 / l.board.height),
    mx = x + 175,
    my = y + 35;
  svg.push(`<text x="${x + 15}" y="${y + 20}" font-size="13" font-weight="700">${label}: ${l.id} (${l.board.width} × ${l.board.height})</text>`);
  l.board.terrain.forEach((t, c) =>
    svg.push(`<rect x="${mx + (c % l.board.width) * size}" y="${my + Math.floor(c / l.board.width) * size}" width="${size}" height="${size}" fill="${colors[t]}"/>`)
  );
  const start = cellOf(l.board.spawn, l.board.width),
    targets = objectivePoints(l).filter((p) => !(l.board.spawns ?? [l.board.spawn]).some((q) => p.x === q.x && p.y === q.y));
  const target = targets[0] && cellOf(targets[0], l.board.width),
    terrain = allOpenTerrain(l),
    queue = [start],
    parent = new Map<number, number>([[start, -1]]);
  if (target !== undefined) {
    for (let i = 0; i < queue.length && !parent.has(target); i++)
      for (const c of adjacent(queue[i], l.board.width, l.board.height))
        if (isWalkable(terrain[c]) && !parent.has(c)) {
          parent.set(c, queue[i]);
          queue.push(c);
        }
    const route: number[] = [];
    let c = target;
    while (c !== -1 && parent.has(c)) {
      route.push(c);
      c = parent.get(c)!;
    }
    svg.push(
      `<polyline points="${route.map((c) => `${mx + ((c % l.board.width) + 0.5) * size},${my + (Math.floor(c / l.board.width) + 0.5) * size}`).join(" ")}" fill="none" stroke="#b53c9e" stroke-width="2"/>`
    );
  }
  targets.forEach((p) => svg.push(`<circle cx="${mx + (p.x + 0.5) * size}" cy="${my + (p.y + 0.5) * size}" r="${size * 0.32}" fill="#f3b842" stroke="#774719" stroke-width="1"/>`));
  (l.board.spawns ?? [l.board.spawn]).forEach((p, i) =>
    svg.push(
      `<rect x="${mx + p.x * size}" y="${my + p.y * size}" width="${size}" height="${size}" fill="#74c849"/><text x="${mx + (p.x + 0.5) * size}" y="${my + (p.y + 0.8) * size}" text-anchor="middle" font-size="${size * 0.8}">${i + 1}</text>`
    )
  );
  svg.push(
    `<text x="${x + 15}" y="${y + 50}" font-size="12">Start (${l.board.spawn.x}, ${l.board.spawn.y})</text><text x="${x + 15}" y="${y + 70}" font-size="12">${targets.length} titik objektif</text>`
  );
}
for (let i = 0; i < 7; i++) {
  const id = sections[i].levelIds[0],
    y = i * rowHeight + 70;
  svg.push(`<rect x="8" y="${y}" width="984" height="212" fill="${i % 2 ? "#f5f7f6" : "#edf2ef"}"/>`);
  panel(
    before.find((l) => l.id === id)!,
    10,
    y,
    "Sebelum"
  );
  panel(
    levels.find((l) => l.id === id)!,
    500,
    y,
    "Sesudah"
  );
}
await fs.mkdir("docs", { recursive: true });
const render = sharp as (input: Buffer) => { png(): { toFile(path: string): Promise<unknown> } };
await render(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Arial,sans-serif">${svg.join("")}</svg>`))
  .png()
  .toFile("docs/map-changes.png");
console.log("Saved docs/map-changes.png");
