import { describe, expect, it } from "vitest";
import { levels, sections } from "../game/provider";
import { algorithms, defaultConfig, unavailableReason } from "../game/algorithms";
import { MatchEngine, matchResult } from "../game/engine";
import { createSearch } from "../game/search";
import { isWalkable, levelSchema, terrainCost } from "../game/schema";
import { SimulationController } from "../game/simulation";
import { emptyProgress, isLevelUnlocked, readProgress, recordMatch, STORAGE_KEY } from "../game/progress";
import { themeIds } from "../game/themes";
import { fixture, LocalWorker } from "./fixtures";

describe("live level simulation", () => {
  it("stores 14 initial boards, 7 worlds per category, without precomputed results", () => {
    expect(levels).toHaveLength(14);
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
          f = e.step();
          expect(f.tick).toBeLessThanOrEqual(level.timeLimit);
          for (const b of f.bots) expect(isWalkable(f.terrain[b.y * level.board.width + b.x])).toBe(true);
        }
        return f;
      };
      expect(run()).toEqual(run());
    });
  it("counts search plus weighted movement, and awards simultaneous finishes fairly", () => {
    const level = fixture(),
      e = new MatchEngine(level, { player: "astar", opponents: ["greedy"], seed: 1 });
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.winners).toEqual(["bot-0", "bot-1"]);
    for (const b of f.bots) {
      expect(b.finishTick).toBe(b.searchTicks + b.moveTicks);
      expect(b.cost).toBe(4);
      expect(b.moveTicks).toBe(16);
    }
  });
  it("collects a shared gem atomically without giving either bot ordering advantage", () => {
    const base = fixture(),
      level = fixture({ mode: "gems", board: { ...base.board, goal: undefined, gems: [{ x: 4, y: 1 }] } });
    const e = new MatchEngine(level, { player: "astar", opponents: ["greedy"], seed: 1 });
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.gems[0].taken).toBe(true);
    expect(f.bots.map((b) => b.score)).toEqual([1, 1]);
    expect(f.winners).toEqual(["bot-0", "bot-1"]);
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
  });
  it("defers closing occupied cells and replans when the shared map changes", () => {
    const base = fixture(),
      e = new MatchEngine(fixture({ changes: [{ tick: 1, x: 0, y: 1, terrain: "wall" }] }), { player: "astar", opponents: ["greedy"], seed: 1 });
    expect(e.step().terrain[5]).toBe(base.board.terrain[5]);
    let f = e.snapshot();
    while (f.phase !== "finished") f = e.step();
    expect(f.terrain[5]).toBe("wall");
    expect(f.bots.every((b) => b.finishTick !== null)).toBe(true);
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
  it("every released algorithm has a reproducible solo victory against strong opponents", () => {
    for (const algorithm of algorithms) {
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
  it("produces the same result at every playback speed", () => {
    const results = [0.5, 1, 2, 4].map((speed) => {
      const c = new SimulationController(fixture(), () => new LocalWorker());
      c.setSpeed(speed);
      c.play();
      for (let i = 0; i < 1000 && c.getSnapshot().phase !== "finished"; i++) c.tick(100);
      expect(c.getSnapshot().phase).toBe("finished");
      const result = c.getSnapshot().result;
      c.dispose();
      return result;
    });
    results.forEach((result) => expect(result).toEqual(results[0]));
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
