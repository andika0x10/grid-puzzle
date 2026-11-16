import { z } from "zod";

export const terrainIds = ["grass", "path", "mud", "water", "stone", "wall", "bridge-h", "bridge-v"] as const;
export const objectIds = ["start", "goal", "crate", "tree", "bush", "crystal"] as const;
export const pointSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
});
export const metricSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  unit: z.string(),
  description: z.string(),
  goal: z.enum(["lower", "higher", "exact"]),
  limit: z.number().optional(),
  required: z.boolean().default(false),
});
export const optionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  detail: z.string(),
});
export const levelSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9-]+$/),
    sectionId: z.string(),
    order: z.number().int().positive(),
    title: z.string(),
    description: z.string(),
    mission: z.string(),
    tip: z.string(),
    mechanic: z.enum(["navigation", "clustering"]),
    theme: z.enum(["farm", "desert"]).default("farm"),
    board: z.object({
      width: z.number().int().min(3).max(64),
      height: z.number().int().min(3).max(64),
      terrain: z.array(z.enum(terrainIds)),
      objects: z.array(
        pointSchema.extend({
          id: z.string(),
          asset: z.enum(objectIds),
          group: z.number().int().optional(),
        })
      ),
      robot: pointSchema.optional(),
      goal: pointSchema.optional(),
    }),
    options: z.array(optionSchema).length(5),
    metrics: z.array(metricSchema).min(1).max(4),
    traceRefs: z.record(z.string(), z.string()),
  })
  .superRefine((level, ctx) => {
    const { width, height, terrain, objects, robot, goal } = level.board;
    if (terrain.length !== width * height)
      ctx.addIssue({
        code: "custom",
        path: ["board", "terrain"],
        message: "Jumlah terrain harus sama dengan width × height.",
      });
    for (const p of [...objects, ...(robot ? [robot] : []), ...(goal ? [goal] : [])])
      if (p.x >= width || p.y >= height)
        ctx.addIssue({
          code: "custom",
          path: ["board"],
          message: "Koordinat objek berada di luar papan.",
        });
    if (new Set(objects.map((o) => o.id)).size !== objects.length) ctx.addIssue({ code: "custom", path: ["board", "objects"], message: "ID objek harus unik." });
    if (new Set(level.options.map((o) => o.id)).size !== 5) ctx.addIssue({ code: "custom", path: ["options"], message: "Lima ID pilihan harus unik." });
    if (new Set(level.metrics.map((m) => m.id)).size !== level.metrics.length) ctx.addIssue({ code: "custom", path: ["metrics"], message: "ID metrik harus unik." });
    for (const option of level.options)
      if (!level.traceRefs[option.id])
        ctx.addIssue({
          code: "custom",
          path: ["traceRefs"],
          message: `Rekaman ${option.id} belum tersedia.`,
        });
    if (level.mechanic === "navigation" && (!robot || !goal))
      ctx.addIssue({
        code: "custom",
        path: ["board"],
        message: "Navigasi membutuhkan posisi karakter dan tujuan.",
      });
  });
export const sectionSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  color: z.enum(["green", "purple"]),
  illustration: z.string(),
  levelIds: z.array(z.string()).min(1),
});
export const cellStateSchema = z.object({
  status: z.enum(["visited", "frontier", "active"]).optional(),
  group: z.number().int().optional(),
  terrain: z.enum(terrainIds).optional(),
});
export const frameSchema = z.object({
  cells: z.record(z.string(), cellStateSchema),
  entities: z.record(z.string(), pointSchema.extend({ facing: z.enum(["down", "left", "right", "up"]).default("down") })),
  path: z.array(pointSchema),
  centroids: z.array(pointSchema),
  metrics: z.record(z.string(), z.number().finite()),
  note: z.string(),
});
export const eventSchema = z.discriminatedUnion("kind", [
  pointSchema.extend({ kind: z.literal("cell"), state: cellStateSchema }),
  pointSchema.extend({
    kind: z.literal("entity"),
    id: z.string(),
    facing: z.enum(["down", "left", "right", "up"]),
  }),
  z.object({ kind: z.literal("path"), points: z.array(pointSchema) }),
  z.object({ kind: z.literal("centroids"), points: z.array(pointSchema) }),
  z.object({ kind: z.literal("metric"), id: z.string(), value: z.number().finite() }),
  z.object({ kind: z.literal("note"), text: z.string() }),
]);
export const resultSchema = z.object({
  passed: z.boolean(),
  tier: z.enum(["efficient", "passed", "failed"]),
  reason: z.string(),
  metrics: z.record(z.string(), z.number().finite()),
});
export const traceSchema = z.object({
  schemaVersion: z.literal(1),
  levelId: z.string(),
  optionId: z.string(),
  initial: frameSchema,
  steps: z.array(z.object({ events: z.array(eventSchema).min(1) })).min(1),
  result: resultSchema,
});

export type Point = z.infer<typeof pointSchema>;
export type LevelDefinition = z.infer<typeof levelSchema>;
export type SectionDefinition = z.infer<typeof sectionSchema>;
export type BoardState = z.infer<typeof frameSchema>;
export type TraceEvent = z.infer<typeof eventSchema>;
export type ReplayTrace = z.infer<typeof traceSchema>;
export type AttemptResult = z.infer<typeof resultSchema>;
export type AlgorithmOption = z.infer<typeof optionSchema>;
export type MechanicId = LevelDefinition["mechanic"];

export function validateTrace(level: LevelDefinition, input: unknown): ReplayTrace {
  const trace = traceSchema.parse(input);
  if (trace.levelId !== level.id || !level.options.some((o) => o.id === trace.optionId)) throw new Error("Rekaman tidak sesuai dengan level atau pilihan.");
  const inBounds = (p: Point) => p.x < level.board.width && p.y < level.board.height;
  const entities = new Set(Object.keys(trace.initial.entities));
  const metricIds = new Set(level.metrics.map((m) => m.id));
  const points = [...Object.values(trace.initial.entities), ...trace.initial.path, ...trace.initial.centroids];
  for (const key of Object.keys(trace.initial.cells)) {
    const [x, y] = key.split(",").map(Number);
    points.push({ x, y });
  }
  for (const step of trace.steps)
    for (const event of step.events) {
      if (event.kind === "entity") {
        if (!entities.has(event.id)) throw new Error(`Entitas tidak dikenal: ${event.id}`);
        points.push(event);
      }
      if (event.kind === "cell") points.push(event);
      if (event.kind === "path" || event.kind === "centroids") points.push(...event.points);
      if (event.kind === "metric" && !metricIds.has(event.id)) throw new Error(`Metrik tidak dikenal: ${event.id}`);
    }
  if (points.some((p) => !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || !inBounds(p))) throw new Error("Rekaman memiliki koordinat di luar papan.");
  if (trace.result.passed === (trace.result.tier === "failed")) throw new Error("Status hasil dan tier tidak konsisten.");
  const finalMetrics = { ...trace.initial.metrics };
  for (const step of trace.steps) for (const event of step.events) if (event.kind === "metric") finalMetrics[event.id] = event.value;
  for (const m of level.metrics) {
    if (!(m.id in trace.initial.metrics) || !(m.id in trace.result.metrics) || finalMetrics[m.id] !== trace.result.metrics[m.id])
      throw new Error(`Nilai akhir metrik ${m.id} tidak konsisten.`);
    const value = trace.result.metrics[m.id];
    if (trace.result.passed && m.required && m.limit !== undefined && (m.goal === "lower" ? value > m.limit : m.goal === "higher" ? value < m.limit : value !== m.limit))
      throw new Error(`Hasil lulus melampaui batas wajib ${m.id}.`);
  }
  return trace;
}
