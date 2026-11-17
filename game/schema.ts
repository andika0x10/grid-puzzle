import { z } from "zod";
import { themeIds } from "./themes";
export const terrainIds = ["ground", "path", "slow", "water", "wall", "bridge-h", "bridge-v"] as const;
export type Terrain = (typeof terrainIds)[number];
export const pointSchema = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });
export type Point = z.infer<typeof pointSchema>;
export const gameModes = ["fog", "collapse", "hunt", "circuit", "energy", "bridge", "crates", "bomb", "snake", "flow", "portal", "tactical", "stealth"] as const;
export type GameMode = (typeof gameModes)[number];
export const isWalkable = (t: Terrain | undefined) => t !== undefined && t !== "wall" && t !== "water";
export const terrainCost = (t: Terrain) => (t === "slow" ? 4 : 1);
const boardSchema = z.object({
  width: z.number().int().min(5).max(32),
  height: z.number().int().min(5).max(32),
  terrain: z.array(z.enum(terrainIds)),
  spawn: pointSchema,
  spawns: z.array(pointSchema).length(4).optional(),
  goal: pointSchema.optional(),
  decorations: z.array(pointSchema).default([]),
});
const targetSchema = z.object({ route: z.array(pointSchema).min(2), stepTicks: z.number().int().min(5).max(20).default(8) });
const switchSchema = pointSchema.extend({ gates: z.array(pointSchema).default([]) });
const contractSchema = pointSchema.extend({ mask: z.number().int().nonnegative() });
const spanSchema = z.object({ banks: z.tuple([pointSchema, pointSchema]), cells: z.array(pointSchema).min(1).max(3) });
const common = {
  schemaVersion: z.union([z.literal(4), z.literal(5)]),
  rulesVersion: z.number().int().min(4).max(5).default(5),
  id: z.string().regex(/^[a-z0-9-]+$/),
  sectionId: z.string(),
  order: z.number().int().min(1).max(7),
  title: z.string().min(1),
  mission: z.string().min(1),
  briefing: z.string().min(1),
  theme: z.enum(themeIds),
  seed: z.number().int(),
  timeLimit: z.number().int().min(1).max(1200).default(1200),
  board: boardSchema,
};
export const levelSchema = z
  .discriminatedUnion("mode", [
    z.object({ ...common, mode: z.literal("fog"), fog: z.object({ radius: z.literal(2).default(2) }) }),
    z.object({
      ...common,
      mode: z.literal("collapse"),
      collapse: z.object({
        graceTicks: z.literal(160).default(160),
        trailTicks: z.literal(24).default(24),
        waves: z.array(z.object({ tick: z.number().int().positive(), cells: z.array(pointSchema).min(1) })).min(1),
      }),
    }),
    z.object({ ...common, mode: z.literal("hunt"), hunt: z.object({ targets: z.array(targetSchema).min(1).max(3), respawnTicks: z.literal(20).default(20) }) }),
    z.object({
      ...common,
      mode: z.literal("circuit"),
      circuit: z.object({ switches: z.array(switchSchema).min(1).max(4), contracts: z.array(contractSchema).min(1), initialMask: z.number().int().nonnegative().default(0) }),
    }),
    z.object({
      ...common,
      mode: z.literal("energy"),
      energy: z.object({ capacity: z.literal(24).default(24), chargers: z.array(pointSchema).min(1), beacons: z.array(pointSchema).min(1) }),
    }),
    z.object({
      ...common,
      mode: z.literal("bridge"),
      bridge: z.object({ spans: z.array(spanSchema).min(1).max(5), supplies: z.array(pointSchema).min(1).max(3), markers: z.array(pointSchema).min(1) }),
    }),
    z.object({ ...common, mode: z.literal("crates"), crates: z.object({ boxes: z.array(pointSchema).min(1).max(3), docks: z.array(pointSchema).min(1).max(3) }) }),
    z.object({
      ...common,
      mode: z.literal("bomb"),
      bomb: z.object({ destructible: z.array(pointSchema).min(1), gems: z.array(pointSchema).min(1), fuseTicks: z.number().int().min(24).default(36) }),
    }),
    z.object({ ...common, mode: z.literal("snake"), snake: z.object({ fruit: z.array(pointSchema).min(2), initialLength: z.number().int().min(2).max(6).default(3) }) }),
    z.object({
      ...common,
      mode: z.literal("flow"),
      flow: z.object({
        currents: z.array(pointSchema.extend({ dx: z.number().int().min(-1).max(1), dy: z.number().int().min(-1).max(1), distance: z.number().int().min(1).max(3) })).min(1),
        ice: z.array(pointSchema),
        tokens: z.array(pointSchema).min(2),
      }),
    }),
    z.object({ ...common, mode: z.literal("portal"), portal: z.object({ pads: z.array(pointSchema).min(4).max(8), tokens: z.array(pointSchema).min(2) }) }),
    z.object({ ...common, mode: z.literal("tactical"), tactical: z.object({ tokens: z.array(pointSchema).min(2), wallTicks: z.number().int().min(40).default(100) }) }),
    z.object({
      ...common,
      mode: z.literal("stealth"),
      stealth: z.object({
        guards: z.array(z.object({ route: z.array(pointSchema).min(2), stepTicks: z.number().int().min(8), range: z.number().int().min(2).max(5) })).min(1),
        bushes: z.array(pointSchema).min(1),
        intel: z.array(pointSchema).min(2),
      }),
    }),
  ])
  .superRefine((l, ctx) => {
    const b = l.board,
      points: Point[] = [b.spawn, ...(b.spawns ?? []), ...(b.goal ? [b.goal] : []), ...b.decorations];
    const objects: Point[] = [];
    if (l.mode === "fog" || l.mode === "bridge") if (!b.goal) ctx.addIssue({ code: "custom", message: "Arena membutuhkan pintu keluar." });
    if (l.mode === "collapse") {
      for (const [i, w] of l.collapse.waves.entries()) {
        points.push(...w.cells);
        if (w.tick > l.timeLimit || (i && w.tick <= l.collapse.waves[i - 1].tick)) ctx.addIssue({ code: "custom", message: "Gelombang harus berurutan dalam batas pertandingan." });
      }
    }
    if (l.mode === "hunt")
      for (const t of l.hunt.targets) {
        objects.push(...t.route);
        if (
          t.route.some((p, i) => {
            const q = t.route[(i + 1) % t.route.length];
            return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1;
          })
        )
          ctx.addIssue({ code: "custom", message: "Lintasan target harus bersebelahan dan melingkar." });
      }
    if (l.mode === "circuit") {
      objects.push(...l.circuit.switches, ...l.circuit.contracts);
      points.push(...l.circuit.switches.flatMap((s) => s.gates));
      if ([l.circuit.initialMask, ...l.circuit.contracts.map((c) => c.mask)].some((m) => m >= 1 << l.circuit.switches.length))
        ctx.addIssue({ code: "custom", message: "Konfigurasi sirkuit tidak valid." });
    }
    if (l.mode === "energy") objects.push(...l.energy.chargers, ...l.energy.beacons);
    if (l.mode === "bridge") {
      objects.push(...l.bridge.supplies, ...l.bridge.markers, ...l.bridge.spans.flatMap((s) => s.banks));
      for (const s of l.bridge.spans) {
        points.push(...s.cells);
        const chain = [s.banks[0], ...s.cells, s.banks[1]];
        if (
          chain.some((p, i) => i > 0 && Math.abs(p.x - chain[i - 1].x) + Math.abs(p.y - chain[i - 1].y) !== 1) ||
          (new Set(chain.map((p) => p.x)).size !== 1 && new Set(chain.map((p) => p.y)).size !== 1)
        )
          ctx.addIssue({ code: "custom", message: "Bentang jembatan harus lurus dan tersambung ke kedua tepi." });
        if (s.cells.some((p) => b.terrain[p.y * b.width + p.x] !== "water")) ctx.addIssue({ code: "custom", message: "Jembatan harus melintasi celah." });
      }
    }
    if (l.mode === "crates") {
      objects.push(...l.crates.boxes, ...l.crates.docks);
      if (l.crates.boxes.length !== l.crates.docks.length) ctx.addIssue({ code: "custom", message: "Jumlah peti dan tujuan harus sama." });
      for (const group of [l.crates.boxes, l.crates.docks])
        if (new Set(group.map((p) => `${p.x},${p.y}`)).size !== group.length) ctx.addIssue({ code: "custom", message: "Objek harus unik." });
      if (l.crates.boxes.some((p) => [b.spawn, ...l.crates.docks].some((q) => q.x === p.x && q.y === p.y)))
        ctx.addIssue({ code: "custom", message: "Peti awal tidak boleh menutupi spawn atau tujuan." });
    }
    if (l.mode === "bomb") {
      objects.push(...l.bomb.gems);
      points.push(...l.bomb.destructible);
    }
    if (l.mode === "snake") objects.push(...l.snake.fruit);
    if (l.mode === "flow") {
      objects.push(...l.flow.currents, ...l.flow.ice, ...l.flow.tokens);
      if (l.flow.currents.some((p) => Math.abs(p.dx) + Math.abs(p.dy) !== 1)) ctx.addIssue({ code: "custom", message: "Arus harus mengarah ke satu sisi." });
    }
    if (l.mode === "portal") {
      objects.push(...l.portal.pads, ...l.portal.tokens);
      if (new Set(l.portal.pads.map((p) => `${p.x},${p.y}`)).size !== l.portal.pads.length) ctx.addIssue({ code: "custom", message: "Portal harus unik." });
    }
    if (l.mode === "tactical") objects.push(...l.tactical.tokens);
    if (l.mode === "stealth") {
      objects.push(...l.stealth.bushes, ...l.stealth.intel);
      for (const g of l.stealth.guards) {
        objects.push(...g.route);
        if (
          g.route.some((p, i) => {
            const q = g.route[(i + 1) % g.route.length];
            return Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1;
          })
        )
          ctx.addIssue({ code: "custom", message: "Patroli harus tersambung dan melingkar." });
      }
    }
    points.push(...objects);
    if (b.terrain.length !== b.width * b.height) ctx.addIssue({ code: "custom", message: "Ukuran terrain tidak sesuai papan." });
    if (points.some((p) => p.x >= b.width || p.y >= b.height)) ctx.addIssue({ code: "custom", message: "Koordinat di luar papan." });
    if ([b.spawn, ...(b.spawns ?? []), ...(b.goal ? [b.goal] : []), ...objects].some((p) => !isWalkable(b.terrain[p.y * b.width + p.x])))
      ctx.addIssue({ code: "custom", message: "Objek harus berada di petak yang bisa diinjak." });
  });
export type LevelDefinition = z.infer<typeof levelSchema>;
export const sectionSchema = z.object({
  id: z.enum(gameModes),
  order: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string(),
  levelIds: z.array(z.string()).length(7),
});
export type SectionDefinition = z.infer<typeof sectionSchema>;
