import { describe, expect, it } from "vitest";
import { algorithms, defaultConfig, unavailableReason } from "../game/algorithms";
import { MatchEngine, matchResult } from "../game/engine";
import { levels, sections } from "../game/provider";
import { SimulationController } from "../game/simulation";
import { SEARCH_OPERATIONS_PER_TICK } from "../game/search";
import { isWalkable } from "../game/schema";
import { fixture, LocalWorker } from "./fixtures";
describe("new live campaign", () => {
  it("contains seven replacement games, 49 levels and ten algorithms", () => {
    expect(levels).toHaveLength(49);
    expect(sections).toHaveLength(7);
    expect(new Set(algorithms.map((a) => a.id)).size).toBe(10);
    expect(levels.every((l) => l.schemaVersion === 4 && l.rulesVersion === 4)).toBe(true);
  });
  for (const level of levels)
    it(`${level.id} completes legally and deterministically`, () => {
      const run = () => {
        const e = new MatchEngine(level, defaultConfig(level.seed));
        let f = e.snapshot();
        expect(f.bots.every((b) => b.expanded === 0)).toBe(true);
        while (f.phase !== "finished") {
          const previous = f;
          f = e.step();
          expect(f.tick).toBeLessThanOrEqual(1200);
          for (const [i, b] of f.bots.entries()) {
            expect(b.computeOps - previous.bots[i].computeOps).toBeLessThanOrEqual(SEARCH_OPERATIONS_PER_TICK);
            expect(b.energy).toBeGreaterThanOrEqual(0);
            expect(b.inventory).toBeLessThanOrEqual(3);
            if (b.eliminatedTick === null) expect(isWalkable(f.terrain[b.y * level.board.width + b.x])).toBe(true);
          }
          if (f.modeState.mode === "crates") expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(f.modeState.boxes.filter((b) => b.owner).length);
          if (f.modeState.mode === "energy") expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(f.modeState.owners.filter(Boolean).length * 3);
          if (f.modeState.mode === "energy")
            for (const e of f.modeState.events) if (e.kind === "claim") expect(f.bots.find((b) => b.id === e.botId)!.energy).toBeGreaterThanOrEqual(9);
        }
        expect(e.step()).toEqual(f);
        expect(f.winners.length).toBeGreaterThan(0);
        return f;
      };
      expect(run()).toEqual(run());
    });
  it("validates unique participants and mode capabilities", () => {
    expect(() => new MatchEngine(fixture(), { player: "astar", opponents: ["astar"], seed: 1 })).toThrow();
    expect(
      unavailableReason(
        "bidirectional",
        levels.find((l) => l.mode === "crates")!
      )
    ).toBeTruthy();
    expect(unavailableReason("bidirectional", fixture())).toBeNull();
  });
  for (const mode of sections.map((s) => s.id))
    it(`${mode} remains reproducible with stochastic and incremental bots`, () => {
      const l = levels.find((l) => l.mode === mode)!;
      const run = () => {
        const e = new MatchEngine(l, { player: "mcts", opponents: ["random", "dstar-lite"], seed: l.seed });
        let f = e.snapshot();
        while (f.phase !== "finished") f = e.step();
        return f;
      };
      expect(run()).toEqual(run());
    });
});
describe("worker playback", () => {
  it("does not create a worker before Play and keeps manual steps exact", () => {
    const ports: LocalWorker[] = [];
    const c = new SimulationController(fixture(), () => {
      const p = new LocalWorker();
      ports.push(p);
      return p;
    });
    expect(ports).toHaveLength(0);
    c.play();
    expect(ports).toHaveLength(1);
    c.pause();
    const tick = c.getSnapshot().frame.tick;
    c.tick(1000);
    expect(c.getSnapshot().frame.tick).toBe(tick);
    c.step(1);
    expect(c.getSnapshot().frame.tick).toBe(tick + 1);
    c.step(-1);
    expect(c.getSnapshot().frame.tick).toBe(tick);
    c.dispose();
    expect(ports[0].terminated).toBe(true);
  });
  it("discards previous workers and late frames after reconfiguration", () => {
    const ports: LocalWorker[] = [];
    const c = new SimulationController(fixture(), () => {
      const p = new LocalWorker();
      ports.push(p);
      return p;
    });
    c.play();
    const old = ports[0];
    old.deferred = true;
    c.tick(100);
    c.configure({ player: "dijkstra", opponents: ["random"], seed: 9 });
    old.flush();
    expect(c.getSnapshot().phase).toBe("ready");
    expect(c.getSnapshot().head).toBe(0);
    expect(c.getSnapshot().config.player).toBe("dijkstra");
    c.dispose();
  });
  it.each([0.5, 1, 2, 4])("reproduces exact results at %sx", (speed) => {
    const l = fixture(),
      c = new SimulationController(l, () => new LocalWorker());
    c.configure({ player: "dstar-lite", opponents: ["mcts", "random"], seed: 1 });
    c.setSpeed(speed);
    c.play();
    for (let i = 0; i < 6000 && c.getSnapshot().phase !== "finished"; i++) c.tick(100);
    expect(c.getSnapshot().phase).toBe("finished");
    const reference = new MatchEngine(l, { player: "dstar-lite", opponents: ["mcts", "random"], seed: 1 });
    let f = reference.snapshot();
    while (f.phase !== "finished") f = reference.step();
    expect(c.getSnapshot().frame).toEqual(f);
    expect(c.getSnapshot().result).toEqual(matchResult(f));
    c.dispose();
  });
});
