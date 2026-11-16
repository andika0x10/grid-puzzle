import { z } from "zod";
import { themeIds } from "./themes";
export const terrainIds = ["ground", "path", "slow", "water", "wall", "bridge-h", "bridge-v"] as const;
export type Terrain = (typeof terrainIds)[number];
export const pointSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });
export type Point = z.infer<typeof pointSchema>;
export const gameModes = ["race", "gems", "cargo", "territory", "survival", "keys", "outposts"] as const;
export type GameMode = (typeof gameModes)[number];
export const keyColors = ["red", "blue", "gold"] as const;
export type KeyColor = (typeof keyColors)[number];
const coloredPoint = pointSchema.extend({ color: z.enum(keyColors) });
const gemPoint = pointSchema.extend({
  value: z.number().int().min(1).max(9).optional(),
  spawnTick: z.number().int().nonnegative().optional(),
  expireTick: z.number().int().positive().nullable().optional(),
});
export const isWalkable = (terrain: Terrain | undefined) => terrain !== undefined && terrain !== "wall" && terrain !== "water";
export const terrainCost = (terrain: Terrain) => (terrain === "slow" ? 4 : 1);
export const levelSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    id: z.string().regex(/^[a-z0-9-]+$/),
    sectionId: z.string(),
    order: z.number().int().positive(),
    title: z.string().min(1),
    mission: z.string().min(1),
    briefing: z.string().optional(),
    rulesVersion: z.number().int().min(1).default(1),
    theme: z.enum(themeIds),
    mode: z.enum(gameModes),
    seed: z.number().int(),
    timeLimit: z.number().int().min(1).max(1200),
    board: z.object({
      width: z.number().int().min(3).max(32),
      height: z.number().int().min(3).max(32),
      terrain: z.array(z.enum(terrainIds)),
      spawn: pointSchema,
      goal: pointSchema.optional(),
      gems: z.array(gemPoint),
      decorations: z.array(pointSchema),
      parcels: z.array(pointSchema).default([]),
      depot: pointSchema.optional(),
      keys: z.array(coloredPoint).default([]),
      doors: z.array(coloredPoint).default([]),
      posts: z.array(pointSchema).default([]),
      checkpoints: z.array(pointSchema).max(6).default([]),
      gates: z.array(pointSchema).default([]),
    }),
    changes: z.array(pointSchema.extend({ tick: z.number().int().positive(), terrain: z.enum(terrainIds) })),
    cargoCapacity: z.number().int().min(1).max(9).default(3),
    waves: z.array(z.object({ tick: z.number().int().positive(), cells: z.array(pointSchema).min(1) })).default([]),
    fever: z.array(z.object({ startTick: z.number().int().positive(), endTick: z.number().int().positive() })).default([]),
  })
  .superRefine((level, ctx) => {
    const b = level.board;
    if (b.terrain.length !== b.width * b.height) ctx.addIssue({ code: "custom", message: "Jumlah terrain tidak sesuai ukuran papan." });
    const objects = [...b.parcels, ...(b.depot ? [b.depot] : []), ...b.keys, ...b.doors, ...b.posts, ...b.checkpoints];
    const points = [b.spawn, ...(b.goal ? [b.goal] : []), ...b.gems, ...b.decorations, ...objects, ...b.gates, ...level.changes, ...level.waves.flatMap((w) => w.cells)];
    if (points.some((p) => p.x >= b.width || p.y >= b.height)) ctx.addIssue({ code: "custom", message: "Koordinat di luar papan." });
    if (level.mode === "race" && !b.goal) ctx.addIssue({ code: "custom", message: "Balap membutuhkan finis." });
    if (level.mode === "gems" && !b.gems.length) ctx.addIssue({ code: "custom", message: "Arena membutuhkan gem." });
    if (level.mode === "cargo" && (!b.parcels.length || !b.depot)) ctx.addIssue({ code: "custom", message: "Kurir membutuhkan barang dan depot." });
    if (level.mode === "keys" && (!b.goal || !b.keys.length)) ctx.addIssue({ code: "custom", message: "Kunci dan pintu membutuhkan kunci dan pintu keluar." });
    if (level.mode === "outposts" && b.posts.length !== 3) ctx.addIssue({ code: "custom", message: "Arena membutuhkan tiga pos." });
    if (level.mode === "survival" && !level.waves.length) ctx.addIssue({ code: "custom", message: "Zona selamat membutuhkan gelombang bahaya." });
    if (objects.some((p) => !isWalkable(b.terrain[p.y * b.width + p.x]))) ctx.addIssue({ code: "custom", message: "Objek permainan harus berada di petak yang dapat diinjak." });
    if (new Set(b.keys.map((p) => p.color)).size !== b.keys.length || b.doors.some((p) => !b.keys.some((k) => k.color === p.color)))
      ctx.addIssue({ code: "custom", message: "Setiap warna kunci harus unik dan pintu membutuhkan kunci yang cocok." });
    for (const group of [b.parcels, b.keys, b.doors, b.posts, b.checkpoints, b.gates])
      if (new Set(group.map((p) => `${p.x},${p.y}`)).size !== group.length) ctx.addIssue({ code: "custom", message: "Posisi objek sejenis harus unik." });
    if (b.depot && b.parcels.some((p) => p.x === b.depot!.x && p.y === b.depot!.y)) ctx.addIssue({ code: "custom", message: "Barang tidak boleh berada di depot." });
    if (b.doors.some((d) => [b.spawn, ...b.keys, ...(b.goal ? [b.goal] : [])].some((p) => p.x === d.x && p.y === d.y)))
      ctx.addIssue({ code: "custom", message: "Pintu tidak boleh menutupi start, kunci, atau finis." });
    if (level.waves.some((w, i) => w.tick > level.timeLimit || (i > 0 && w.tick <= level.waves[i - 1].tick)))
      ctx.addIssue({ code: "custom", message: "Jadwal bahaya harus berurutan dan berada dalam batas pertandingan." });
    if ([b.spawn, ...(b.goal ? [b.goal] : []), ...b.gems].some((p) => !isWalkable(b.terrain[p.y * b.width + p.x])))
      ctx.addIssue({ code: "custom", message: "Start, finis, dan gem harus dapat diinjak." });
    if (new Set(b.gems.map((p) => `${p.x},${p.y}`)).size !== b.gems.length) ctx.addIssue({ code: "custom", message: "Posisi gem harus unik." });
    if (b.gems.some((g) => (g.spawnTick ?? 0) >= level.timeLimit || (g.expireTick != null && (g.expireTick <= (g.spawnTick ?? 0) || g.expireTick > level.timeLimit))))
      ctx.addIssue({ code: "custom", message: "Jadwal gem harus muncul sebelum kedaluwarsa dan dalam batas pertandingan." });
    if (level.fever.some((f, i) => f.startTick >= f.endTick || f.endTick > level.timeLimit || (i > 0 && f.startTick < level.fever[i - 1].endTick)))
      ctx.addIssue({ code: "custom", message: "Periode bonus harus berurutan, tidak tumpang tindih, dan dalam batas pertandingan." });
    if (b.checkpoints.some((p) => [b.spawn, ...(b.goal ? [b.goal] : [])].some((q) => p.x === q.x && p.y === q.y)))
      ctx.addIssue({ code: "custom", message: "Pos lintasan harus berbeda dari start dan finis." });
  });
export const sectionSchema = z.object({ id: z.string(), order: z.number().int().positive(), title: z.string(), subtitle: z.string(), levelIds: z.array(z.string()).min(1) });
export type LevelDefinition = z.infer<typeof levelSchema>;
export type SectionDefinition = z.infer<typeof sectionSchema>;
