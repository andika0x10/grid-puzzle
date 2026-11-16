import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const root = path.resolve("public/assets/game");
const themeIds = ["farm", "desert", "forest", "snow", "volcano", "factory", "space"];
const terrainNames = ["ground", "path", "slow", "water", "wall", "bridge-h", "bridge-v", "decor"];
const directions = ["down", "left", "right", "up"];
const sharedOnly = process.argv.includes("--shared-only");
const modeObjects = ["parcel", "depot", "key-red", "key-blue", "key-gold", "door-red", "door-blue", "door-gold", "door-open", "outpost", "hazard-warning", "hazard-active"];
const classicObjects = ["checkpoint-idle", "checkpoint-done", "gate-open", "gate-closed", "gem-blue", "gem-red", "gem-dormant", "gem-fever"];
// The painted terrain sheet has uneven rows. Equal divisions pick up pixels
// from the neighbouring theme (snow edges appeared on every volcanic tile).
const terrainGrid = {
  columns: [0, 167, 335, 502, 670, 838, 1006, 1174, 1340],
  rows: [0, 174, 346, 518, 685, 848, 1011, 1174],
};
async function cell(file, columns, rows, column, row, opaque, actor = false) {
  const input = path.join(root, "source", file),
    meta = await sharp(input).metadata();
  const grid = file === "terrain-source.png" ? terrainGrid : null;
  if (grid && (meta.width !== grid.columns.at(-1) || meta.height !== grid.rows.at(-1))) throw new Error("Update terrainGrid for the new source sheet dimensions.");
  const left = grid ? grid.columns[column] : Math.round((column * meta.width) / columns),
    top = grid ? grid.rows[row] : Math.round((row * meta.height) / rows);
  const width = (grid ? grid.columns[column + 1] : Math.round(((column + 1) * meta.width) / columns)) - left,
    height = (grid ? grid.rows[row + 1] : Math.round(((row + 1) * meta.height) / rows)) - top;
  // Four source pixels also exclude the painted guide's anti-aliased fringe.
  const inset = grid ? 4 : opaque ? 2 : 0;
  const cropped = await sharp(input)
    .extract({ left: left + inset, top: top + inset, width: width - inset * 2, height: height - inset * 2 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 3; i < cropped.data.length; i += 4) {
    cropped.data[i] = opaque ? 255 : cropped.data[i] >= 192 ? 255 : 0;
    if (cropped.data[i] === 0) cropped.data[i - 3] = cropped.data[i - 2] = cropped.data[i - 1] = 0;
  }
  let image = sharp(cropped.data, { raw: { width: cropped.info.width, height: cropped.info.height, channels: 4 } });
  if (!opaque) image = image.trim({ threshold: 12 });
  const size = actor ? { width: 23, height: 27 } : { width: opaque ? 32 : 27, height: opaque ? 32 : 27 };
  const resized = await image
    .resize(size.width, size.height, { fit: opaque ? "fill" : "inside", kernel: "nearest" })
    .png()
    .toBuffer();
  const m = await sharp(resized).metadata();
  const raw = await sharp({ create: { width: 32, height: 32, channels: 4, background: "#00000000" } })
    .composite([{ input: resized, left: Math.floor((32 - m.width) / 2), top: opaque ? 0 : 29 - m.height }])
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let i = 3; i < raw.length; i += 4) raw[i] = opaque ? 255 : raw[i] >= 192 ? 255 : 0;
  return sharp(raw, { raw: { width: 32, height: 32, channels: 4 } })
    .png({ palette: true, colours: 24, dither: 0 })
    .toBuffer();
}
async function atlas(directory, sprites, animations = {}) {
  const columns = 8,
    rows = Math.ceil(sprites.length / columns),
    dir = path.join(root, directory);
  await fs.mkdir(dir, { recursive: true });
  await sharp({ create: { width: columns * 32, height: rows * 32, channels: 4, background: "#00000000" } })
    .composite(sprites.map((s, i) => ({ input: s.buffer, left: (i % columns) * 32, top: Math.floor(i / columns) * 32 })))
    .png()
    .toFile(path.join(dir, "atlas.png"));
  const frames = Object.fromEntries(
    sprites.map((s, i) => [
      s.name,
      {
        frame: { x: (i % columns) * 32, y: Math.floor(i / columns) * 32, w: 32, h: 32 },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
        sourceSize: { w: 32, h: 32 },
      },
    ])
  );
  await fs.writeFile(
    path.join(dir, "atlas.json"),
    JSON.stringify({ frames, animations, meta: { image: "atlas.png", size: { w: columns * 32, h: rows * 32 }, scale: "1" } }, null, 2) + "\n"
  );
}
if (!sharedOnly)
  for (const [row, theme] of themeIds.entries()) {
    const sprites = [];
    for (const [column, name] of terrainNames.entries()) sprites.push({ name, buffer: await cell("terrain-source.png", 8, 7, column, row, column < 7) });
    await atlas(`themes/${theme}`, sprites);
    await fs.writeFile(path.join(root, `themes/${theme}/decor.png`), sprites[7].buffer);
  }
if (!sharedOnly)
  for (const theme of themeIds) {
    const sprites = [],
      animations = {};
    for (const [row, direction] of directions.entries()) {
      for (let column = 0; column < 6; column++) {
        const name = `actor-${direction}-${column < 2 ? `idle-${column}` : `walk-${column - 2}`}`;
        sprites.push({ name, buffer: await cell(`characters/${theme}.png`, 6, 4, column, row, false, true) });
      }
      for (const [kind, count] of [
        ["idle", 2],
        ["walk", 4],
      ])
        animations[`actor-${direction}-${kind}`] = Array.from({ length: count }, (_, i) => `actor-${direction}-${kind}-${i}`);
    }
    await atlas(`characters/${theme}`, sprites, animations);
    await fs.writeFile(path.join(root, `characters/${theme}/portrait.png`), sprites[0].buffer);
  }
const shared = [];
for (const [column, name] of ["gem-0", "gem-1", "start", "finish", "pickup"].entries()) shared.push({ name, buffer: await cell("objects-source.png", 5, 1, column, 0, false) });
for (const [index, name] of modeObjects.entries()) shared.push({ name, buffer: await cell("modes-source.png", 4, 3, index % 4, Math.floor(index / 4), false) });
for (const [index, name] of classicObjects.entries()) shared.push({ name, buffer: await cell("classic-source.png", 4, 2, index % 4, Math.floor(index / 4), false) });
await atlas("shared", shared);
console.log(
  sharedOnly
    ? `Packed shared object atlas with ${shared.length} frames.`
    : `Packed 7 world atlases, 7 human character atlases, 1 shared object atlas (${shared.length} frames), and 14 UI sprites.`
);
