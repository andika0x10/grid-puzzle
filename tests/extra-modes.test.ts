import { describe, expect, it } from "vitest";
import { getLevel } from "../game/provider";
import { levelSchema, type GameMode, type LevelDefinition } from "../game/schema";
import { defaultConfig } from "../game/algorithms";
import { previewFrame, MatchEngine } from "../game/engine";
import { advanceWorld, cellOf, legalActions, resolveActions, ruleWinners, settleWorld, type Action, type RuleWorld } from "../game/modes";
import { forcedMove, guardCells, safeBarrier } from "../game/extra-modes";
import { ModeDomain } from "../game/planning";
import { createDomainSearch } from "../game/search";
import { MctsDecision, MultiplayerDecision, randomSource } from "../game/decisions";

function setup(mode: GameMode, extras: Record<string, unknown> = {}) {
  const l = levelSchema.parse({
    ...getLevel(`${mode}-1`)!,
    ...extras,
    board: {
      width: 11,
      height: 11,
      terrain: Array.from({ length: 121 }, (_, c) => (c < 11 || c >= 110 || c % 11 === 0 || c % 11 === 10 ? "wall" : "ground")),
      spawn: { x: 1, y: 1 },
      decorations: [],
    },
  });
  return { l, w: previewFrame(l, defaultConfig(l.seed)) as RuleWorld };
}
function move(w: RuleWorld, bot: number, x: number, y: number) {
  Object.assign(w.bots[bot], { x, y });
}
function act(l: LevelDefinition, w: RuleWorld, kind: Action["kind"], object?: number) {
  const a = legalActions(l, w, w.bots[0]).find((a) => a.kind === kind && (object === undefined || a.object === object));
  expect(a).toBeTruthy();
  return resolveActions(l, w, [{ botId: w.bots[0].id, action: a! }], 1);
}
describe("new shared mechanics", () => {
  it("awards the last survivor a win instead of a draw with bots eliminated on that tick", () => {
    const { w } = setup("snake", {
      snake: {
        fruit: [
          { x: 2, y: 2 },
          { x: 8, y: 8 },
        ],
        initialLength: 3,
      },
    });
    w.bots[0].eliminatedTick = 100;
    w.bots[1].eliminatedTick = 100;
    for (const mode of ["collapse", "snake", "bomb"] as const) expect(ruleWinners(mode, w.bots, 100)).toEqual(["bot-2"]);
  });
  it("explodes in rays, stops at wood, triggers chains, and credits each victim once", () => {
    const { l, w } = setup("bomb", { bomb: { gems: [{ x: 8, y: 8 }], destructible: [{ x: 5, y: 4 }], fuseTicks: 36 } });
    if (w.modeState.mode !== "bomb") throw Error();
    w.terrain[49] = "wall";
    move(w, 0, 4, 4);
    move(w, 1, 4, 5);
    move(w, 2, 6, 4);
    act(l, w, "bomb");
    expect(w.modeState.bombs).toHaveLength(1);
    move(w, 0, 1, 1);
    w.modeState.bombs.push({ cell: 4 + 6 * 11, owner: "bot-0", at: 100 });
    advanceWorld(l, w, 36);
    expect(w.modeState.bombs).toHaveLength(0);
    expect(w.modeState.wood).toHaveLength(0);
    expect(w.bots[1].eliminatedTick).toBe(36);
    expect(w.bots[2].eliminatedTick).toBeNull();
    expect(w.bots[0].score).toBe(4);
    expect(w.terrain[49]).toBe("ground");
  });
  it("grows shared blocking tails and eliminates an enclosed snake", () => {
    const { l, w } = setup("snake", {
      snake: {
        fruit: [
          { x: 2, y: 1 },
          { x: 8, y: 8 },
        ],
        initialLength: 3,
      },
    });
    if (w.modeState.mode !== "snake") throw Error();
    act(l, w, "move");
    act(l, w, "claim", 0);
    expect(w.bots[0].score).toBe(1);
    expect(w.modeState.tails["bot-0"]).toEqual([12]);
    expect(legalActions(l, w, w.bots[0]).some((a) => a.to === 12)).toBe(false);
    move(w, 1, 5, 5);
    w.modeState.tails["bot-0"] = [49, 59, 61, 71];
    settleWorld(l, w, 1);
    expect(w.bots[1].eliminatedTick).toBe(0);
  });
  it("uses the same conveyor and ice landing/duration in live and graph edges", () => {
    const { l, w } = setup("flow", {
      flow: {
        currents: [{ x: 3, y: 4, dx: 1, dy: 0, distance: 2 }],
        ice: [
          { x: 3, y: 6 },
          { x: 4, y: 6 },
          { x: 5, y: 6 },
        ],
        tokens: [
          { x: 8, y: 8 },
          { x: 1, y: 8 },
        ],
      },
    });
    move(w, 0, 2, 4);
    const a = forcedMove(l, w, 46, 47);
    expect(a).toMatchObject({ to: 49, duration: 8, object: 47 });
    expect(legalActions(l, w, w.bots[0])).toContainEqual(a);
    expect(forcedMove(l, w, 68, 69)).toMatchObject({ to: 72, duration: 10 });
    const d = new ModeDomain(l, w, w.bots[0]),
      successors = d.successors(d.start);
    let result = successors.next();
    while (!result.done) result = successors.next();
    expect(result.value.some((e) => e.action.to === a.to && e.cost === a.duration)).toBe(true);
  });
  it("rotates the portal network after each use and rejects stale plans", () => {
    const { l, w } = setup("portal", {
      portal: {
        pads: [
          { x: 2, y: 2 },
          { x: 8, y: 2 },
          { x: 8, y: 8 },
          { x: 2, y: 8 },
        ],
        tokens: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
        ],
      },
    });
    if (w.modeState.mode !== "portal") throw Error();
    move(w, 0, 1, 2);
    const a = legalActions(l, w, w.bots[0]).find((a) => a.object === 24)!;
    expect(a.to).toBe(30);
    resolveActions(l, w, [{ botId: "bot-0", action: a }], 1);
    expect(w.modeState.phase).toBe(1);
    move(w, 0, 1, 2);
    expect(resolveActions(l, w, [{ botId: "bot-0", action: a }], 1).size).toBe(0);
  });
  it("preserves every player's routes when placing walls, then expires them", () => {
    const { l, w } = setup("tactical", {
      tactical: {
        tokens: [
          { x: 8, y: 8 },
          { x: 9, y: 8 },
        ],
        wallTicks: 100,
      },
    });
    move(w, 0, 4, 4);
    expect(safeBarrier(l, w, 49)).toBe(true);
    act(l, w, "barrier", 49);
    expect(w.terrain[49]).toBe("wall");
    advanceWorld(l, w, 100);
    expect(w.terrain[49]).toBe("ground");
    for (let c = 0; c < 121; c++) w.terrain[c] = Math.floor(c / 11) === 5 && c % 11 > 0 && c % 11 < 10 ? "ground" : "wall";
    move(w, 0, 1, 5);
    expect(safeBarrier(l, w, 60)).toBe(false);
  });
  it("route planners can place a fence behind themselves to divert a pursuing rival", () => {
    const { l, w } = setup("tactical", {
      tactical: {
        tokens: [
          { x: 8, y: 4 },
          { x: 8, y: 5 },
        ],
        wallTicks: 100,
      },
    });
    move(w, 0, 4, 4);
    move(w, 1, 2, 4);
    move(w, 2, 1, 8);
    const domain = new ModeDomain(l, w, w.bots[0]);
    expect(domain.target).toMatchObject({ kind: "barrier", object: 47 });
    const plan = createDomainSearch(domain, "astar", l.board.width);
    while (!plan.done) plan.advance(64);
    expect(plan.actions).toEqual([{ kind: "barrier", from: 48, to: 48, object: 47, duration: 8 }]);
  });
  it("supports hiding, detection over time, and a cooldown-limited distraction", () => {
    const stealth = {
      guards: [
        {
          route: [
            { x: 4, y: 4 },
            { x: 5, y: 4 },
            { x: 5, y: 5 },
            { x: 4, y: 5 },
          ],
          stepTicks: 80,
          range: 3,
        },
      ],
      bushes: [{ x: 6, y: 4 }],
      intel: [
        { x: 8, y: 8 },
        { x: 8, y: 1 },
      ],
    };
    const { l, w } = setup("stealth", { stealth });
    move(w, 0, 6, 4);
    expect(guardCells(l, w).has(50)).toBe(false);
    move(w, 0, 7, 4);
    expect(guardCells(l, w).has(51)).toBe(true);
    act(l, w, "distract");
    expect(guardCells(l, w).size).toBe(0);
    expect(legalActions(l, w, w.bots[0]).some((a) => a.kind === "distract")).toBe(false);
    const fresh = setup("stealth", { stealth });
    move(fresh.w, 0, 7, 4);
    for (let t = 1; t <= 20; t++) advanceWorld(fresh.l, fresh.w, t);
    expect(fresh.w.bots[0].eliminatedTick).toBe(20);
  });
  for (const mode of ["flow", "portal", "tactical"] as const)
    it(`${mode} reverse action graph agrees with Dijkstra`, () => {
      const l = getLevel(`${mode}-3`)!,
        w = previewFrame(l, defaultConfig(1)),
        d = new ModeDomain(l, w, w.bots[0]);
      const cost = (id: "dijkstra" | "dstar-lite") => {
        const s = createDomainSearch(d, id, l.board.width);
        while (!s.done && s.operations < 200000) s.advance(64);
        expect(s.done).toBe(true);
        return s.actions?.reduce((n, a) => n + a.duration, 0);
      };
      expect(cost("dstar-lite")).toBe(cost("dijkstra"));
    });
  it("MCTS handles an empty action set without crashing", () => {
    const l = getLevel("collapse-1")!,
      w = previewFrame(l, defaultConfig(1));
    w.terrain.fill("water");
    for (const b of w.bots) w.terrain[cellOf(b, l.board.width)] = "ground";
    const s = new MctsDecision(l, 0, w, 1, randomSource(1));
    while (!s.done) s.advance(64);
    expect(s.actions).toBeNull();
  });
  for (const paranoid of [false, true])
    it(`multiplayer decision is legal, deterministic and bounded (${paranoid})`, () => {
      const { l, w } = setup("tactical", {
        tactical: {
          tokens: [
            { x: 4, y: 1 },
            { x: 8, y: 8 },
          ],
          wallTicks: 100,
        },
      });
      const run = () => {
        const s = new MultiplayerDecision(l, w, w.bots[0], 3, paranoid, new Map());
        while (!s.done) expect(s.advance(64)).toBeLessThanOrEqual(64);
        expect(s.operations).toBeLessThanOrEqual(2048);
        return s.actions;
      };
      expect(run()).toEqual(run());
      expect(run()?.[0]).toBeTruthy();
    });
  for (const algorithm of ["beam", "rtaa", "ara", "maxn", "paranoid", "utility"] as const)
    it(`${algorithm} plays every new category within its per-tick budget`, () => {
      for (const mode of ["bomb", "snake", "flow", "portal", "tactical", "stealth"]) {
        const l = getLevel(`${mode}-1`)!,
          e = new MatchEngine(l, { player: algorithm, opponents: ["astar", "greedy"], seed: 3 });
        let f = e.snapshot();
        while (f.phase !== "finished") {
          const ops = f.bots[0].computeOps;
          f = e.step();
          expect(f.bots[0].computeOps - ops).toBeLessThanOrEqual(64);
        }
        expect(f.tick).toBeLessThanOrEqual(l.timeLimit);
      }
    });
});
