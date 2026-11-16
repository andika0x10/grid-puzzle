import { describe, expect, it } from "vitest";
import { applyTerrainChanges, feverMultiplier, gemActive, gemsSettled, resolveGemClaims } from "../game/classic";
import { defaultConfig } from "../game/algorithms";
import { MatchEngine, matchResult, previewFrame } from "../game/engine";
import { initialModeState, resolveModeTick, type RuleBot } from "../game/modes";
import { levels, getLevel, sections } from "../game/provider";
import { isLevelUnlocked, mergeProgress, readProgress, recordMatch, type Progress, STORAGE_KEY } from "../game/progress";
import { SimulationController } from "../game/simulation";
import { fixture, LocalWorker } from "./fixtures";

const competitor = (id = "one", algorithm = "astar"): RuleBot => ({
  id,
  algorithm,
  x: 1,
  y: 1,
  score: 0,
  keys: [],
  inventory: 0,
  checkpoints: [],
  eliminatedTick: null,
  finishTick: null,
});
const finish = (e: MatchEngine) => {
  let f = e.snapshot();
  while (f.phase !== "finished") f = e.step();
  return f;
};

describe("redesigned race", () => {
  it("requires every private checkpoint, accepts any order, and ignores an early finish visit", () => {
    const level = getLevel("navigation-1")!,
      state = initialModeState(level),
      a = competitor(),
      b = competitor("two", "greedy"),
      bots = [a, b];
    Object.assign(a, level.board.goal);
    resolveModeTick(level, state, bots, 1, new Set(), 1);
    expect(a.finishTick).toBeNull();
    for (const i of [2, 0, 1]) {
      Object.assign(a, level.board.checkpoints[i]);
      resolveModeTick(level, state, bots, 2 + i, new Set(), 1);
    }
    expect(a.checkpoints).toEqual([2, 0, 1]);
    expect(b.checkpoints).toEqual([]);
    Object.assign(a, level.board.goal);
    resolveModeTick(level, state, bots, 9, new Set(), 1);
    expect(a.finishTick).toBe(9);
    expect(b.finishTick).toBeNull();
  });
  it("never awards a race win to a bot with missing checkpoints", () => {
    const base = fixture(),
      level = fixture({ rulesVersion: 2, board: { ...base.board, checkpoints: [{ x: 2, y: 0 }] } });
    const frame = finish(new MatchEngine(level, { player: "greedy", opponents: ["bfs"], seed: 12 }));
    expect(frame.winners.length).toBeGreaterThan(0);
    for (const bot of frame.bots.filter((b) => b.finishTick !== null)) expect(bot.checkpoints).toEqual([0]);
  });
  it("supersedes an occupied deferred closing when the gate's opening arrives", () => {
    const base = fixture(),
      gate = { x: 2, y: 1 };
    const level = fixture({
      board: { ...base.board, gates: [gate] },
      changes: [
        { ...gate, tick: 1, terrain: "wall" },
        { ...gate, tick: 3, terrain: "path" },
      ],
    });
    const terrain = [...level.board.terrain],
      applied = new Set<number>();
    applyTerrainChanges(level, terrain, [gate], 1, applied);
    expect(terrain[7]).toBe("ground");
    applyTerrainChanges(level, terrain, [gate], 3, applied);
    applyTerrainChanges(level, terrain, [], 4, applied);
    expect(terrain[7]).toBe("path");
    expect(applied.size).toBe(2);
  });
  it("keeps a valid journey when an unrelated gate closes", () => {
    const probe = new MatchEngine(fixture(), { player: "greedy", opponents: ["astar"], seed: 1 });
    let sample = probe.snapshot();
    while (sample.bots[0].status !== "moving") sample = probe.step();
    const closingTick = sample.tick + 2;
    const level = fixture({ changes: [{ tick: closingTick, x: 4, y: 0, terrain: "wall" }] });
    const e = new MatchEngine(level, { player: "greedy", opponents: ["astar"], seed: 1 });
    let before = e.snapshot();
    while (before.tick < closingTick - 1) before = e.step();
    expect(before.bots[0].status).toBe("moving");
    const after = e.step();
    expect(after.bots[0].searchTicks).toBe(before.bots[0].searchTicks);
    expect(after.bots[0].moveTicks).toBe(before.bots[0].moveTicks + 1);
  });
  it("has fourteen authored challenges and three different default winners in each mode", () => {
    const classic = levels.filter((l) => l.mode === "race" || l.mode === "gems");
    expect(classic).toHaveLength(14);
    for (const mode of ["race", "gems"]) {
      const winners = new Set<string>();
      for (const level of classic.filter((l) => l.mode === mode)) {
        expect(level.rulesVersion).toBe(2);
        expect(level.board.gates.length).toBeGreaterThan(0);
        if (mode === "race") expect(level.board.checkpoints.length).toBeGreaterThanOrEqual(3);
        else {
          expect(new Set(level.board.gems.map((g) => g.value))).toEqual(new Set([1, 3, 5]));
          expect(level.fever.length).toBeGreaterThan(0);
        }
        const frame = finish(new MatchEngine(level, defaultConfig(level.seed)));
        expect(frame.winners.length).toBeGreaterThan(0);
        if (frame.winners.length === 1) winners.add(frame.bots.find((b) => b.id === frame.winners[0])!.algorithm);
      }
      expect(winners.size).toBeGreaterThanOrEqual(3);
    }
    const intro = finish(new MatchEngine(getLevel("navigation-1")!, defaultConfig(1001)));
    expect(intro.tick).toBeGreaterThan(200);
  });
});

describe("timed and valued gems", () => {
  it("does not collect before spawn, doubles value during fever, and never awards twice", () => {
    const base = fixture(),
      level = fixture({
        mode: "gems",
        board: { ...base.board, goal: undefined, gems: [{ x: 1, y: 1, value: 5, spawnTick: 10, expireTick: 20 }] },
        fever: [{ startTick: 10, endTick: 15 }],
      });
    const gems = previewFrame(level, defaultConfig(1)).gems,
      bot = competitor();
    resolveGemClaims(gems, [bot], 9, 1, level);
    expect(bot.score).toBe(0);
    expect(gemActive(gems[0], 9)).toBe(false);
    expect(feverMultiplier(level, 10)).toBe(2);
    resolveGemClaims(gems, [bot], 10, 1, level);
    expect(bot.score).toBe(10);
    expect(gems[0].awardedPoints).toBe(10);
    resolveGemClaims(gems, [bot], 11, 1, level);
    expect(bot.score).toBe(10);
    expect(feverMultiplier(level, 15)).toBe(1);
  });
  it("expires at its deadline before any pickup and gives no points", () => {
    const base = fixture(),
      level = fixture({ mode: "gems", board: { ...base.board, goal: undefined, gems: [{ x: 1, y: 1, value: 5, spawnTick: 2, expireTick: 8 }] } });
    const gems = previewFrame(level, defaultConfig(1)).gems,
      bot = competitor();
    resolveGemClaims(gems, [bot], 8, 1, level);
    expect(gems[0].expired).toBe(true);
    expect(gems[0].claimedBy).toBeNull();
    expect(bot.score).toBe(0);
    expect(gemsSettled(gems)).toBe(true);
  });
  it("keeps a future wave alive and allows preparation before it appears", () => {
    const base = fixture(),
      level = fixture({ rulesVersion: 2, mode: "gems", board: { ...base.board, goal: undefined, gems: [{ x: 4, y: 1, value: 3, spawnTick: 100, expireTick: 200 }] } });
    const e = new MatchEngine(level, { player: "greedy", opponents: ["bfs"], seed: 1 });
    let f = e.snapshot();
    while (f.tick < 80) f = e.step();
    expect(f.phase).toBe("running");
    expect(f.bots.some((b) => b.x === 4 && b.y === 1)).toBe(true);
    expect(f.bots.every((b) => b.score === 0)).toBe(true);
    while (f.phase !== "finished") f = e.step();
    expect(f.tick).toBe(100);
    expect(f.bots.reduce((n, b) => n + b.score, 0)).toBe(3);
  });
  it("ends an expired empty arena with no winner", () => {
    const base = fixture(),
      level = fixture({ rulesVersion: 2, mode: "gems", board: { ...base.board, goal: undefined, gems: [{ x: 4, y: 1, value: 5, expireTick: 2 }] } });
    const f = finish(new MatchEngine(level, { player: "astar", opponents: ["greedy"], seed: 1 }));
    expect(f.tick).toBe(2);
    expect(f.winners).toEqual([]);
    expect(f.gems[0].expired).toBe(true);
  });
  it("resolves a valuable simultaneous gem independently of participant slot", () => {
    const level = getLevel("gems-1")!;
    const run = (reverse: boolean) => {
      const bots = [competitor("one", "astar"), competitor("two", "greedy")];
      const gem = { x: 1, y: 1, id: "ruby", taken: false, claimedBy: null as string | null, claimedTick: null as number | null, value: 5 };
      resolveGemClaims([gem], reverse ? bots.reverse() : bots, 1, 99, level);
      expect(bots.reduce((n, b) => n + b.score, 0)).toBe(5);
      return bots.find((b) => b.id === gem.claimedBy)!.algorithm;
    };
    expect(run(false)).toBe(run(true));
  });
});

describe("redesigned records and playback", () => {
  it("starts fresh records while retaining completion, match history and unlocked categories", async () => {
    const previous: Progress = {
      version: 4,
      levels: { "navigation-1": { completed: true, matches: 4, wins: 2, bestTicks: 5, bestGems: 0, bestMetric: { kind: "time", value: 5 } } },
    };
    const data = new Map([[STORAGE_KEY, JSON.stringify(previous)]]),
      store = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
      };
    await recordMatch("navigation-1", "race", { player: "astar", won: false, draw: false, finishTick: 500, gems: 0, rulesVersion: 2, metric: { kind: "time", value: 500 } }, store);
    const current = readProgress(store);
    expect(current.levels["navigation-1"]).toMatchObject({ completed: true, matches: 5, wins: 2, bestTicks: 500, rulesVersion: 2 });
    expect(isLevelUnlocked("navigation-2", sections, current)).toBe(true);
    expect(mergeProgress(current, previous).levels["navigation-1"].bestTicks).toBe(500);
  });
  it.each(["navigation-1", "gems-1"])("reproduces %s at all playback speeds with MCTS and dynamic rules", (id) => {
    const level = getLevel(id)!;
    const runs = [0.5, 1, 2, 4].map((speed) => {
      const c = new SimulationController(level, () => new LocalWorker());
      c.configure({ player: "mcts", opponents: ["random", "dstar-lite"], seed: level.seed });
      c.setSpeed(speed);
      c.play();
      for (let i = 0; i < 6000 && c.getSnapshot().phase !== "finished"; i++) c.tick(100);
      expect(c.getSnapshot().phase).toBe("finished");
      const f = c.getSnapshot().frame;
      c.dispose();
      return f;
    });
    for (const f of runs) {
      expect(f).toEqual(runs[0]);
      expect(matchResult(f).rulesVersion).toBe(2);
    }
  });
});
