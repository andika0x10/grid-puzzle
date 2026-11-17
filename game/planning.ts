import { adjacent, cellOf, pointOf, seededHash, type Action, type RuleBot, type RuleWorld } from "./modes";
import { isWalkable, terrainCost, type LevelDefinition } from "./schema";
export type Work<T = void> = Generator<void, T, unknown>;
export interface PlanState {
  cell: number;
  energy: number;
  mask: number;
  inventory: number;
  supply: number;
  boxes: number[];
}
export interface PlanEdge {
  state: PlanState;
  action: Action;
  cost: number;
}
export interface Objective {
  id: string;
  cell: number;
  kind: "visit" | "wait" | "claim" | "build" | "collect" | "charge" | "crates";
  object?: number;
  mask?: number;
  tick?: number;
}
export interface PlanningDomain {
  start: PlanState;
  target: Objective;
  preparation: number;
  key(s: PlanState): string;
  cell(s: PlanState): number;
  isGoal(s: PlanState): boolean;
  heuristic(s: PlanState): number;
  between(a: PlanState, b: PlanState): number;
  successors(s: PlanState): Work<PlanEdge[]>;
  predecessors(s: PlanState): Work<PlanEdge[]>;
  goals(): Work<PlanState[]>;
  finish(s: PlanState): Action[];
}
export const stateKey = (s: PlanState) => `${s.cell}|${s.energy}|${s.mask}|${s.inventory}|${s.supply}|${s.boxes.join(",")}`;
const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
const regionCache = new WeakMap<LevelDefinition, number[]>();
function regionsFor(l: LevelDefinition) {
  let regions = regionCache.get(l);
  if (regions) return regions;
  regions = Array<number>(l.board.terrain.length).fill(-1);
  let region = 0;
  for (let c = 0; c < regions.length; c++)
    if (regions[c] === -1 && isWalkable(l.board.terrain[c])) {
      const queue = [c];
      regions[c] = region;
      for (let h = 0; h < queue.length; h++)
        for (const n of adjacent(queue[h], l.board.width, l.board.height))
          if (regions[n] === -1 && isWalkable(l.board.terrain[n])) {
            regions[n] = region;
            queue.push(n);
          }
      region++;
    }
  regionCache.set(l, regions);
  return regions;
}
export class ModeDomain implements PlanningDomain {
  start: PlanState;
  target: Objective;
  preparation = 1;
  private width: number;
  private height: number;
  private dead: Set<number>;
  private docks: Set<number>;
  private gate = new Map<number, number>();
  private bridge = new Map<number, number>();
  private fixedBoxes = new Set<number>();
  constructor(
    readonly level: LevelDefinition,
    readonly world: RuleWorld,
    readonly bot: RuleBot,
    readonly visits: ReadonlyMap<number, number> = new Map(),
    failed: ReadonlySet<string> = new Set()
  ) {
    this.width = level.board.width;
    this.height = level.board.height;
    const s = world.modeState;
    this.start = {
      cell: cellOf(bot, this.width),
      energy: level.mode === "energy" ? bot.energy : 0,
      mask: s.mode === "circuit" ? s.mask : s.mode === "bridge" ? s.builtMask : 0,
      inventory: level.mode === "bridge" ? bot.inventory : 0,
      supply: s.mode === "bridge" ? s.suppliesReady.reduce((mask, t, i) => (t <= world.tick ? mask | (1 << i) : mask), 0) : 0,
      boxes: s.mode === "crates" ? sorted(s.boxes.map((b) => b.cell)) : [],
    };
    this.dead = new Set(s.mode === "crates" ? s.deadCells : []);
    this.docks = new Set(level.mode === "crates" ? level.crates.docks.map((p) => cellOf(p, this.width)) : []);
    if (level.mode === "circuit") level.circuit.switches.forEach((v, i) => v.gates.forEach((p) => this.gate.set(cellOf(p, this.width), i)));
    if (level.mode === "bridge") level.bridge.spans.forEach((v, i) => v.cells.forEach((p) => this.bridge.set(cellOf(p, this.width), i)));
    const objectives = this.objectives().filter((o) => !failed.has(o.id));
    this.target = objectives[0] ?? { id: "idle", cell: this.start.cell, kind: "wait", tick: world.tick + 8 };
    if (level.mode === "crates") this.fixedBoxes = new Set(this.start.boxes.filter((c) => c !== this.target.object));
  }
  key = stateKey;
  cell(s: PlanState) {
    return s.cell;
  }
  private manhattan(a: number, b: number) {
    return Math.abs((a % this.width) - (b % this.width)) + Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
  }
  private objectives(): Objective[] {
    const l = this.level,
      w = this.world,
      s = w.modeState,
      from = this.start.cell;
    const candidates: (Objective & { value: number })[] = [];
    const add = (o: Objective, value: number) => candidates.push({ ...o, value });
    if (l.mode === "fog") return [{ id: "exit", cell: cellOf(l.board.goal!, this.width), kind: "visit" }];
    if (l.mode === "crates") {
      for (const box of this.start.boxes)
        if (!this.docks.has(box))
          for (const dock of this.docks)
            if (!this.start.boxes.includes(dock))
              add({ id: `crate:${box}:${dock}`, cell: dock, kind: "crates", object: box }, -this.manhattan(box, dock) * 2 - this.manhattan(from, box));
    }
    if (l.mode === "collapse" && s.mode === "collapse")
      for (let c = 0; c < w.terrain.length; c++) {
        this.preparation++;
        if (c === from || !isWalkable(w.terrain[c])) continue;
        const at = s.dangerAt[c] || l.timeLimit + 1;
        if (at <= w.tick + this.manhattan(from, c) * 4 + 16) continue;
        add({ id: `safe:${c}`, cell: c, kind: "visit" }, at - w.tick - this.manhattan(from, c) * 6 - (this.visits.get(c) ?? 0) * 12);
      }
    if (l.mode === "hunt" && s.mode === "hunt")
      s.targets.forEach((t, i) => {
        const def = l.hunt.targets[i],
          route = def.route;
        for (let n = 0; n < route.length; n++) {
          this.preparation++;
          const c = cellOf(route[n], this.width),
            travel = this.manhattan(from, c) * 4 + 8;
          let at = t.active
            ? t.nextMove + ((n - t.routeIndex - 1 + route.length) % route.length) * def.stepTicks
            : t.respawnAt + ((n - t.routeIndex - 1 + route.length) % route.length) * def.stepTicks;
          while (at < w.tick + travel) at += route.length * def.stepTicks;
          add({ id: `hunt:${i}:${n}`, cell: c, kind: "wait", object: i, tick: at }, -Math.max(travel, at - w.tick) - this.manhattan(from, c));
        }
      });
    if (l.mode === "circuit" && s.mode === "circuit") {
      const c = l.circuit.contracts[s.contract];
      if (c) return [{ id: `contract:${s.contract}`, cell: cellOf(c, this.width), kind: "claim", object: s.contract, mask: c.mask }];
    }
    if (l.mode === "energy" && s.mode === "energy") {
      const remaining = l.energy.beacons.flatMap((p, i) => (!s.owners[i] ? [{ cell: cellOf(p, this.width), i }] : []));
      for (const beacon of remaining) {
        this.preparation++;
        const d = this.manhattan(from, beacon.cell);
        if (this.start.energy >= 14 + d) add({ id: `beacon:${beacon.i}`, cell: beacon.cell, kind: "claim", object: beacon.i }, 3 / (d + 3));
      }
      for (const [i, p] of l.energy.chargers.entries()) {
        this.preparation++;
        const cell = cellOf(p, this.width);
        if (cell === from && this.start.energy === 24) continue;
        const toward = remaining.length ? Math.min(...remaining.map((b) => this.manhattan(cell, b.cell))) : 0;
        add({ id: `charger:${i}`, cell, kind: "charge", object: i }, 0.08 / (this.manhattan(from, cell) + 3 + toward * 0.25));
      }
    }
    if (l.mode === "bridge" && s.mode === "bridge") {
      const regions = regionsFor(l),
        reachable = new Set([regions[from]]);
      for (let pass = 0; pass < l.bridge.spans.length; pass++)
        for (const [i, span] of l.bridge.spans.entries())
          if (s.builtMask & (1 << i)) {
            const [a, b] = span.banks.map((p) => regions[cellOf(p, this.width)]);
            if (reachable.has(a) || reachable.has(b)) {
              reachable.add(a);
              reachable.add(b);
            }
          }
      const accessible = (cell: number) => reachable.has(regions[cell]);
      l.bridge.markers.forEach((p, i) => {
        this.preparation++;
        if (!s.owners[i] && accessible(cellOf(p, this.width)))
          add({ id: `marker:${i}`, cell: cellOf(p, this.width), kind: "claim", object: i }, 3 / (this.manhattan(from, cellOf(p, this.width)) + 4));
      });
      if (s.owners.every(Boolean) && accessible(cellOf(l.board.goal!, this.width)))
        add({ id: "exit", cell: cellOf(l.board.goal!, this.width), kind: "claim", object: -1 }, 5 / (this.manhattan(from, cellOf(l.board.goal!, this.width)) + 8));
      l.bridge.spans.forEach((span, i) => {
        if (s.builtMask & (1 << i) || span.cells.length > this.start.inventory) return;
        for (const p of span.banks) {
          this.preparation++;
          if (!accessible(cellOf(p, this.width))) continue;
          add(
            { id: `build:${i}:${cellOf(p, this.width)}`, cell: cellOf(p, this.width), kind: "build", object: i },
            2 / (this.manhattan(from, cellOf(p, this.width)) + 4 + Math.max(0, span.cells.length - this.start.inventory) * 7)
          );
        }
      });
      l.bridge.supplies.forEach((p, i) => {
        this.preparation++;
        const cell = cellOf(p, this.width);
        if (accessible(cell) && s.suppliesReady[i] <= w.tick && this.start.inventory < 3)
          add({ id: `collect:${i}`, cell, kind: "collect", object: i }, 0.9 / (this.manhattan(from, cell) + 3));
      });
      if (!candidates.length) {
        const supplies = l.bridge.supplies
          .flatMap((p, i) => (accessible(cellOf(p, this.width)) ? [{ cell: cellOf(p, this.width), i }] : []))
          .sort((a, b) => this.manhattan(from, a.cell) - this.manhattan(from, b.cell));
        if (supplies[0]) return [{ id: `supply-wait:${supplies[0].i}`, kind: "wait", cell: supplies[0].cell, tick: s.suppliesReady[supplies[0].i] }];
      }
    }
    return candidates.sort((a, b) => b.value - a.value || seededHash(a.id + this.bot.algorithm, l.seed) - seededHash(b.id + this.bot.algorithm, l.seed));
  }
  private walkable(c: number, s: PlanState) {
    if (c < 0 || c >= this.world.terrain.length) return false;
    const gate = this.gate.get(c);
    if (gate !== undefined) return !!(s.mask & (1 << gate)) || (c === this.start.cell && isWalkable(this.world.terrain[c]));
    const span = this.bridge.get(c);
    if (span !== undefined) return !!(s.mask & (1 << span));
    return isWalkable(this.world.terrain[c]);
  }
  isGoal(s: PlanState) {
    if (this.target.kind === "crates") return s.boxes.includes(this.target.cell) && adjacent(this.target.cell, this.width, this.height).includes(s.cell);
    if (this.level.mode === "energy") return s.cell === this.target.cell && s.energy >= (this.target.kind === "charge" ? 24 : 14);
    if (s.cell !== this.target.cell) return false;
    if (this.level.mode === "circuit") return s.mask === this.target.mask;
    if (this.level.mode === "bridge" && this.target.kind === "build")
      return !(s.mask & (1 << this.target.object!)) && s.inventory >= this.level.bridge.spans[this.target.object!].cells.length;
    return true;
  }
  heuristic(s: PlanState) {
    if (this.target.kind === "crates") {
      const box = s.boxes.find((c) => !this.fixedBoxes.has(c));
      return box === undefined ? 0 : this.manhattan(box, this.target.cell) * 8 + Math.max(0, this.manhattan(s.cell, box) - 1) * 4;
    }
    if (this.level.mode === "circuit") {
      const required = this.level.circuit.switches.flatMap((p, i) => ((s.mask ^ this.target.mask!) & (1 << i) ? [cellOf(p, this.width)] : []));
      const tour = (from: number, left: number[]): number =>
        left.length
          ? Math.min(
              ...left.map(
                (c, i) =>
                  this.manhattan(from, c) * 4 +
                  4 +
                  tour(
                    c,
                    left.filter((_, j) => i !== j)
                  )
              )
            )
          : this.manhattan(from, this.target.cell) * 4;
      return tour(s.cell, required);
    }
    return this.manhattan(s.cell, this.target.cell) * 4;
  }
  between(a: PlanState, b: PlanState) {
    const walk = this.manhattan(a.cell, b.cell) * 4,
      pop = (n: number) => n.toString(2).replace(/0/g, "").length;
    if (this.level.mode === "circuit") return walk + pop(a.mask ^ b.mask) * 4;
    if (this.level.mode === "energy") return Math.max(walk, Math.max(0, a.energy - b.energy) * 4) + Math.ceil(Math.max(0, b.energy - a.energy) / 4);
    if (this.level.mode === "bridge") {
      const spans = this.level.bridge.spans,
        resources = (s: PlanState) => s.inventory + spans.reduce((sum, span, i) => sum + (s.mask & (1 << i) ? span.cells.length : 0), 0);
      return walk + pop(a.mask ^ b.mask) * 12 + Math.max(Math.max(0, resources(b) - resources(a)) * 4, pop(a.supply ^ b.supply) * 4);
    }
    if (this.level.mode === "crates") {
      const match = (xs: number[], ys: number[]): number =>
        xs.length
          ? Math.min(
              ...ys.map(
                (y, i) =>
                  this.manhattan(xs[0], y) +
                  match(
                    xs.slice(1),
                    ys.filter((_, j) => i !== j)
                  )
              )
            )
          : 0;
      return Math.max(walk, match(a.boxes, b.boxes) * 8);
    }
    return walk;
  }
  finish(s: PlanState): Action[] {
    const t = this.target;
    if (this.level.mode === "energy" && this.target.kind === "charge") return [];
    if (t.kind === "visit" || t.kind === "crates") return [];
    if (t.kind === "wait") return [{ kind: "wait", from: s.cell, to: s.cell, duration: Math.max(1, Math.min(16, (t.tick ?? this.world.tick + 8) - this.world.tick)) }];
    return [{ kind: t.kind, from: s.cell, to: s.cell, duration: t.kind === "build" ? 12 : 4, object: t.object }];
  }
  *successors(s: PlanState): Work<PlanEdge[]> {
    const out: PlanEdge[] = [],
      l = this.level,
      w = this.world;
    const add = (state: PlanState, action: Action) => out.push({ state, action: l.mode === "energy" ? { ...action, energyAfter: state.energy } : action, cost: action.duration });
    for (const to of adjacent(s.cell, this.width, this.height)) {
      yield;
      if (!this.walkable(to, s)) continue;
      const box = s.boxes.indexOf(to);
      let kind: Action["kind"] = "move",
        object: number | undefined,
        cost = terrainCost(w.terrain[to]) * 4,
        next: PlanState = { ...s, cell: to };
      if (box >= 0) {
        const dest = 2 * to - s.cell;
        if (
          this.fixedBoxes.has(to) ||
          this.docks.has(to) ||
          !adjacent(to, this.width, this.height).includes(dest) ||
          !this.walkable(dest, s) ||
          s.boxes.includes(dest) ||
          this.dead.has(dest)
        )
          continue;
        kind = "push";
        object = to;
        const boxes = [...s.boxes];
        boxes[box] = dest;
        next.boxes = sorted(boxes);
        cost = Math.max(8, terrainCost(w.terrain[dest]) * 4);
      }
      if (l.mode === "energy") {
        const energy = s.energy - terrainCost(w.terrain[to]);
        if (energy < 0 || (!energy && !l.energy.chargers.some((p) => cellOf(p, this.width) === to))) continue;
        next.energy = energy;
      }
      if (
        w.modeState.mode === "collapse" &&
        [s.cell, to].some((c) => w.modeState.mode === "collapse" && w.modeState.dangerAt[c] > 0 && w.modeState.dangerAt[c] <= w.tick + cost + 8)
      )
        continue;
      add(next, { kind, from: s.cell, to, duration: cost, ...(object === undefined ? {} : { object }) });
      yield;
    }
    if (l.mode === "circuit")
      for (const [i, p] of l.circuit.switches.entries()) {
        yield;
        if (cellOf(p, this.width) === s.cell)
          add({ ...s, mask: s.mask ^ (1 << i) }, { kind: "toggle", from: s.cell, to: s.cell, duration: 4, object: i, expected: s.mask & (1 << i) ? 0 : 1 });
      }
    if (l.mode === "energy" && s.energy < 24 && w.modeState.mode === "energy")
      for (const [i, c] of w.modeState.chargers.entries()) {
        yield;
        if (c.cell === s.cell && c.stock > 0)
          add({ ...s, energy: Math.min(24, s.energy + Math.min(4, c.stock)) }, { kind: "charge", from: s.cell, to: s.cell, duration: 1, object: i });
      }
    if (l.mode === "bridge" && this.target.kind === "visit") {
      for (const [i, p] of l.bridge.supplies.entries()) {
        yield;
        if (cellOf(p, this.width) === s.cell && s.inventory < 3 && s.supply & (1 << i))
          add({ ...s, inventory: s.inventory + 1, supply: s.supply & ~(1 << i) }, { kind: "collect", from: s.cell, to: s.cell, duration: 4, object: i });
      }
      for (const [i, span] of l.bridge.spans.entries()) {
        yield;
        if (!(s.mask & (1 << i)) && s.inventory >= span.cells.length && span.banks.some((p) => cellOf(p, this.width) === s.cell))
          add({ ...s, mask: s.mask | (1 << i), inventory: s.inventory - span.cells.length }, { kind: "build", from: s.cell, to: s.cell, duration: 12, object: i });
      }
    }
    return out;
  }
  *predecessors(s: PlanState): Work<PlanEdge[]> {
    const out: PlanEdge[] = [],
      l = this.level,
      w = this.world;
    const add = (state: PlanState, action: Action) => out.push({ state, action, cost: action.duration });
    for (const from of adjacent(s.cell, this.width, this.height)) {
      yield;
      const prev = { ...s, cell: from };
      if (l.mode === "energy") prev.energy = s.energy + terrainCost(w.terrain[s.cell]);
      const cost = terrainCost(w.terrain[s.cell]) * 4;
      if (
        prev.energy <= 24 &&
        !s.boxes.includes(from) &&
        !s.boxes.includes(s.cell) &&
        this.walkable(from, prev) &&
        this.walkable(s.cell, prev) &&
        !(l.mode === "energy" && !s.energy && !l.energy.chargers.some((p) => cellOf(p, this.width) === s.cell)) &&
        !(
          w.modeState.mode === "collapse" &&
          [from, s.cell].some((c) => w.modeState.mode === "collapse" && w.modeState.dangerAt[c] > 0 && w.modeState.dangerAt[c] <= w.tick + cost + 8)
        )
      )
        add(prev, { kind: "move", from, to: s.cell, duration: cost });
      if (l.mode === "crates") {
        const dest = 2 * s.cell - from,
          idx = s.boxes.indexOf(dest);
        if (
          idx >= 0 &&
          !this.fixedBoxes.has(dest) &&
          !this.docks.has(s.cell) &&
          !this.dead.has(dest) &&
          adjacent(s.cell, this.width, this.height).includes(dest) &&
          !s.boxes.includes(from) &&
          !s.boxes.includes(s.cell) &&
          this.walkable(from, s) &&
          this.walkable(s.cell, s)
        ) {
          const boxes = [...s.boxes];
          boxes[idx] = s.cell;
          add({ ...s, cell: from, boxes: sorted(boxes) }, { kind: "push", from, to: s.cell, duration: Math.max(8, terrainCost(w.terrain[dest]) * 4), object: s.cell });
        }
      }
    }
    if (l.mode === "circuit")
      for (const [i, p] of l.circuit.switches.entries()) {
        yield;
        if (cellOf(p, this.width) === s.cell)
          add({ ...s, mask: s.mask ^ (1 << i) }, { kind: "toggle", from: s.cell, to: s.cell, duration: 4, object: i, expected: s.mask & (1 << i) ? 1 : 0 });
      }
    if (l.mode === "energy") {
      if (w.modeState.mode === "energy") {
        const i = w.modeState.chargers.findIndex((c) => c.cell === s.cell),
          c = w.modeState.chargers[i];
        if (c && c.stock > 0)
          for (let energy = Math.max(0, s.energy - 4); energy < s.energy; energy++) {
            yield;
            if (Math.min(24, energy + Math.min(4, c.stock)) === s.energy) add({ ...s, energy }, { kind: "charge", from: s.cell, to: s.cell, duration: 1, object: i });
          }
      }
    }
    if (l.mode === "bridge" && this.target.kind === "visit") {
      for (const [i, p] of l.bridge.supplies.entries()) {
        yield;
        if (cellOf(p, this.width) === s.cell && s.inventory > 0 && !(s.supply & (1 << i)) && this.start.supply & (1 << i))
          add({ ...s, inventory: s.inventory - 1, supply: s.supply | (1 << i) }, { kind: "collect", from: s.cell, to: s.cell, duration: 4, object: i });
      }
      for (const [i, span] of l.bridge.spans.entries()) {
        yield;
        if (s.mask & (1 << i) && !(this.start.mask & (1 << i)) && s.inventory + span.cells.length <= 3 && span.banks.some((p) => cellOf(p, this.width) === s.cell))
          add({ ...s, mask: s.mask & ~(1 << i), inventory: s.inventory + span.cells.length }, { kind: "build", from: s.cell, to: s.cell, duration: 12, object: i });
      }
    }
    return out;
  }
  *goals(): Work<PlanState[]> {
    const base = { ...this.start, cell: this.target.cell },
      out: PlanState[] = [];
    const take = (s: PlanState) => {
      if (this.isGoal(s) && this.walkable(s.cell, s) && !s.boxes.includes(s.cell)) out.push(s);
    };
    if (this.level.mode === "crates") {
      const boxes = sorted([...this.fixedBoxes, this.target.cell]);
      for (const cell of adjacent(this.target.cell, this.width, this.height)) {
        const behind = 2 * cell - this.target.cell;
        if (adjacent(cell, this.width, this.height).includes(behind) && this.walkable(behind, base) && !boxes.includes(behind)) take({ ...base, cell, boxes });
        yield;
      }
    } else if (this.level.mode === "energy") {
      for (let energy = this.target.kind === "charge" ? 24 : 14; energy <= 24; energy++) {
        take({ ...base, energy });
        yield;
      }
    } else if (this.level.mode === "circuit") {
      take({ ...base, mask: this.target.mask! });
      yield;
    } else if (this.level.mode === "bridge") {
      if (this.target.kind !== "visit") {
        take(base);
        yield;
        return out;
      }
      const regions = regionsFor(this.level),
        from = regions[this.start.cell],
        to = regions[this.target.cell];
      for (let mask = 0; mask < 1 << this.level.bridge.spans.length; mask++) {
        if ((mask & this.start.mask) !== this.start.mask) continue;
        const reachable = new Set([from]);
        for (let pass = 0; pass < this.level.bridge.spans.length; pass++)
          for (const [i, span] of this.level.bridge.spans.entries())
            if (mask & (1 << i)) {
              const [a, b] = span.banks.map((p) => regions[cellOf(p, this.width)]);
              if (reachable.has(a) || reachable.has(b)) {
                reachable.add(a);
                reachable.add(b);
              }
            }
        yield;
        if (!reachable.has(to)) continue;
        const spent = this.level.bridge.spans.reduce((sum, span, i) => sum + (mask & (1 << i) && !(this.start.mask & (1 << i)) ? span.cells.length : 0), 0);
        for (let supply = this.start.supply; ; supply = (supply - 1) & this.start.supply) {
          const collected = (this.start.supply & ~supply).toString(2).replace(/0/g, "").length,
            inventory = this.start.inventory + collected - spent;
          if (inventory >= 0 && inventory <= 3) take({ ...base, mask, supply, inventory });
          yield;
          if (!supply) break;
        }
      }
    } else {
      take(base);
      yield;
    }
    return out;
  }
  private bridgeDistance(s: PlanState) {
    if (this.level.mode !== "bridge") return this.manhattan(s.cell, this.target.cell);
    const l = this.level;
    const regions = regionsFor(l);
    const startRegion = regions[s.cell],
      endRegion = regions[this.target.cell];
    const distances = new Map<number, number>([[startRegion, 0]]),
      paths = new Map<number, number[]>();
    const queue = [startRegion];
    while (queue.length) {
      queue.sort((a, b) => distances.get(a)! - distances.get(b)!);
      const current = queue.shift()!;
      for (const [i, span] of l.bridge.spans.entries()) {
        const [a, b] = span.banks.map((p) => regions![cellOf(p, this.width)]);
        if (a !== current && b !== current) continue;
        const next = a === current ? b : a,
          cost = distances.get(current)! + (s.mask & (1 << i) ? 0 : 1);
        if (cost < (distances.get(next) ?? Infinity)) {
          distances.set(next, cost);
          paths.set(next, [...(paths.get(current) ?? []), i]);
          queue.push(next);
        }
      }
    }
    const path = paths.get(endRegion) ?? [],
      first = path.find((i) => !(s.mask & (1 << i)));
    if (first === undefined) return this.manhattan(s.cell, this.target.cell);
    const span = l.bridge.spans[first];
    const bank = span.banks.map((p) => cellOf(p, this.width)).sort((a, b) => this.manhattan(s.cell, a) - this.manhattan(s.cell, b))[0];
    const rest = this.manhattan(bank, this.target.cell) + (distances.get(endRegion) ?? 1) * 3;
    if (s.inventory >= span.cells.length) return this.manhattan(s.cell, bank) + rest;
    const supplies = l.bridge.supplies.flatMap((p, i) => (s.supply & (1 << i) ? [cellOf(p, this.width)] : []));
    return Math.min(...supplies.map((c) => this.manhattan(s.cell, c) + this.manhattan(c, bank) + span.cells.length - s.inventory), 100) + rest;
  }
  utility(s: PlanState) {
    let value = -this.heuristic(s) / Math.max(4, (this.width + this.height) * 4);
    if (this.level.mode === "bridge") value = -this.bridgeDistance(s) / (this.width + this.height);
    if (this.isGoal(s)) value += 2;
    if (this.level.mode === "energy") value += s.energy / 96;
    if (this.level.mode === "bridge") value += s.inventory * 0.06;
    if (this.level.mode === "crates") value += s.boxes.filter((c) => this.docks.has(c)).length * 0.6;
    if (this.world.modeState.mode === "collapse") value += ((this.world.modeState.dangerAt[s.cell] || 1201) - this.world.tick) / 1200;
    return value - (this.visits.get(s.cell) ?? 0) * 0.015;
  }
  debugPoint(s: PlanState) {
    return pointOf(s.cell, this.width);
  }
}
