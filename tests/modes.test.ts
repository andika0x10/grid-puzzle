import { describe, expect, it } from "vitest";
import { getLevel } from "../game/provider";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { actionEqual, advanceWorld, cellOf, cloneWorld, legalActions, observation, resolveActions, settleWorld, terminal, type RuleWorld } from "../game/modes";
import { ModeDomain } from "../game/planning";
import { createDomainSearch } from "../game/search";
import { MctsDecision, MCTS_MAX_OPERATIONS, randomSource } from "../game/decisions";
import { isWalkable, type GameMode } from "../game/schema";
function setup(mode: GameMode) {
  const l = getLevel(`${mode}-1`)!;
  return { l, w: previewFrame(l, defaultConfig(l.seed)) as RuleWorld };
}
const locate = (w: RuleWorld, index: number, cell: number, width: number) => {
  w.bots[index].x = cell % width;
  w.bots[index].y = Math.floor(cell / width);
};
describe("shared action rules", () => {
  it("opens the bridge exit only after all island markers are claimed", () => {
    const { l, w } = setup("bridge");
    if (w.modeState.mode !== "bridge") throw Error();
    locate(w, 0, cellOf(l.board.goal!, l.board.width), l.board.width);
    expect(legalActions(l, w, w.bots[0]).some((a) => a.kind === "claim" && a.object === -1)).toBe(false);
    w.modeState.owners.fill("bot-1");
    w.tick = 5;
    const action = legalActions(l, w, w.bots[0]).find((a) => a.kind === "claim" && a.object === -1)!;
    resolveActions(l, w, [{ botId: "bot-0", action }], 1);
    expect(w.bots[0].score).toBe(5);
    expect(w.bots[0].finishTick).toBe(5);
    expect(terminal(l, w)).toBe(true);
  });
  it("builds a shared bridge once, charges one inventory and awards one builder", () => {
    const { l, w } = setup("bridge");
    if (l.mode !== "bridge" || w.modeState.mode !== "bridge") throw Error();
    const span = l.bridge.spans[0],
      bank = cellOf(span.banks[0], l.board.width);
    w.tick = 10;
    for (const b of w.bots) {
      b.x = bank % l.board.width;
      b.y = Math.floor(bank / l.board.width);
      b.inventory = 3;
    }
    const intents = w.bots.map((b) => ({ botId: b.id, action: legalActions(l, w, b).find((a) => a.kind === "build" && a.object === 0)! }));
    resolveActions(l, w, intents, l.seed);
    expect(w.modeState.builders.filter(Boolean)).toHaveLength(1);
    expect(w.bots.reduce((n, b) => n + b.score, 0)).toBe(2);
    expect(w.bots.reduce((n, b) => n + b.inventory, 0)).toBe(9 - span.cells.length);
    expect(span.cells.every((p) => isWalkable(w.terrain[cellOf(p, l.board.width)]))).toBe(true);
  });
  it("resolves competing pushes independently of participant and intent order", () => {
    const run = (reverse: boolean) => {
      const { l, w } = setup("crates");
      if (l.mode !== "crates" || w.modeState.mode !== "crates") throw Error();
      const box = w.modeState.boxes[0];
      box.cell = cellOf(l.crates.docks[0], l.board.width) + l.board.width;
      w.tick = 5;
      for (const b of w.bots) {
        b.x = box.cell % l.board.width;
        b.y = Math.floor(box.cell / l.board.width) + 1;
      }
      const intents = w.bots.map((b) => ({ botId: b.id, action: legalActions(l, w, b).find((a) => a.kind === "push" && a.to === box.cell)! }));
      if (reverse) {
        w.bots.reverse();
        intents.reverse();
      }
      resolveActions(l, w, intents, l.seed);
      expect(w.bots.reduce((n, b) => n + b.score, 0)).toBe(1);
      expect(terminal(l, w)).toBe(true);
      expect(legalActions(l, w, w.bots[0]).some((a) => a.kind === "push")).toBe(false);
      return w.bots.find((b) => b.score === 1)!.algorithm;
    };
    expect(run(false)).toBe(run(true));
  });
  it("rejects pushes into static dead squares", () => {
    const { l, w } = setup("crates");
    if (w.modeState.mode !== "crates") throw Error();
    const box = w.modeState.boxes[0];
    box.cell = 3 * l.board.width + 2;
    locate(w, 0, box.cell + 1, l.board.width);
    expect(legalActions(l, w, w.bots[0]).some((a) => a.kind === "push" && a.to === box.cell)).toBe(false);
  });
  it("never overspends shared charging stock and regenerates it", () => {
    const { l, w } = setup("energy");
    if (w.modeState.mode !== "energy") throw Error();
    const charger = w.modeState.chargers[0];
    charger.stock = 2;
    for (const b of w.bots) {
      locate(w, w.bots.indexOf(b), charger.cell, l.board.width);
      b.energy = 10;
    }
    resolveActions(
      l,
      w,
      w.bots.map((b) => ({ botId: b.id, action: legalActions(l, w, b).find((a) => a.kind === "charge")! })),
      1
    );
    expect(w.bots.reduce((n, b) => n + b.energy, 0)).toBe(32);
    expect(charger.stock).toBe(0);
    advanceWorld(l, w, 1);
    expect(charger.stock).toBe(1);
  });
  it("requires energy to claim a beacon and strands empty bots away from chargers", () => {
    const { l, w } = setup("energy");
    if (l.mode !== "energy") throw Error();
    locate(w, 0, cellOf(l.energy.beacons[0], l.board.width), l.board.width);
    w.bots[0].energy = 4;
    expect(legalActions(l, w, w.bots[0]).some((a) => a.kind === "claim")).toBe(false);
    w.bots[0].energy = 0;
    advanceWorld(l, w, 1);
    expect(w.bots[0].eliminatedTick).toBe(1);
  });
  it("arms a shared trail and eliminates occupants before their next move", () => {
    const { l, w } = setup("collapse");
    if (w.modeState.mode !== "collapse") throw Error();
    const from = cellOf(w.bots[0], l.board.width);
    w.modeState.dangerAt.fill(0);
    locate(w, 1, from, l.board.width);
    w.modeState.nextCollapse = Infinity;
    w.tick = 200;
    const action = legalActions(l, w, w.bots[0]).find((a) => a.kind === "move")!;
    resolveActions(l, w, [{ botId: w.bots[0].id, action }], 1);
    expect(w.modeState.dangerAt[from]).toBe(224);
    advanceWorld(l, w, 223);
    expect(w.bots[1].eliminatedTick).toBeNull();
    advanceWorld(l, w, 224);
    expect(w.bots[1].eliminatedTick).toBe(224);
    expect(w.terrain[from]).toBe("water");
  });
  it("claims moving targets once and respawns them after twenty ticks", () => {
    const { l, w } = setup("hunt");
    if (w.modeState.mode !== "hunt") throw Error();
    const target = w.modeState.targets[0];
    for (let i = 0; i < w.bots.length; i++) locate(w, i, target.cell, l.board.width);
    w.tick = 10;
    settleWorld(l, w, 1);
    settleWorld(l, w, 1);
    expect(w.bots.reduce((n, b) => n + b.score, 0)).toBe(1);
    advanceWorld(l, w, 29);
    expect(target.active).toBe(false);
    advanceWorld(l, w, 30);
    expect(target.active).toBe(true);
  });
  it("does not undo a switch when another bot already set its planned value", () => {
    const { l, w } = setup("circuit");
    if (l.mode !== "circuit" || w.modeState.mode !== "circuit") throw Error();
    const cell = cellOf(l.circuit.switches[0], l.board.width);
    locate(w, 0, cell, l.board.width);
    locate(w, 1, cell, l.board.width);
    const action = legalActions(l, w, w.bots[0]).find((a) => a.kind === "toggle")!;
    resolveActions(l, w, [{ botId: w.bots[0].id, action }], 1);
    expect(w.modeState.mask).toBe(1);
    resolveActions(l, w, [{ botId: w.bots[1].id, action }], 1);
    expect(w.modeState.mask).toBe(1);
  });
  it("claims a powered contract once and advances the shared contract", () => {
    const { l, w } = setup("circuit");
    if (l.mode !== "circuit" || w.modeState.mode !== "circuit") throw Error();
    const contract = l.circuit.contracts[0];
    w.modeState.mask = contract.mask;
    for (let i = 0; i < w.bots.length; i++) locate(w, i, cellOf(contract, l.board.width), l.board.width);
    resolveActions(
      l,
      w,
      w.bots.map((b) => ({ botId: b.id, action: legalActions(l, w, b).find((a) => a.kind === "claim")! })),
      1
    );
    expect(w.modeState.contract).toBe(1);
    expect(w.bots.reduce((n, b) => n + b.score, 0)).toBe(3);
  });
});
describe("observation and decision controllers", () => {
  it("MCTS completes a useful construction action instead of circling its prerequisites", () => {
    const { l, w } = setup("bridge");
    if (l.mode !== "bridge") throw Error();
    const bank = l.bridge.spans[0].banks[0];
    Object.assign(w.bots[0], bank);
    w.bots[0].inventory = 1;
    const d = new MctsDecision(l, 0, w, l.seed, randomSource(1));
    while (!d.done) d.advance(64);
    expect(d.actions?.[0].kind).toBe("build");
  });
  it("hidden terrain cannot change any solver's initial decision", () => {
    const { l, w } = setup("fog"),
      hidden = w.bots[0].known.findIndex((v, c) => v === null && isWalkable(w.terrain[c]) && c !== cellOf(l.board.goal!, l.board.width));
    const other = cloneWorld(w);
    other.terrain[hidden] = "wall";
    const views = [w, other].map((world) => observation(l, world, world.bots[0]));
    expect(views[0]).toEqual(views[1]);
    for (const algorithm of ["astar", "dijkstra", "dstar-lite"] as const) {
      const plans = views.map((view) => {
        const search = createDomainSearch(new ModeDomain(l, view, view.bots[0]), algorithm, l.board.width);
        while (!search.done) search.advance(64);
        return search.actions;
      });
      expect(plans[0]).toEqual(plans[1]);
    }
    const decisions = views.map((view) => {
      const d = new MctsDecision(l, 0, view, l.seed, randomSource(1));
      while (!d.done) d.advance(64);
      return d.actions;
    });
    expect(decisions[0]).toEqual(decisions[1]);
  });
  it("MCTS preserves input and respects caps, seed and different batch sizes", () => {
    const { l, w } = setup("hunt"),
      before = structuredClone(w);
    const runs = [1, 7, 64, 256].map((budget) => {
      const d = new MctsDecision(l, 0, w, l.seed, randomSource(42));
      while (!d.done) expect(d.advance(budget)).toBeLessThanOrEqual(budget);
      expect(d.operations).toBeLessThanOrEqual(MCTS_MAX_OPERATIONS);
      expect(d.completedRollouts).toBeGreaterThan(0);
      expect(d.actions?.length).toBeGreaterThan(0);
      return { actions: d.actions, ops: d.operations };
    });
    for (const run of runs) expect(run).toEqual(runs[0]);
    expect(w).toEqual(before);
  });
  it("forward and reverse domain edges describe the same actions", () => {
    for (const mode of ["circuit", "energy", "bridge", "crates"] as const) {
      const { l, w } = setup(mode),
        d = new ModeDomain(l, w, w.bots[0]),
        states = [d.start],
        seen = new Set([d.key(d.start)]);
      for (let h = 0; h < Math.min(states.length, 50); h++) {
        const it = d.successors(states[h]);
        let next = it.next();
        while (!next.done) next = it.next();
        for (const edge of next.value) {
          const rev = d.predecessors(edge.state);
          let p = rev.next();
          while (!p.done) p = rev.next();
          expect(
            p.value.some((e) => d.key(e.state) === d.key(states[h]) && actionEqual(e.action, edge.action)),
            `${mode} ${edge.action.kind}`
          ).toBe(true);
          if (!seen.has(d.key(edge.state))) {
            seen.add(d.key(edge.state));
            states.push(edge.state);
          }
        }
      }
    }
  });
});
