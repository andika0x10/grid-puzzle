import { describe, expect, it } from "vitest";
import { algorithms, type AlgorithmId } from "../game/algorithms";
import { MatchEngine, matchResult } from "../game/engine";
import { createSearch } from "../game/search";
import { MctsDecision, randomSource, RandomDecision, type DecisionState } from "../game/decisions";
import { botTerrain, initialModeState, resolveModeTick, type RuleBot } from "../game/modes";
import { getLevel, levels, sections } from "../game/provider";
import { isWalkable, terrainCost } from "../game/schema";
import { isLevelUnlocked, readProgress, recordMatch, STORAGE_KEY } from "../game/progress";
import { fixture, LocalWorker } from "./fixtures";
import { SimulationController } from "../game/simulation";

function bot(id = "one", algorithm = "astar"): RuleBot {
  return { id, algorithm, x: 1, y: 1, score: 0, inventory: 0, keys: [], checkpoints: [], eliminatedTick: null, finishTick: null };
}
function finish(engine: MatchEngine) {
  let frame = engine.snapshot();
  while (frame.phase !== "finished") frame = engine.step();
  return frame;
}
describe("new mode rules", () => {
  it("gives a parcel to one owner, enforces capacity, and scores only deposits", () => {
    const level = getLevel("cargo-1")!,
      state = initialModeState(level),
      bots = [bot(), bot("two", "greedy")];
    for (const p of state.parcels) {
      bots[0].x = bots[1].x = p.x;
      bots[0].y = bots[1].y = p.y;
      resolveModeTick(level, state, bots, 1, new Set(), 42);
    }
    expect(bots.reduce((n, b) => n + b.inventory, 0)).toBe(state.parcels.length);
    expect(bots.every((b) => b.inventory <= 3 && b.score === 0)).toBe(true);
    for (const b of bots) {
      b.x = level.board.depot!.x;
      b.y = level.board.depot!.y;
    }
    resolveModeTick(level, state, bots, 2, new Set(), 42);
    expect(bots.reduce((n, b) => n + b.score, 0)).toBe(state.parcels.length);
    expect(bots.every((b) => b.inventory === 0)).toBe(true);
    const alone = bot(),
      fresh = initialModeState(level);
    for (const p of fresh.parcels) {
      alone.x = p.x;
      alone.y = p.y;
      resolveModeTick(level, fresh, [alone], 1, new Set(), 1);
    }
    expect(alone.inventory).toBe(3);
    expect(fresh.parcels.filter((p) => p.state === "available")).toHaveLength(1);
  });
  it("reclaims territory only on arrival and keeps simultaneous claims independent of array order", () => {
    const level = getLevel("territory-1")!,
      state = initialModeState(level),
      bots = [bot(), bot("two", "greedy")];
    const cell = level.board.width + 1;
    resolveModeTick(level, state, bots, 1, new Set(["one"]), 5);
    expect(state.territory[cell]).toBe("one");
    resolveModeTick(level, state, bots, 2, new Set(["two"]), 5);
    expect(state.territory[cell]).toBe("two");
    expect(bots.map((b) => b.score)).toEqual([0, 1]);
    resolveModeTick(level, state, bots, 3, new Set(), 5);
    expect(state.territory[cell]).toBe("two");
    const run = (reverse: boolean) => {
      const s = initialModeState(level),
        b = [bot(), bot("two", "greedy")];
      resolveModeTick(level, s, reverse ? b.reverse() : b, 4, new Set(["one", "two"]), 5);
      return s.territory[cell];
    };
    expect(run(false)).toBe(run(true));
  });
  it("activates occupied hazard cells before computation and resolves simultaneous elimination as a tie", () => {
    const level = fixture({ mode: "survival", waves: [{ tick: 1, cells: [fixture().board.spawn] }] });
    const frame = new MatchEngine(level, { player: "astar", opponents: ["mcts"], seed: 2 }).step();
    expect(frame.bots.every((b) => b.status === "eliminated" && b.computeOps === 0 && b.eliminatedTick === 1)).toBe(true);
    expect(frame.winners).toEqual(["bot-0", "bot-1"]);
  });
  it("keeps keys private, opens matching doors, and requires all keys before finishing", () => {
    const level = getLevel("keys-2")!,
      state = initialModeState(level),
      bots = [bot(), bot("two", "greedy")];
    const key = level.board.keys[0],
      door = level.board.doors[0],
      cell = door.y * level.board.width + door.x;
    Object.assign(bots[0], { x: key.x, y: key.y });
    resolveModeTick(level, state, bots, 1, new Set(), 1);
    expect(bots[0].keys).toEqual([key.color]);
    expect(bots[1].keys).toEqual([]);
    expect(isWalkable(botTerrain(level, state, level.board.terrain, bots[0], 1)[cell])).toBe(true);
    expect(isWalkable(botTerrain(level, state, level.board.terrain, bots[1], 1)[cell])).toBe(false);
    Object.assign(bots[1], { x: key.x, y: key.y });
    resolveModeTick(level, state, bots, 2, new Set(), 1);
    expect(bots[1].keys).toEqual([key.color]);
    Object.assign(bots[0], level.board.goal);
    resolveModeTick(level, state, bots, 3, new Set(), 1);
    expect(bots[0].finishTick).toBeNull();
    bots[0].keys = level.board.keys.map((k) => k.color);
    resolveModeTick(level, state, bots, 4, new Set(), 1);
    expect(bots[0].finishTick).toBe(4);
  });
  it("captures a post after eight uncontested ticks and pauses income while contested", () => {
    const level = getLevel("outposts-1")!,
      state = initialModeState(level),
      bots = [bot(), bot("two", "greedy")];
    const post = state.posts[0];
    Object.assign(bots[0], { x: post.x, y: post.y });
    for (let tick = 1; tick <= 7; tick++) resolveModeTick(level, state, bots, tick, new Set(), 1);
    expect(post.owner).toBeNull();
    resolveModeTick(level, state, bots, 8, new Set(), 1);
    expect(post.owner).toBe("one");
    Object.assign(bots[0], { x: 1, y: 1 });
    resolveModeTick(level, state, bots, 20, new Set(), 1);
    expect(bots[0].score).toBe(1);
    Object.assign(bots[0], { x: post.x, y: post.y });
    Object.assign(bots[1], { x: post.x, y: post.y });
    resolveModeTick(level, state, bots, 40, new Set(), 1);
    expect(post.contested).toBe(true);
    expect(bots[0].score).toBe(1);
    Object.assign(bots[0], { x: 1, y: 1 });
    for (let tick = 41; tick <= 48; tick++) resolveModeTick(level, state, bots, tick, new Set(), 1);
    expect(post.owner).toBe("two");
  });
});

describe("additional algorithms", () => {
  it("has ten unique catalog entries and rejects duplicate opponents and aliases", () => {
    expect(algorithms).toHaveLength(10);
    expect(new Set(algorithms.map((a) => a.id)).size).toBe(10);
    expect(new Set(algorithms.map((a) => a.name)).size).toBe(10);
    expect(() => new MatchEngine(fixture(), { player: "astar", opponents: ["bfs", "bfs"], seed: 1 })).toThrow();
    expect(() => new MatchEngine(fixture(), { player: "ucs" as AlgorithmId, opponents: ["bfs"], seed: 1 })).toThrow();
  });
  it("BFS minimizes hops while Dijkstra and D* Lite minimize weighted cost", () => {
    const level = fixture(),
      terrain = [...level.board.terrain];
    terrain[6] = terrain[7] = terrain[8] = "slow";
    const costs = ["bfs", "dijkstra", "dstar-lite"].map((id) => {
      const search = createSearch(5, 3, terrain, level.board.spawn, level.board.goal!, id as AlgorithmId);
      while (!search.done) search.step();
      return search.path!.slice(1).reduce((n, p) => n + terrainCost(terrain[p.y * 5 + p.x]), 0);
    });
    expect(costs).toEqual([13, 6, 6]);
  });
  it("D* Lite reuses its settled states after moving and repairs changed edge costs", () => {
    const level = fixture(),
      start = level.board.spawn,
      goal = level.board.goal!,
      terrain = [...level.board.terrain];
    const search = createSearch(5, 3, terrain, start, goal, "dstar-lite");
    while (!search.done) search.step();
    const settled = search.expanded;
    search.update!({ x: 1, y: 1 }, goal, terrain);
    while (!search.done) search.step();
    expect(search.expanded).toBe(settled);
    expect(search.path?.[0]).toEqual({ x: 1, y: 1 });
    terrain[7] = "wall";
    search.update!({ x: 1, y: 1 }, goal, terrain);
    while (!search.done) search.step();
    expect(search.path?.some((p) => p.x === 2 && p.y === 1)).toBe(false);
    const reference = createSearch(5, 3, terrain, { x: 1, y: 1 }, goal, "dijkstra");
    while (!reference.done) reference.step();
    expect(search.path?.length).toBe(reference.path?.length);
  });
  it("D* Lite agrees with Dijkstra after repeated weighted-map updates", () => {
    const random = randomSource(712);
    for (let map = 0; map < 12; map++) {
      const terrain = Array.from({ length: 49 }, () => (random() < 0.2 ? ("wall" as const) : random() < 0.3 ? ("slow" as const) : ("ground" as const)));
      terrain[0] = terrain[48] = "ground";
      const start = { x: 0, y: 0 },
        goal = { x: 6, y: 6 };
      const incremental = createSearch(7, 7, terrain, start, goal, "dstar-lite");
      for (let update = 0; update < 4; update++) {
        if (update) {
          const cell = 1 + Math.floor(random() * 47);
          terrain[cell] = terrain[cell] === "wall" ? "ground" : "wall";
          incremental.update!(start, goal, terrain);
        }
        const reference = createSearch(7, 7, terrain, start, goal, "dijkstra");
        for (const search of [incremental, reference]) {
          for (let tick = 0; tick < 10000 && !search.done; tick++) search.step();
          expect(search.done).toBe(true);
        }
        const cost = (search: typeof reference) => search.path?.slice(1).reduce((n, p) => n + terrainCost(terrain[p.y * 7 + p.x]), 0) ?? null;
        expect(cost(incremental)).toBe(cost(reference));
      }
    }
  });
  it("D* Lite accepts changes while an operation is suspended without publishing a stale path", () => {
    const level = fixture(),
      changed = [...level.board.terrain];
    changed[7] = "wall";
    for (const operations of [1, 3, 8, 16, 27, 50, 100]) {
      const search = createSearch(5, 3, level.board.terrain, level.board.spawn, level.board.goal!, "dstar-lite");
      search.advance(operations);
      search.update!(level.board.spawn, level.board.goal!, changed);
      for (let tick = 0; tick < 1000 && !search.done; tick++) search.step();
      expect(search.done).toBe(true);
      expect(search.path).toBeTruthy();
      expect(search.path!.some((p) => p.x === 2 && p.y === 1)).toBe(false);
      expect(search.path).toHaveLength(7);
    }
  });
  it("Random Walk avoids immediate backtracking unless it is the only legal exit", () => {
    const level = fixture(),
      current = { x: 1, y: 1 },
      previous = { x: 0, y: 1 };
    const decision = new RandomDecision(5, 3, level.board.terrain, current, previous, randomSource(1));
    while (!decision.done) decision.step();
    expect(decision.path?.[1]).not.toEqual(previous);
    const terrain = Array(15).fill("wall");
    terrain[5] = terrain[6] = "ground";
    const forced = new RandomDecision(5, 3, terrain, current, previous, randomSource(1));
    while (!forced.done) forced.step();
    expect(forced.path?.[1]).toEqual(previous);
  });
  it("MCTS respects its operation cap, seed and batch sizes without mutating the input", () => {
    const level = fixture(),
      initial: DecisionState = {
        tick: 0,
        terrain: [...level.board.terrain],
        gems: [],
        modeState: initialModeState(level),
        bots: [
          { ...bot("one", "mcts"), ...level.board.spawn, remaining: 0, intention: null },
          { ...bot("two", "astar"), ...level.board.spawn, remaining: 0, intention: null },
        ],
      };
    const before = structuredClone(initial);
    const runs = [1, 7, 16, 64].map((budget) => {
      const search = new MctsDecision(level, 0, initial, 1, randomSource(1));
      while (!search.done) expect(search.advance(budget)).toBeLessThanOrEqual(budget);
      expect(search.operations).toBeLessThanOrEqual(512);
      expect(search.path).toBeTruthy();
      return { path: search.path, operations: search.operations, expanded: search.expanded };
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
    expect(initial).toEqual(before);
  });
  const cases = ["cargo", "territory", "survival", "keys", "outposts"].flatMap((mode) =>
    ["bfs", "dijkstra", "dstar-lite", "random", "mcts"].map((algorithm) => ({ mode, algorithm: algorithm as AlgorithmId }))
  );
  it.each(cases)("$algorithm plays $mode legally and deterministically", ({ mode, algorithm }) => {
    const level = getLevel(`${mode}-1`)!;
    const run = () => {
      const e = new MatchEngine(level, { player: algorithm, opponents: ["astar", "greedy"], seed: level.seed });
      let frame = e.snapshot();
      while (frame.phase !== "finished") {
        const old = frame;
        frame = e.step();
        for (const [i, b] of frame.bots.entries()) {
          expect(b.computeOps - old.bots[i].computeOps).toBeLessThanOrEqual(16);
          expect(isWalkable(frame.terrain[b.y * level.board.width + b.x])).toBe(true);
          expect(b.inventory).toBeLessThanOrEqual(3);
        }
      }
      return frame;
    };
    expect(run()).toEqual(run());
  });
});

describe("mode progress and playback", () => {
  it("preserves v3 records while migrating and opens categories in full sequence", async () => {
    const entry = { completed: true, matches: 3, wins: 1, bestTicks: 34, bestGems: 0 };
    const data = new Map([["grid-puzzle.progress.v3", JSON.stringify({ version: 3, levels: { "navigation-1": entry } })]]);
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
    const progress = readProgress(store);
    expect(progress.version).toBe(4);
    expect(progress.levels["navigation-1"]).toMatchObject(entry);
    expect(progress.levels["navigation-1"].bestMetric).toEqual({ kind: "time", value: 34 });
    expect(isLevelUnlocked("cargo-1", sections, progress)).toBe(false);
    for (const level of levels.slice(0, 14)) await recordMatch(level.id, level.mode, { player: "astar", won: false, draw: false, finishTick: null, gems: 0 }, store);
    expect(isLevelUnlocked("cargo-1", sections, readProgress(store))).toBe(true);
    expect(isLevelUnlocked("territory-1", sections, readProgress(store))).toBe(false);
    expect(data.has(STORAGE_KEY)).toBe(true);
  });
  it("stores score and survival records independently from race records", async () => {
    const data = new Map<string, string>(),
      store = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
      };
    for (const id of ["cargo-1", "survival-1", "keys-1"]) {
      const level = getLevel(id)!,
        frame = finish(new MatchEngine(level, { player: "astar", opponents: ["greedy"], seed: 1 }));
      await recordMatch(id, level.mode, matchResult(frame), store);
      const metric = readProgress(store).levels[id].bestMetric;
      expect(readProgress(store).levels[id].bestGems).toBe(0);
      if (id === "keys-1" && frame.bots[0].finishTick === null) expect(metric).toBeNull();
      else expect(metric?.kind).toBe(id === "survival-1" ? "survival" : id === "keys-1" ? "time" : "score");
    }
  });
  it.each(["cargo", "territory", "survival", "keys", "outposts"])("replays %s identically at every playback speed", (mode) => {
    const level = getLevel(`${mode}-1`)!;
    const runs = [0.5, 1, 2, 4].map((speed) => {
      const c = new SimulationController(level, () => new LocalWorker());
      c.configure({ player: "mcts", opponents: ["random", "dstar-lite"], seed: level.seed });
      c.setSpeed(speed);
      c.play();
      for (let i = 0; i < 6000 && c.getSnapshot().phase !== "finished"; i++) c.tick(100);
      expect(c.getSnapshot().phase).toBe("finished");
      const frame = c.getSnapshot().frame;
      c.dispose();
      return frame;
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
  });
});
