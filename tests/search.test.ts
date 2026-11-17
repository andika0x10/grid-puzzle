import { describe, expect, it } from "vitest";
import { createSearch, createDomainSearch } from "../game/search";
import { ModeDomain } from "../game/planning";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { adjacent, cellOf, pointOf } from "../game/modes";
import { getLevel } from "../game/provider";
import { isWalkable, terrainCost, type Terrain } from "../game/schema";
import { randomSource } from "../game/decisions";
function oracle(width: number, height: number, terrain: Terrain[], start: number, goal: number) {
  const dist = Array<number>(terrain.length).fill(Infinity),
    pending = new Set<number>([start]);
  dist[start] = 0;
  while (pending.size) {
    let u = -1;
    for (const c of pending) if (u < 0 || dist[c] < dist[u]) u = c;
    pending.delete(u);
    if (u === goal) return dist[u];
    for (const v of adjacent(u, width, height))
      if (isWalkable(terrain[v]) && isWalkable(terrain[u]) && dist[u] + terrainCost(terrain[v]) * 4 < dist[v]) {
        dist[v] = dist[u] + terrainCost(terrain[v]) * 4;
        pending.add(v);
      }
  }
  return null;
}
const finish = (s: ReturnType<typeof createSearch>, budget = 64) => {
  while (!s.done && s.operations < 500000) s.advance(budget);
  expect(s.done).toBe(true);
  return s.actions?.reduce((n, a) => n + a.duration, 0) ?? null;
};
describe("search correctness and scheduling", () => {
  it("Dijkstra and D* Lite agree with an independent weighted oracle", () => {
    const random = randomSource(72);
    for (let sample = 0; sample < 35; sample++) {
      const terrain: Terrain[] = Array.from({ length: 63 }, () => (random() < 0.18 ? "wall" : random() < 0.3 ? "slow" : "ground"));
      terrain[0] = terrain[62] = "ground";
      const expected = oracle(9, 7, terrain, 0, 62);
      for (const id of ["astar", "dijkstra", "dstar-lite"] as const)
        expect(finish(createSearch(9, 7, terrain, { x: 0, y: 0 }, { x: 8, y: 6 }, id)), `${id} map ${sample}`).toBe(expected);
    }
  });
  it("budgets change batching without changing the result or operation count", () => {
    const terrain: Terrain[] = Array(63).fill("ground");
    terrain[12] = "slow";
    for (const id of ["astar", "weighted-astar", "greedy", "dfs", "bfs", "dijkstra", "dstar-lite"] as const) {
      const runs = [1, 7, 64, 256].map((budget) => {
        const s = createSearch(9, 7, terrain, { x: 0, y: 0 }, { x: 8, y: 6 }, id);
        expect(s.advance(0)).toBe(0);
        while (!s.done) {
          const old = s.operations;
          expect(s.advance(budget)).toBeLessThanOrEqual(budget);
          expect(s.operations - old).toBeLessThanOrEqual(budget);
        }
        expect(s.advance(budget)).toBe(0);
        return { actions: s.actions, ops: s.operations };
      });
      for (const r of runs) expect(r).toEqual(runs[0]);
    }
  });
  it("bidirectional BFS agrees with BFS on uniform graphs", () => {
    const random = randomSource(91);
    for (let i = 0; i < 20; i++) {
      const terrain: Terrain[] = Array.from({ length: 63 }, () => (random() < 0.2 ? "wall" : "ground"));
      terrain[0] = terrain[62] = "ground";
      expect(finish(createSearch(9, 7, terrain, { x: 0, y: 0 }, { x: 8, y: 6 }, "bidirectional"))).toBe(finish(createSearch(9, 7, terrain, { x: 0, y: 0 }, { x: 8, y: 6 }, "bfs")));
    }
  });
  it("repairs D* Lite after changes during suspended queue work", () => {
    const l = getLevel("fog-1")!,
      w = previewFrame(l, defaultConfig(1));
    w.bots[0].known = [...w.terrain];
    const first = new ModeDomain(l, w, w.bots[0]);
    for (const budget of [1, 3, 8, 32, 90]) {
      const s = createDomainSearch(first, "dstar-lite", l.board.width);
      s.advance(budget);
      const changed = structuredClone(w),
        c = cellOf({ x: 3, y: 1 }, l.board.width);
      changed.terrain[c] = "wall";
      changed.bots[0].known[c] = "wall";
      const d = new ModeDomain(l, changed, changed.bots[0]);
      s.updateDomain!(d, new Set([c]));
      const expected = finish(createDomainSearch(d, "dijkstra", l.board.width));
      expect(finish(s)).toBe(expected);
      expect(s.path?.some((p) => cellOf(p, l.board.width) === c)).toBe(false);
    }
  });
  it("reuses settled D* state when the start advances without a terrain scan", () => {
    const l = getLevel("fog-1")!,
      w = previewFrame(l, defaultConfig(1));
    w.bots[0].known = [...w.terrain];
    const d = new ModeDomain(l, w, w.bots[0]),
      s = createDomainSearch(d, "dstar-lite", l.board.width);
    finish(s);
    const old = s.operations,
      expanded = s.expanded;
    const next = s.actions![0].to,
      p = pointOf(next, l.board.width);
    Object.assign(w.bots[0], p);
    s.updateDomain!(new ModeDomain(l, w, w.bots[0]), new Set());
    finish(s);
    expect(s.expanded).toBe(expanded);
    expect(s.operations - old).toBeLessThan(old);
    expect(s.path?.[0]).toEqual(p);
  });
  it("reserves enough energy for the validated return to a station", () => {
    const l = getLevel("energy-3")!,
      w = previewFrame(l, defaultConfig(1)),
      d = new ModeDomain(l, w, w.bots[0]);
    const s = createDomainSearch(d, "dijkstra", l.board.width);
    finish(s);
    expect(s.actions!.some((a) => a.kind === "claim")).toBe(true);
    const spent = s.actions!.filter((a) => a.kind === "move").reduce((sum, a) => sum + a.duration / 4, 0);
    expect(w.bots[0].energy - spent - 5).toBeGreaterThanOrEqual(9);
  });
});
