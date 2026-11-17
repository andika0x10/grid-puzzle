import { describe, expect, it } from "vitest";
import { authorLevels } from "../scripts/author-arenas";
import { layoutFingerprint, layoutSimilarity, objectivePoints, reachableCells, circuitReachable, weightedDistances } from "../scripts/level-checks";
import { levels } from "../game/provider";
import { advanceWorld, cellOf, resolveActions } from "../game/modes";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { ModeDomain } from "../game/planning";
import { createDomainSearch } from "../game/search";
describe("authored arenas", () => {
  it("reproduces the catalog and has no duplicate, rotated or mirrored floor plans", () => {
    expect(authorLevels()).toEqual(levels);
    expect(new Set(levels.map(layoutFingerprint)).size).toBe(91);
  });
  it("rejects resized lookalikes within a category and varies the starting regions", () => {
    for (const mode of new Set(levels.map((l) => l.mode))) {
      const maps = levels.filter((l) => l.mode === mode);
      for (const [i, a] of maps.entries()) for (const b of maps.slice(i + 1)) expect(layoutSimilarity(a, b), `${a.id}/${b.id}`).toBeLessThan(0.9);
      const starts = new Set(
        maps.map((l) => `${Math.min(2, Math.floor((l.board.spawn.x / l.board.width) * 3))}:${Math.min(2, Math.floor((l.board.spawn.y / l.board.height) * 3))}`)
      );
      expect(starts.size, mode).toBeGreaterThanOrEqual(3);
      expect(maps.every((l) => l.board.spawns?.length === 4)).toBe(true);
    }
  });
  for (const l of levels)
    it(`${l.id} has reachable objectives and valid dependencies`, () => {
      const seen = reachableCells(l);
      expect(objectivePoints(l).every((p) => seen.has(cellOf(p, l.board.width)))).toBe(true);
      expect(circuitReachable(l)).toBe(true);
      if (l.mode === "energy") {
        const ds = l.energy.chargers.map((p) => weightedDistances(l, cellOf(p, l.board.width)));
        for (const p of l.energy.beacons) expect(Math.min(...ds.map((d) => d[cellOf(p, l.board.width)])) * 2 + 5).toBeLessThanOrEqual(24);
      }
    });
  for (const l of levels.filter((l) => l.mode === "crates"))
    it(`${l.id} has a constructive solution with legal live pushes`, () => {
      const w = previewFrame(l, defaultConfig(l.seed));
      w.bots = [w.bots[0]];
      const failed = new Set<string>();
      for (let turn = 0; turn < 40 && w.modeState.mode === "crates" && !w.modeState.boxes.every((b) => b.owner); turn++) {
        const d = new ModeDomain(l, w, w.bots[0], new Map(), failed),
          s = createDomainSearch(d, "astar", l.board.width);
        while (!s.done && s.operations < 100000) s.advance(64);
        expect(s.done).toBe(true);
        if (!s.actions) {
          failed.add(d.target.id);
          continue;
        }
        for (const action of s.actions) {
          for (let t = 0; t < action.duration; t++) advanceWorld(l, w, w.tick + 1);
          expect(resolveActions(l, w, [{ botId: w.bots[0].id, action }], l.seed).has(w.bots[0].id)).toBe(true);
        }
        failed.clear();
      }
      expect(w.modeState.mode === "crates" && w.modeState.boxes.every((b) => b.owner)).toBe(true);
    });
});
