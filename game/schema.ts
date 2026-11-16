import { z } from "zod";
import { themeIds } from "./themes";
export const terrainIds = ["ground", "path", "slow", "water", "wall", "bridge-h", "bridge-v"] as const;
export type Terrain = (typeof terrainIds)[number];
export const pointSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });
export type Point = z.infer<typeof pointSchema>;
export const isWalkable = (terrain: Terrain | undefined) => terrain !== undefined && terrain !== "wall" && terrain !== "water";
export const terrainCost = (terrain: Terrain) => (terrain === "slow" ? 4 : 1);
export const levelSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string().regex(/^[a-z0-9-]+$/),
    sectionId: z.string(),
    order: z.number().int().positive(),
    title: z.string().min(1),
    mission: z.string().min(1),
    theme: z.enum(themeIds),
    mode: z.enum(["race", "gems"]),
    seed: z.number().int(),
    timeLimit: z.number().int().min(1).max(1200),
    board: z.object({
      width: z.number().int().min(3).max(32),
      height: z.number().int().min(3).max(32),
      terrain: z.array(z.enum(terrainIds)),
      spawn: pointSchema,
      goal: pointSchema.optional(),
      gems: z.array(pointSchema),
      decorations: z.array(pointSchema),
    }),
    changes: z.array(pointSchema.extend({ tick: z.number().int().positive(), terrain: z.enum(terrainIds) })),
  })
  .superRefine((level, ctx) => {
    const b = level.board;
    if (b.terrain.length !== b.width * b.height) ctx.addIssue({ code: "custom", message: "Jumlah terrain tidak sesuai ukuran papan." });
    const points = [b.spawn, ...(b.goal ? [b.goal] : []), ...b.gems, ...b.decorations, ...level.changes];
    if (points.some((p) => p.x >= b.width || p.y >= b.height)) ctx.addIssue({ code: "custom", message: "Koordinat di luar papan." });
    if (level.mode === "race" && !b.goal) ctx.addIssue({ code: "custom", message: "Balap membutuhkan finis." });
    if (level.mode === "gems" && !b.gems.length) ctx.addIssue({ code: "custom", message: "Arena membutuhkan gem." });
    if ([b.spawn, ...(b.goal ? [b.goal] : []), ...b.gems].some((p) => !isWalkable(b.terrain[p.y * b.width + p.x])))
      ctx.addIssue({ code: "custom", message: "Start, finis, dan gem harus dapat diinjak." });
    if (new Set(b.gems.map((p) => `${p.x},${p.y}`)).size !== b.gems.length) ctx.addIssue({ code: "custom", message: "Posisi gem harus unik." });
  });
export const sectionSchema = z.object({ id: z.string(), order: z.number().int().positive(), title: z.string(), subtitle: z.string(), levelIds: z.array(z.string()).min(1) });
export type LevelDefinition = z.infer<typeof levelSchema>;
export type SectionDefinition = z.infer<typeof sectionSchema>;
