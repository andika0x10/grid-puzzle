import { describe, expect, it } from "vitest";
import { levels, sections } from "../game/provider";
import { algorithms, defaultConfig, unavailableReason } from "../game/algorithms";
import { MatchEngine, matchResult } from "../game/engine";
import { createSearch, SEARCH_OPERATIONS_PER_TICK } from "../game/search";
import { isWalkable, levelSchema, terrainCost } from "../game/schema";
import { SimulationController } from "../game/simulation";
import { emptyProgress, isLevelUnlocked, readProgress, recordMatch, STORAGE_KEY } from "../game/progress";
import { themeIds } from "../game/themes";
import { fixture, LocalWorker } from "./fixtures";

describe("live level simulation", () => {
  it("stores 49 initial boards, 7 worlds per category, without precomputed results", () => {
    expect(levels).toHaveLength(49);
    for (const section of sections) expect(new Set(levels.filter((l) => l.sectionId === section.id).map((l) => l.theme))).toEqual(new Set(themeIds));
    for (const l of levels) {
      expect(l).not.toHaveProperty("traceRefs");
      expect(l).not.toHaveProperty("options");
      expect(l).not.toHaveProperty("result");
    }
  });
  for (const level of levels)
    it(`${level.id}: finishes from initial data, deterministically`, () => {
      const run = () => {
        const e = new MatchEngine(level, defaultConfig(level.seed));
        let f = e.snapshot();
        expect(f.tick).toBe(0);
        expect(f.bots.every((b) => b.expanded === 0)).toBe(true);
        while (f.phase !== "finished") {
          const previous = f;
          f = e.step();
          expect(f.tick).toBeLessThanOrEqual(level.timeLimit);
          for (const [i, b] of f.bots.entries()) {
            expect(isWalkable(f.terrain[b.y * level.board.width + b.x])).toBe(true);
            expect(b.computeOps - previous.bots[i].computeOps).toBeLessThanOrEqual(SEARCH_OPERATIONS_PER_TICK);
          }
          if (level.mode === "gems") expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(f.gems.reduce((n, g) => n + (g.awardedPoints ?? 0), 0));
          if (level.mode === "cargo") {
            expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(f.modeState.parcels.filter((p) => p.state === "delivered").length);
            expect(f.bots.reduce((sum, b) => sum + b.inventory, 0)).toBe(f.modeState.parcels.filter((p) => p.state === "carried").length);
          }
          if (level.mode === "territory") expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(f.modeState.territory.filter(Boolean).length);
          for (const gem of f.gems.filter((g) => g.taken)) {
            expect(f.bots.some((b) => b.id === gem.claimedBy)).toBe(true);
            expect(gem.claimedTick).toBeLessThanOrEqual(f.tick);
          }
        }
        return f;
      };
      expect(run()).toEqual(run());
    });
  it("counts computation plus movement and stops at the first winning tick", () => {
    const level = fixture(),
      e = new MatchEngine(level, { player: "astar", opponents: ["greedy"], seed: 1 });
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.winners).toEqual(["bot-1"]);
    expect(f.bots[0].status).toBe("stopped");
    expect(f.bots[0].finishTick).toBeNull();
    for (const b of f.bots.filter((b) => b.finishTick !== null)) {
      expect(b.finishTick).toBe(b.searchTicks + b.moveTicks);
      expect(b.finishTick).toBe(f.tick);
      expect(b.cost).toBe(4);
      expect(b.moveTicks).toBe(16);
    }
    expect(e.step()).toEqual(f);
  });
  it("resolves every participant before awarding a simultaneous finish", () => {
    const base = fixture();
    const e = new MatchEngine(fixture({ board: { ...base.board, goal: base.board.spawn } }), { player: "astar", opponents: ["greedy", "weighted-astar"], seed: 1 });
    const f = e.step();
    expect(f.phase).toBe("finished");
    expect(f.winners).toEqual(["bot-0", "bot-1", "bot-2"]);
    expect(f.bots.every((b) => b.finishTick === 1)).toBe(true);
  });
  it("awards a simultaneous gem to one owner independently of player slot", () => {
    const base = fixture(),
      level = fixture({ mode: "gems", board: { ...base.board, goal: undefined, gems: [base.board.spawn] } });
    const owners = new Set<string>();
    for (let seed = 1; seed <= 32; seed++) {
      const run = (player: "astar" | "greedy", opponent: "astar" | "greedy") => {
        const e = new MatchEngine(level, { player, opponents: [opponent], seed });
        const f = e.step();
        expect(f.bots.reduce((sum, b) => sum + b.score, 0)).toBe(1);
        expect(f.gems[0].claimedTick).toBe(1);
        expect(f.winners).toEqual([f.gems[0].claimedBy]);
        expect(e.step()).toEqual(f);
        return f.bots.find((b) => b.id === f.gems[0].claimedBy)!.algorithm;
      };
      const owner = run("astar", "greedy");
      expect(run("greedy", "astar")).toBe(owner);
      owners.add(owner);
    }
    expect(owners.size).toBe(2);
  });
  it("charges fresh computation when a rival takes the current target", () => {
    const base = fixture();
    const e = new MatchEngine(
      fixture({
        mode: "gems",
        board: {
          ...base.board,
          goal: undefined,
          gems: [
            { x: 4, y: 1 },
            { x: 4, y: 0 },
          ],
        },
      }),
      { player: "astar", opponents: ["greedy"], seed: 1 }
    );
    let f = e.snapshot();
    while (!f.gems[0].taken) f = e.step();
    expect(f.bots[0].score).toBe(0);
    expect(f.bots[0].status).toBe("searching");
    expect(f.bots[0].route).toEqual([]);
    const replanned = e.step();
    expect(replanned.bots[0].computeOps).toBeGreaterThan(f.bots[0].computeOps);
    expect(replanned.bots[0].searchTicks).toBe(f.bots[0].searchTicks + 1);
  });
  it("reports unreachable targets and stops at a configured limit", () => {
    const base = fixture(),
      terrain = [...base.board.terrain];
    for (let y = 0; y < 3; y++) terrain[y * 5 + 2] = "wall";
    const e = new MatchEngine(fixture({ board: { ...base.board, terrain } }), { player: "astar", opponents: ["dfs"], seed: 1 });
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.winners).toEqual([]);
    expect(f.bots.every((b) => b.status === "unreachable")).toBe(true);
    const timed = new MatchEngine(fixture({ timeLimit: 1 }), { player: "astar", opponents: ["dfs"], seed: 1 });
    expect(timed.step().bots.every((b) => b.status === "timeout")).toBe(true);
    const noGems = new MatchEngine(fixture({ mode: "gems", timeLimit: 1, board: { ...base.board, goal: undefined, gems: [{ x: 4, y: 1 }] } }), {
      player: "astar",
      opponents: ["greedy"],
      seed: 1,
    });
    expect(noGems.step().winners).toEqual([]);
  });
  it("defers closing occupied cells and replans when the shared map changes", () => {
    const base = fixture(),
      e = new MatchEngine(fixture({ changes: [{ tick: 1, x: 0, y: 1, terrain: "wall" }] }), { player: "astar", opponents: ["greedy"], seed: 1 });
    expect(e.step().terrain[5]).toBe(base.board.terrain[5]);
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.terrain[5]).toBe("wall");
    expect(f.winners).toHaveLength(1);
    expect(f.bots.some((b) => b.finishTick !== null)).toBe(true);
  });
  it("rejects duplicate participants, unsupported terrain, and invalid boards", () => {
    expect(() => new MatchEngine(fixture(), { player: "astar", opponents: ["astar"], seed: 1 })).toThrow();
    expect(() => levelSchema.parse({ ...fixture(), board: { ...fixture().board, terrain: [] } })).toThrow();
    expect(
      unavailableReason(
        "bidirectional",
        levels.find((l) => l.board.terrain.includes("slow"))!
      )
    ).toBeTruthy();
  });
});
describe("incremental algorithms", () => {
  it("limits work to the supplied budget and preserves results across budget sizes", () => {
    const level = fixture();
    for (const algorithm of algorithms.filter((a) => a.id !== "random" && a.id !== "mcts")) {
      const runs = [1, 7, 16, 64].map((budget) => {
        const s = createSearch(5, 3, level.board.terrain, level.board.spawn, level.board.goal!, algorithm.id);
        expect(s.advance(0)).toBe(0);
        expect(s.operations).toBe(0);
        while (!s.done) {
          const before = s.operations;
          expect(s.advance(budget)).toBeLessThanOrEqual(budget);
          expect(s.operations - before).toBeLessThanOrEqual(budget);
        }
        expect(s.advance(budget)).toBe(0);
        return { path: s.path, operations: s.operations, expanded: s.expanded };
      });
      runs.forEach((run) => expect(run).toEqual(runs[0]));
    }
  });
  it("A* avoids an expensive direct route while Greedy takes the gamble", () => {
    const level = fixture(),
      terrain = [...level.board.terrain];
    terrain[6] = "slow";
    terrain[7] = "slow";
    terrain[8] = "slow";
    const run = (id: "astar" | "greedy") => {
      const s = createSearch(5, 3, terrain, level.board.spawn, level.board.goal!, id);
      while (!s.done) s.step();
      return s.path!.slice(1).reduce((cost, p) => cost + terrainCost(terrain[p.y * 5 + p.x]), 0);
    };
    expect(run("astar")).toBe(6);
    expect(run("greedy")).toBe(13);
  });
  it("bidirectional search agrees with A* on unweighted maps, including blocked goals", () => {
    let seed = 71;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let map = 0; map < 80; map++) {
      const terrain = Array.from({ length: 99 }, () => (random() < 0.25 ? ("wall" as const) : ("ground" as const)));
      terrain[0] = "ground";
      terrain[98] = "ground";
      const lengths = ["astar", "bidirectional"].map((id) => {
        const s = createSearch(11, 9, terrain, { x: 0, y: 0 }, { x: 10, y: 8 }, id as "astar" | "bidirectional");
        for (let i = 0; i < 500 && !s.done; i++) s.step();
        expect(s.done).toBe(true);
        return s.path?.length ?? null;
      });
      expect(lengths[0]).toBe(lengths[1]);
    }
  });
  it("preserves competitive scenarios for the five original algorithms", () => {
    for (const algorithm of algorithms.slice(0, 5)) {
      const wins = levels.some((level) => {
        if (unavailableReason(algorithm.id, level)) return false;
        const opponents = algorithms
          .filter((a) => a.id !== algorithm.id && !unavailableReason(a.id, level))
          .slice(0, 3)
          .map((a) => a.id);
        const e = new MatchEngine(level, { player: algorithm.id, opponents, seed: level.seed });
        let f = e.snapshot();
        while (f.phase !== "finished") f = e.step();
        return f.winners.length === 1 && f.winners[0] === "bot-0";
      });
      expect(wins, `${algorithm.name} needs a competitive scenario`).toBe(true);
    }
  });
});
describe("simulation control", () => {
  it("configures a ready preview, clears history and ignores responses from the previous worker", () => {
    const ports: LocalWorker[] = [];
    const level = fixture();
    const controller = new SimulationController(level, () => {
      const port = new LocalWorker();
      ports.push(port);
      return port;
    });
    controller.play();
    controller.tick(100);
    expect(controller.getSnapshot().head).toBeGreaterThan(0);
    ports[0].deferred = true;
    controller.tick(100);
    const config = { player: "dfs" as const, opponents: ["greedy" as const], seed: level.seed };
    controller.configure(config);
    expect(ports[0].terminated).toBe(true);
    const ready = controller.getSnapshot();
    expect(ready).toMatchObject({ phase: "ready", cursor: 0, head: 0, config, result: null, error: null });
    expect(ready.frame.bots.map((bot) => bot.algorithm)).toEqual(["dfs", "greedy"]);
    ports[0].flush();
    controller.tick(100);
    controller.step(1);
    expect(controller.getSnapshot()).toBe(ready);
    expect(ports).toHaveLength(1);
    controller.play();
    expect(ports).toHaveLength(2);
    expect(ports[1].engine!.config).toEqual(config);
    controller.dispose();
  });
  it("does no work before Play, freezes on Pause, steps live, and restarts cleanly", () => {
    const ports: LocalWorker[] = [],
      c = new SimulationController(fixture(), () => {
        const p = new LocalWorker();
        ports.push(p);
        return p;
      });
    c.tick(10000);
    expect(ports).toHaveLength(0);
    c.play();
    expect(ports).toHaveLength(1);
    expect(c.getSnapshot().frame.bots[0].expanded).toBe(0);
    c.tick(50);
    expect(c.getSnapshot().frame.tick).toBe(1);
    c.pause();
    c.tick(10000);
    expect(c.getSnapshot().frame.tick).toBe(1);
    c.step(1);
    expect(c.getSnapshot().frame.tick).toBe(2);
    expect(c.getSnapshot().phase).toBe("paused");
    c.seek(0);
    expect(c.getSnapshot().frame.tick).toBe(0);
    c.play();
    c.tick(100);
    expect(c.getSnapshot().frame.tick).toBe(2);
    c.start();
    expect(ports[0].terminated).toBe(true);
    expect(c.getSnapshot().frame.tick).toBe(0);
    c.dispose();
    expect(ports[1].terminated).toBe(true);
  });
  it("handles a response arriving after Pause without moving the history cursor", () => {
    const port = new LocalWorker(),
      c = new SimulationController(fixture(), () => port);
    c.play();
    port.deferred = true;
    c.tick(50);
    c.pause();
    port.flush();
    expect(c.getSnapshot().cursor).toBe(0);
    expect(c.getSnapshot().head).toBe(1);
    expect(c.getSnapshot().phase).toBe("paused");
    c.play();
    c.tick(50);
    expect(c.getSnapshot().cursor).toBe(1);
    c.dispose();
  });
  it("produces identical final frames at every playback speed in both modes", () => {
    const base = fixture();
    for (const level of [
      base,
      fixture({
        mode: "gems",
        board: {
          ...base.board,
          goal: undefined,
          gems: [
            { x: 4, y: 1 },
            { x: 3, y: 0 },
          ],
        },
      }),
    ]) {
      const results = [0.5, 1, 2, 4].map((speed) => {
        const c = new SimulationController(level, () => new LocalWorker());
        c.setSpeed(speed);
        c.play();
        for (let i = 0; i < 1000 && c.getSnapshot().phase !== "finished"; i++) c.tick(100);
        expect(c.getSnapshot().phase).toBe("finished");
        const result = { result: c.getSnapshot().result, frame: c.getSnapshot().frame };
        c.dispose();
        return result;
      });
      results.forEach((result) => expect(result).toEqual(results[0]));
    }
  });
  it("does not skip rewound history when an in-flight batch arrives", () => {
    const port = new LocalWorker(),
      c = new SimulationController(fixture(), () => port);
    c.play();
    c.tick(50);
    port.deferred = true;
    c.tick(100);
    c.pause();
    c.seek(0);
    c.play();
    port.flush();
    expect(c.getSnapshot().cursor).toBe(0);
    expect(c.getSnapshot().head).toBe(3);
    c.tick(50);
    expect(c.getSnapshot().cursor).toBe(1);
    c.dispose();
  });
});
describe("progress", () => {
  const summary = () => {
    const e = new MatchEngine(fixture(), { player: "astar", opponents: ["greedy"], seed: 1 });
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    return matchResult(f);
  };
  it("unlocks after a loss and does not erase progress saved by another tab", async () => {
    const data = new Map<string, string>(),
      store = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
      };
    await recordMatch("navigation-1", "race", { ...summary(), won: false }, store);
    expect(isLevelUnlocked("navigation-2", sections, readProgress(store))).toBe(true);
    await recordMatch("navigation-2", "race", summary(), store);
    await recordMatch("navigation-1", "race", summary(), store);
    expect(Object.keys(readProgress(store).levels)).toEqual(["navigation-1", "navigation-2"]);
    expect(readProgress(store).levels["navigation-1"].matches).toBe(2);
  });
  it("migrates navigation completion and ignores old clustering results", () => {
    const store = {
      getItem: (k: string) => (k === STORAGE_KEY ? null : JSON.stringify({ version: 1, levels: { "navigation-1": { passed: true }, "clustering-1": { passed: true } } })),
      setItem: () => {},
    };
    expect(Object.keys(readProgress(store).levels)).toEqual(["navigation-1"]);
    expect(readProgress({ getItem: () => "{bad", setItem: () => {} })).toEqual(emptyProgress());
  });
  it("keeps unlocked levels and match history while starting records for the new rules", () => {
    const old = {
      version: 2,
      levels: {
        "navigation-1": { completed: true, matches: 4, wins: 2, bestTicks: 10, bestGems: 0 },
        "gems-1": { completed: true, matches: 2, wins: 1, bestTicks: null, bestGems: 7 },
      },
    };
    const original = JSON.stringify(old);
    const data = new Map([["grid-puzzle.progress.v2", original]]);
    const progress = readProgress({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    });
    expect(progress.version).toBe(4);
    expect(progress.levels["navigation-1"]).toEqual({ ...old.levels["navigation-1"], bestTicks: null });
    expect(progress.levels["gems-1"].bestGems).toBe(0);
    expect(data.get("grid-puzzle.progress.v2")).toBe(original);
  });
  it("retains session progress when existing storage cannot be written", async () => {
    const store = {
      getItem: () => JSON.stringify(emptyProgress()),
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    };
    const saved = await recordMatch("navigation-1", "race", summary(), store);
    expect(saved.persisted).toBe(false);
    expect(readProgress(store).levels["navigation-1"].completed).toBe(true);
    expect(readProgress({ getItem: () => "{bad", setItem: () => {} })).toEqual(emptyProgress());
  });
});
