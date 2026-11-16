import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const out = path.resolve("public/assets/game");
const source = path.join(out, "source");
const names = ["grass", "path", "mud", "water", "stone", "wall", "bridge-h", "bridge-v", "start", "goal", "crate", "tree", "bush", "crystal", "discovery", "success"];
const dirs = ["down", "left", "right", "up"];
const actorNames = dirs.flatMap((d) => ["idle-0", "idle-1", "walk-0", "walk-1", "walk-2", "walk-3"].map((n) => `actor-${d}-${n}`));
const sources = {
  farm: ["farm-terrain-source.png", "farmer-source.png"],
  desert: ["desert-terrain-source.png", "sheriff-source.png"],
};

async function extractSheet(file, cols, rows, ids, actor = false) {
  const input = path.join(source, file);
  const m = await sharp(input).metadata();
  const sprites = [];
  for (let i = 0; i < ids.length; i++) {
    const x = i % cols,
      y = Math.floor(i / cols);
    const left = Math.round((x * m.width) / cols),
      top = Math.round((y * m.height) / rows);
    const width = Math.round(((x + 1) * m.width) / cols) - left;
    const height = Math.round(((y + 1) * m.height) / rows) - top;
    // Remove the source sheet's separator from opaque terrain, without trimming game objects.
    const inset = !actor && i < 8 ? 3 : 0;
    const { data } = await sharp(input)
      .extract({
        left: left + inset,
        top: top + inset,
        width: width - inset * 2,
        height: height - inset * 2,
      })
      .resize(32, 32, { kernel: "nearest", fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let p = 3; p < data.length; p += 4) data[p] = !actor && i < 8 ? 255 : data[p] >= 192 ? 255 : 0;
    let image = sharp(data, { raw: { width: 32, height: 32, channels: 4 } });
    if (actor) {
      // All animation poses share a foot baseline, including the slightly taller walk poses.
      let bottom = 0;
      for (let p = 3; p < data.length; p += 4) if (data[p]) bottom = Math.max(bottom, Math.floor(p / 4 / 32));
      const shift = 28 - bottom;
      const aligned = Buffer.alloc(data.length);
      for (let py = 0; py < 32; py++) {
        const targetY = py + shift;
        if (targetY >= 0 && targetY < 32) data.copy(aligned, targetY * 128, py * 128, (py + 1) * 128);
      }
      image = sharp(aligned, { raw: { width: 32, height: 32, channels: 4 } });
    }
    const buffer = await image.png({ palette: true, colours: 24, dither: 0 }).toBuffer();
    sprites.push({ name: ids[i], buffer });
  }
  return sprites;
}

const biomeSprites = {};
for (const [theme, files] of Object.entries(sources)) {
  const sprites = [...(await extractSheet(files[0], 4, 4, names)), ...(await extractSheet(files[1], 6, 4, actorNames, true))];
  biomeSprites[theme] = new Map(sprites.map((s) => [s.name, s.buffer]));
  const frames = Object.fromEntries(
    sprites.map((s, i) => [
      s.name,
      {
        frame: { x: (i % 8) * 32, y: Math.floor(i / 8) * 32, w: 32, h: 32 },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 },
        sourceSize: { w: 32, h: 32 },
      },
    ])
  );
  const animations = Object.fromEntries(
    dirs.flatMap((d) => [
      [`actor-${d}-idle`, [0, 1].map((i) => `actor-${d}-idle-${i}`)],
      [`actor-${d}-walk`, [0, 1, 2, 3].map((i) => `actor-${d}-walk-${i}`)],
    ])
  );
  const dir = path.join(out, theme);
  await fs.mkdir(path.join(dir, "sprites"), { recursive: true });
  await sharp({ create: { width: 256, height: 160, channels: 4, background: "#00000000" } })
    .composite(sprites.map((s, i) => ({ input: s.buffer, left: (i % 8) * 32, top: Math.floor(i / 8) * 32 })))
    .png({ palette: true, colours: 128, dither: 0 })
    .toFile(path.join(dir, "atlas.png"));
  await fs.writeFile(
    path.join(dir, "atlas.json"),
    JSON.stringify(
      {
        frames,
        animations,
        meta: { image: "atlas.png", format: "RGBA8888", size: { w: 256, h: 160 }, scale: "1" },
      },
      null,
      2
    ) + "\n"
  );
  for (const s of sprites) await fs.writeFile(path.join(dir, "sprites", s.name + ".png"), s.buffer);
}

const catalog = JSON.parse(await fs.readFile("content/catalog.json", "utf8"));
await fs.mkdir("public/demo/thumbnails", { recursive: true });
for (const l of catalog.levels) {
  const sprites = biomeSprites[l.theme ?? "farm"];
  const b = l.board;
  const parts = b.terrain.map((t, i) => ({
    input: sprites.get(t),
    left: (i % b.width) * 32,
    top: Math.floor(i / b.width) * 32,
  }));
  for (const o of b.objects) parts.push({ input: sprites.get(o.asset), left: o.x * 32, top: o.y * 32 });
  if (b.robot)
    parts.push({
      input: sprites.get("actor-down-idle-0"),
      left: b.robot.x * 32,
      top: b.robot.y * 32,
    });
  await sharp({
    create: { width: b.width * 32, height: b.height * 32, channels: 4, background: "#ffffff" },
  })
    .composite(parts)
    .png()
    .toFile(`public/demo/thumbnails/${l.id}.png`);
}
console.log("Packed 2 biomes, 80 sprite frames, and 10 board thumbnails.");
