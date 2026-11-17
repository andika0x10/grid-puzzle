import fs from "node:fs/promises";
import sharp from "sharp";
import { levels, sections } from "../game/provider";
import { extraTokens } from "../game/extra-modes";
import { cellOf } from "../game/modes";
import { layoutFingerprint } from "./level-checks";
const boxWidth = 224,
  boxHeight = 186,
  width = boxWidth * 7,
  height = boxHeight * sections.length + 52;
const colors = { ground: "#c7d8a0", path: "#b8d38b", slow: "#b49570", wall: "#344b43", water: "#83bdce", "bridge-h": "#e2b979", "bridge-v": "#e2b979" };
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const items: string[] = [
  `<rect width="${width}" height="${height}" fill="#fff"/><text x="12" y="23" font-size="18" font-weight="700">${levels.length} arena · ${new Set(levels.map(layoutFingerprint)).size} topologi unik · ${sections.length} permainan</text><text x="12" y="42" font-size="11" fill="#52616a">Peta authoring penuh. S: spawn, G: keluar, C: pengisian, E: suar, P: bahan, M: pulau, B: peti, D: tujuan, T: terminal.</text>`,
];
for (const l of levels) {
  const x = (l.order - 1) * boxWidth,
    y = sections.findIndex((s) => s.id === l.sectionId) * boxHeight + 52,
    size = Math.min(9, (boxWidth - 20) / l.board.width, (boxHeight - 46) / l.board.height),
    mx = x + (boxWidth - l.board.width * size) / 2,
    my = y + 37;
  items.push(
    `<rect x="${x + 3}" y="${y + 3}" width="${boxWidth - 6}" height="${boxHeight - 6}" rx="4" fill="#f4f7f5"/><text x="${x + 10}" y="${y + 16}" font-size="10" font-weight="700">${escape(sections.find((s) => s.id === l.sectionId)!.title)} ${l.order}</text><text x="${x + 10}" y="${y + 30}" font-size="10">${escape(l.title)}</text>`
  );
  l.board.terrain.forEach((t, c) =>
    items.push(`<rect x="${mx + (c % l.board.width) * size}" y="${my + Math.floor(c / l.board.width) * size}" width="${size}" height="${size}" fill="${colors[t]}"/>`)
  );
  const label = (cell: number, symbol: string, color = "#fff") =>
    items.push(
      `<rect x="${mx + (cell % l.board.width) * size + 0.5}" y="${my + Math.floor(cell / l.board.width) * size + 0.5}" width="${size - 1}" height="${size - 1}" fill="${color}"/><text text-anchor="middle" x="${mx + ((cell % l.board.width) + 0.5) * size}" y="${my + (Math.floor(cell / l.board.width) + 0.82) * size}" font-size="${size * 0.85}" font-weight="700" fill="#172c2d">${symbol}</text>`
    );
  for (const [i, p] of (l.board.spawns ?? [l.board.spawn]).entries()) label(cellOf(p, l.board.width), String(i + 1), "#7edb4b");
  for (const p of extraTokens(l)) label(cellOf(p, l.board.width), "*", "#ffdd77");
  if (l.mode === "portal") for (const [i, p] of l.portal.pads.entries()) label(cellOf(p, l.board.width), String(i + 1), "#c4a5ef");
  if (l.mode === "flow") for (const p of l.flow.currents) label(cellOf(p, l.board.width), p.dx > 0 ? "→" : p.dx < 0 ? "←" : p.dy > 0 ? "↓" : "↑", "#8ed8e5");
  if (l.mode === "stealth") for (const g of l.stealth.guards) for (const p of g.route) label(cellOf(p, l.board.width), "·", "#e9ad84");
  if (l.board.goal) label(cellOf(l.board.goal, l.board.width), "G");
  if (l.mode === "hunt") l.hunt.targets.forEach((t, i) => t.route.forEach((p, n) => label(cellOf(p, l.board.width), n === 0 ? String(i + 1) : "·", "#ffdc7b")));
  if (l.mode === "circuit") {
    l.circuit.switches.forEach((p, i) => label(cellOf(p, l.board.width), String(i + 1), "#ffbb77"));
    for (const p of l.circuit.contracts) label(cellOf(p, l.board.width), "T", "#94e3e7");
  }
  if (l.mode === "energy") {
    for (const p of l.energy.chargers) label(cellOf(p, l.board.width), "C", "#7fe0e5");
    for (const p of l.energy.beacons) label(cellOf(p, l.board.width), "E", "#ffde7b");
  }
  if (l.mode === "bridge") {
    for (const p of l.bridge.supplies) label(cellOf(p, l.board.width), "P", "#e4bb7d");
    for (const p of l.bridge.markers) label(cellOf(p, l.board.width), "M", "#f5df7c");
    l.bridge.spans.forEach((s, i) => s.cells.forEach((p) => label(cellOf(p, l.board.width), String(i + 1), "#b8d8e3")));
  }
  if (l.mode === "crates") {
    for (const p of l.crates.boxes) label(cellOf(p, l.board.width), "B", "#e2ab6d");
    for (const p of l.crates.docks) label(cellOf(p, l.board.width), "D", "#8ed4b1");
  }
}
await fs.mkdir("artifacts/arena-review", { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Arial,sans-serif">${items.join("")}</svg>`;
await fs.writeFile("artifacts/arena-review/all-maps.svg", svg);
const renderSvg = sharp as (input: Buffer) => { png(): { toFile(path: string): Promise<unknown> } };
await renderSvg(Buffer.from(svg)).png().toFile("artifacts/arena-review/all-maps.png");
console.log("Saved authoring contact sheet: artifacts/arena-review/all-maps.png");
