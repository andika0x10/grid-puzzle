import type { AlgorithmId } from "./algorithms";
import { adjacent, pointOf, type Action } from "./modes";
import { isWalkable, terrainCost, type Point, type Terrain } from "./schema";
import { type PlanState, type PlanningDomain, type Work } from "./planning";
export const SEARCH_OPERATIONS_PER_TICK = 64;
export interface Search {
  done: boolean;
  path: Point[] | null;
  actions: Action[] | null;
  expanded: number;
  memory: number;
  operations: number;
  visited: Set<number>;
  frontier(): number[];
  advance(budget: number): number;
  step(): void;
  updateDomain?(domain: PlanningDomain, changed?: ReadonlySet<number>): void;
}
export abstract class MeteredSearch implements Search {
  done = false;
  path: Point[] | null = null;
  actions: Action[] | null = null;
  expanded = 0;
  memory = 1;
  operations = 0;
  visited = new Set<number>();
  protected work: Work | null = null;
  abstract frontier(): number[];
  protected abstract run(): Work;
  advance(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) throw new Error("Anggaran harus berupa angka nonnegatif.");
    if (this.done) return 0;
    this.work ??= this.run();
    let used = 0;
    while (!this.done && used < Math.floor(budget)) {
      if (this.work.next().done) this.done = true;
      else {
        used++;
        this.operations++;
      }
    }
    return used;
  }
  step() {
    this.advance(SEARCH_OPERATIONS_PER_TICK);
  }
  protected *complete(actions: Action[] | null, width: number, start: number): Work {
    this.actions = actions;
    if (actions) {
      this.path = [pointOf(start, width)];
      for (const a of actions) {
        if (a.to !== a.from) this.path.push(pointOf(a.to, width));
        yield;
      }
    }
    this.done = true;
    yield;
  }
}
interface Entry {
  key: string;
  a: number;
  b: number;
  order: number;
}
export class IndexedQueue {
  private items: Entry[] = [];
  private positions = new Map<string, number>();
  private sequence = 0;
  get size() {
    return this.items.length;
  }
  keys() {
    return this.items.map((e) => e.key);
  }
  peek() {
    return this.items[0];
  }
  private *less(a: Entry, b: Entry): Work<boolean> {
    yield;
    return a.a < b.a || (a.a === b.a && (a.b < b.b || (a.b === b.b && a.order < b.order)));
  }
  private *swap(a: number, b: number): Work {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    this.positions.set(this.items[a].key, a);
    this.positions.set(this.items[b].key, b);
    yield;
  }
  private *up(index: number): Work<number> {
    while (index > 0) {
      const p = (index - 1) >> 1;
      if (!(yield* this.less(this.items[index], this.items[p]))) break;
      yield* this.swap(index, p);
      index = p;
    }
    return index;
  }
  private *down(index: number): Work {
    while (true) {
      const left = index * 2 + 1,
        right = left + 1;
      let best = index;
      if (left < this.items.length && (yield* this.less(this.items[left], this.items[best]))) best = left;
      if (right < this.items.length && (yield* this.less(this.items[right], this.items[best]))) best = right;
      if (best === index) break;
      yield* this.swap(index, best);
      index = best;
    }
  }
  *set(key: string, a: number, b = 0): Work {
    const existing = this.positions.get(key);
    if (existing !== undefined) {
      this.items[existing].a = a;
      this.items[existing].b = b;
      yield;
      const i = yield* this.up(existing);
      yield* this.down(i);
    } else {
      const i = this.items.length;
      this.items.push({ key, a, b, order: this.sequence++ });
      this.positions.set(key, i);
      yield;
      yield* this.up(i);
    }
  }
  *remove(key: string): Work {
    const i = this.positions.get(key);
    yield;
    if (i === undefined) return;
    this.positions.delete(key);
    const last = this.items.pop()!;
    if (i < this.items.length) {
      this.items[i] = last;
      this.positions.set(last.key, i);
      yield;
      const n = yield* this.up(i);
      yield* this.down(n);
    }
  }
  *pop(): Work<Entry | undefined> {
    const entry = this.peek();
    if (entry) yield* this.remove(entry.key);
    else yield;
    return entry;
  }
}
export class DomainSearch extends MeteredSearch {
  private heap = new IndexedQueue();
  private buckets = new Map<number, string[]>();
  private bucketHeads = new Map<number, number>();
  private bucketSize = 0;
  private minimum = 0;
  private queue: string[] = [];
  private head = 0;
  private nodes = new Map<string, PlanState>();
  private scores = new Map<string, number>();
  private parents = new Map<string, { key: string; action: Action }>();
  constructor(
    readonly domain: PlanningDomain,
    private algorithm: AlgorithmId,
    private width: number
  ) {
    super();
  }
  frontier() {
    const keys =
      this.algorithm === "dijkstra"
        ? [...this.buckets.entries()].flatMap(([n, q]) => q.slice(this.bucketHeads.get(n) ?? 0))
        : this.algorithm === "dfs"
          ? this.queue
          : this.algorithm === "bfs"
            ? this.queue.slice(this.head)
            : this.heap.keys();
    return [...new Set(keys.map((k) => this.domain.cell(this.nodes.get(k)!)))];
  }
  private *push(state: PlanState, g: number): Work {
    const key = this.domain.key(state);
    this.nodes.set(key, state);
    if (this.algorithm === "dijkstra") {
      const bucket = this.buckets.get(g) ?? [];
      bucket.push(key);
      this.buckets.set(g, bucket);
      this.bucketSize++;
      this.minimum = Math.min(this.minimum, g);
      yield;
    } else if (this.algorithm === "dfs" || this.algorithm === "bfs") {
      this.queue.push(key);
      yield;
    } else {
      const h = this.domain.heuristic(state);
      yield;
      const priority = this.algorithm === "greedy" ? h : g + h * (this.algorithm === "weighted-astar" ? 1.5 : 1);
      yield* this.heap.set(key, priority, h);
    }
  }
  private *pop(): Work<string | undefined> {
    if (this.algorithm === "dijkstra") {
      while (this.bucketSize) {
        const q = this.buckets.get(this.minimum),
          head = this.bucketHeads.get(this.minimum) ?? 0;
        yield;
        if (q && head < q.length) {
          const key = q[head];
          this.bucketHeads.set(this.minimum, head + 1);
          this.bucketSize--;
          if (this.scores.get(key) === this.minimum) return key;
        } else {
          this.buckets.delete(this.minimum);
          this.bucketHeads.delete(this.minimum);
          this.minimum++;
        }
      }
      return undefined;
    }
    if (this.algorithm === "dfs" || this.algorithm === "bfs") {
      yield;
      return this.algorithm === "dfs" ? this.queue.pop() : this.queue[this.head++];
    }
    return (yield* this.heap.pop())?.key;
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    const start = this.domain.key(this.domain.start);
    this.scores.set(start, 0);
    yield* this.push(this.domain.start, 0);
    while (true) {
      const key = yield* this.pop();
      if (key === undefined) {
        yield* this.complete(null, this.width, this.domain.start.cell);
        return;
      }
      const state = this.nodes.get(key)!,
        g = this.scores.get(key)!;
      this.expanded++;
      this.visited.add(state.cell);
      yield;
      if (this.domain.isGoal(state)) {
        const actions: Action[] = [];
        let current = key;
        while (current !== start) {
          const p = this.parents.get(current)!;
          actions.push(p.action);
          current = p.key;
          yield;
        }
        actions.reverse();
        actions.push(...this.domain.finish(state));
        yield* this.complete(actions, this.width, this.domain.start.cell);
        return;
      }
      const edges = yield* this.domain.successors(state);
      if (this.algorithm === "dfs") edges.reverse();
      for (const edge of edges) {
        const next = this.domain.key(edge.state),
          score = g + edge.cost,
          old = this.scores.get(next);
        yield;
        const relax = old === undefined || (!["dfs", "bfs", "greedy"].includes(this.algorithm) && score < old);
        yield;
        if (relax) {
          this.scores.set(next, score);
          this.parents.set(next, { key, action: edge.action });
          yield* this.push(edge.state, score);
        }
      }
      this.memory = Math.max(this.memory, this.nodes.size + this.parents.size + this.heap.size + this.bucketSize + this.queue.length - this.head);
    }
  }
}
// Backward D* Lite on mode-specific directed state graphs. Only materialized
// vertices near changed cells need repair; queue entries are updated in place.
export class DStarLiteSearch extends MeteredSearch {
  private g = new Map<string, number>();
  private rhs = new Map<string, number>();
  private nodes = new Map<string, PlanState>();
  private cells = new Map<number, Set<string>>();
  private queue = new IndexedQueue();
  private initialized = false;
  private km = 0;
  private dirty = new Set<string>();
  private pending: { domain: PlanningDomain; changed: ReadonlySet<number> } | null = null;
  private goals = new Set<string>();
  constructor(
    private domain: PlanningDomain,
    private width: number
  ) {
    super();
    this.register(domain.start);
  }
  private register(s: PlanState) {
    const key = this.domain.key(s);
    if (!this.nodes.has(key)) {
      this.nodes.set(key, s);
      const keys = this.cells.get(s.cell) ?? new Set<string>();
      keys.add(key);
      this.cells.set(s.cell, keys);
    }
    return key;
  }
  private value(map: Map<string, number>, key: string) {
    return map.get(key) ?? Infinity;
  }
  private priority(key: string): [number, number] {
    const v = Math.min(this.value(this.g, key), this.value(this.rhs, key));
    return [v + this.domain.between(this.domain.start, this.nodes.get(key)!) + this.km, v];
  }
  private before(a: [number, number], b: [number, number]) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  private *queueVertex(key: string): Work {
    if (this.value(this.g, key) !== this.value(this.rhs, key)) {
      const [a, b] = this.priority(key);
      yield* this.queue.set(key, a, b);
    } else yield* this.queue.remove(key);
  }
  private *updateVertex(key: string): Work {
    if (!this.goals.has(key)) {
      let best = Infinity;
      for (const e of yield* this.domain.successors(this.nodes.get(key)!)) {
        const next = this.register(e.state);
        best = Math.min(best, e.cost + this.value(this.g, next));
        yield;
      }
      this.rhs.set(key, best);
    }
    yield* this.queueVertex(key);
  }
  frontier() {
    return [...new Set(this.queue.keys().map((k) => this.nodes.get(k)!.cell))];
  }
  updateDomain(domain: PlanningDomain, changed: ReadonlySet<number> = new Set()) {
    const reset =
      domain.target.id !== this.domain.target.id ||
      domain.target.mask !== this.domain.target.mask ||
      domain.start.supply !== this.domain.start.supply ||
      domain.navigationVersion !== this.domain.navigationVersion;
    if (!reset && !this.done && this.work) {
      const union = new Set([...(this.pending?.changed ?? []), ...changed]);
      this.pending = { domain, changed: union };
      return;
    }
    if (reset) {
      this.g.clear();
      this.rhs.clear();
      this.nodes.clear();
      this.cells.clear();
      this.queue = new IndexedQueue();
      this.goals.clear();
      this.dirty.clear();
      this.initialized = false;
      this.km = 0;
    } else {
      this.km += domain.between(this.domain.start, domain.start);
      for (const c of changed) for (const near of [c, c - 1, c + 1, c - this.width, c + this.width]) for (const key of this.cells.get(near) ?? []) this.dirty.add(key);
    }
    this.domain = domain;
    this.register(domain.start);
    this.done = false;
    this.path = null;
    this.actions = null;
    this.work = null;
    this.visited.clear();
    this.pending = null;
  }
  advance(budget: number) {
    const used = super.advance(budget);
    if (this.done && this.pending) {
      const pending = this.pending;
      this.pending = null;
      this.updateDomain(pending.domain, pending.changed);
    }
    return used;
  }
  protected *run(): Work {
    if (!this.initialized) {
      for (let i = 0; i < this.domain.preparation; i++) yield;
      for (const state of yield* this.domain.goals()) {
        const key = this.register(state);
        this.goals.add(key);
        this.rhs.set(key, 0);
        yield* this.queueVertex(key);
      }
      this.initialized = true;
    }
    // A newly enabled edge can introduce a predecessor that never existed in
    // the materialized graph (for example an empty station gaining charge).
    // Updating only old vertices would leave that connection undiscovered.
    const repaired = new Set<string>();
    for (const key of this.dirty) {
      if (!repaired.has(key)) {
        yield* this.updateVertex(key);
        repaired.add(key);
      }
      for (const edge of yield* this.domain.predecessors(this.nodes.get(key)!)) {
        const predecessor = this.register(edge.state);
        if (!repaired.has(predecessor)) {
          yield* this.updateVertex(predecessor);
          repaired.add(predecessor);
        }
      }
    }
    this.dirty.clear();
    const start = this.register(this.domain.start);
    while (true) {
      const top = this.queue.peek(),
        wanted = this.priority(start);
      yield;
      if ((!top || !this.before([top.a, top.b], wanted)) && this.value(this.rhs, start) === this.value(this.g, start)) break;
      if (!top) break;
      yield* this.queue.pop();
      const updated = this.priority(top.key);
      if (this.before([top.a, top.b], updated)) {
        yield* this.queue.set(top.key, ...updated);
        continue;
      }
      const u = top.key,
        old = this.value(this.g, u);
      this.expanded++;
      this.visited.add(this.nodes.get(u)!.cell);
      yield;
      if (old > this.value(this.rhs, u)) {
        this.g.set(u, this.value(this.rhs, u));
        for (const e of yield* this.domain.predecessors(this.nodes.get(u)!)) {
          const p = this.register(e.state);
          if (!this.goals.has(p)) this.rhs.set(p, Math.min(this.value(this.rhs, p), e.cost + this.value(this.g, u)));
          yield* this.queueVertex(p);
        }
      } else {
        this.g.set(u, Infinity);
        yield* this.updateVertex(u);
        for (const e of yield* this.domain.predecessors(this.nodes.get(u)!)) {
          const p = this.register(e.state);
          if (this.value(this.rhs, p) === e.cost + old) yield* this.updateVertex(p);
          else yield* this.queueVertex(p);
        }
      }
      this.memory = Math.max(this.memory, this.nodes.size * 2 + this.queue.size);
    }
    if (!Number.isFinite(this.value(this.g, start))) {
      yield* this.complete(null, this.width, this.domain.start.cell);
      return;
    }
    const actions: Action[] = [],
      seen = new Set<string>();
    let key = start;
    while (!this.domain.isGoal(this.nodes.get(key)!)) {
      if (seen.has(key)) {
        yield* this.complete(null, this.width, this.domain.start.cell);
        return;
      }
      seen.add(key);
      let best: { key: string; action: Action } | null = null,
        value = Infinity;
      for (const e of yield* this.domain.successors(this.nodes.get(key)!)) {
        const next = this.register(e.state),
          cost = e.cost + this.value(this.g, next);
        yield;
        if (cost < value) {
          value = cost;
          best = { key: next, action: e.action };
        }
      }
      if (!best) {
        yield* this.complete(null, this.width, this.domain.start.cell);
        return;
      }
      actions.push(best.action);
      key = best.key;
      yield;
    }
    actions.push(...this.domain.finish(this.nodes.get(key)!));
    yield* this.complete(actions, this.width, this.domain.start.cell);
  }
}
class BidirectionalSearch extends MeteredSearch {
  private queues: PlanState[][];
  private heads = [0, 0];
  private distances: Map<string, number>[] = [new Map(), new Map()];
  private parents: Map<string, { key: string; action: Action }>[] = [new Map(), new Map()];
  private nodes = new Map<string, PlanState>();
  constructor(
    private domain: PlanningDomain,
    private width: number
  ) {
    super();
    this.queues = [[domain.start], []];
  }
  frontier() {
    return [...new Set(this.queues.flatMap((q, i) => q.slice(this.heads[i]).map((s) => s.cell)))];
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    const start = this.domain.key(this.domain.start);
    this.distances[0].set(start, 0);
    this.nodes.set(start, this.domain.start);
    for (const goal of yield* this.domain.goals()) {
      const key = this.domain.key(goal);
      this.queues[1].push(goal);
      this.distances[1].set(key, 0);
      this.nodes.set(key, goal);
      yield;
    }
    let best = Infinity,
      meet: string | null = null;
    while (this.heads.every((h, i) => h < this.queues[i].length)) {
      const lower = this.distances[0].get(this.domain.key(this.queues[0][this.heads[0]]))! + this.distances[1].get(this.domain.key(this.queues[1][this.heads[1]]))!;
      yield;
      if (lower >= best) break;
      const side = this.queues[0].length - this.heads[0] <= this.queues[1].length - this.heads[1] ? 0 : 1,
        other = 1 - side,
        state = this.queues[side][this.heads[side]++],
        key = this.domain.key(state);
      if (this.distances[other].has(key) && this.distances[side].get(key)! + this.distances[other].get(key)! < best) {
        best = this.distances[side].get(key)! + this.distances[other].get(key)!;
        meet = key;
      }
      this.expanded++;
      this.visited.add(state.cell);
      yield;
      for (const e of yield* side === 0 ? this.domain.successors(state) : this.domain.predecessors(state)) {
        const next = this.domain.key(e.state);
        if (!this.distances[side].has(next)) {
          this.distances[side].set(next, this.distances[side].get(key)! + 1);
          this.parents[side].set(next, { key, action: e.action });
          this.nodes.set(next, e.state);
          this.queues[side].push(e.state);
        }
        if (this.distances[other].has(next)) {
          const cost = this.distances[side].get(next)! + this.distances[other].get(next)!;
          if (cost < best) {
            best = cost;
            meet = next;
          }
        }
        yield;
      }
      this.memory = Math.max(this.memory, this.nodes.size + this.parents[0].size + this.parents[1].size);
    }
    if (!meet) {
      yield* this.complete(null, this.width, this.domain.start.cell);
      return;
    }
    const before: Action[] = [],
      after: Action[] = [];
    let key = meet;
    while (this.parents[0].has(key)) {
      const p = this.parents[0].get(key)!;
      before.push(p.action);
      key = p.key;
      yield;
    }
    key = meet;
    while (this.parents[1].has(key)) {
      const p = this.parents[1].get(key)!;
      after.push(p.action);
      key = p.key;
      yield;
    }
    yield* this.complete([...before.reverse(), ...after, ...this.domain.finish(this.nodes.get(key)!)], this.width, this.domain.start.cell);
  }
}
export function createDomainSearch(domain: PlanningDomain, algorithm: AlgorithmId, width: number): Search {
  if (["random", "mcts", "maxn", "paranoid"].includes(algorithm)) throw new Error("Algoritma tindakan memerlukan controller keputusan.");
  if (algorithm === "beam") return new BeamSearch(domain, width);
  if (algorithm === "rtaa") return new RealTimeSearch(domain, width);
  if (algorithm === "ara") return new AnytimeSearch(domain, width);
  return algorithm === "dstar-lite"
    ? new DStarLiteSearch(domain, width)
    : algorithm === "bidirectional"
      ? new BidirectionalSearch(domain, width)
      : new DomainSearch(domain, algorithm, width);
}

interface Branch {
  state: PlanState;
  actions: Action[];
  g: number;
}
export class BeamSearch extends MeteredSearch {
  private layer: Branch[] = [];
  constructor(
    private domain: PlanningDomain,
    private width: number
  ) {
    super();
  }
  frontier() {
    return this.layer.map((b) => b.state.cell);
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    this.layer = [{ state: this.domain.start, actions: [], g: 0 }];
    const seen = new Map<string, number>();
    let best: Branch | null = null;
    for (let depth = 0; this.layer.length && depth < 192; depth++) {
      const next = new Map<string, Branch>();
      for (const branch of this.layer) {
        this.expanded++;
        this.visited.add(branch.state.cell);
        yield;
        if (this.domain.isGoal(branch.state)) {
          yield* this.complete([...branch.actions, ...this.domain.finish(branch.state)], this.width, this.domain.start.cell);
          return;
        }
        for (const edge of yield* this.domain.successors(branch.state)) {
          const key = this.domain.key(edge.state),
            g = branch.g + edge.cost;
          if (g < (seen.get(key) ?? Infinity) && g < (next.get(key)?.g ?? Infinity)) next.set(key, { state: edge.state, g, actions: [...branch.actions, edge.action] });
          yield;
        }
      }
      const candidates = [...next.values()];
      candidates.sort((a, b) => a.g + this.domain.heuristic(a.state) - b.g - this.domain.heuristic(b.state));
      for (let i = 0; i < candidates.length; i++) yield;
      this.layer = candidates.slice(0, 8);
      for (const b of this.layer) {
        seen.set(this.domain.key(b.state), b.g);
        if (!best || this.domain.heuristic(b.state) < this.domain.heuristic(best.state)) best = b;
        yield;
      }
      this.memory = Math.max(this.memory, seen.size + candidates.length * (depth + 2));
    }
    yield* this.complete(null, this.width, this.domain.start.cell);
  }
}
export class RealTimeSearch extends MeteredSearch {
  private learned = new Map<string, number>();
  private open = new IndexedQueue();
  private nodes = new Map<string, Branch>();
  constructor(
    private domain: PlanningDomain,
    private width: number
  ) {
    super();
  }
  updateDomain(domain: PlanningDomain, changed: ReadonlySet<number> = new Set()) {
    if (domain.target.id !== this.domain.target.id || domain.navigationVersion !== this.domain.navigationVersion || changed.size) this.learned.clear();
    this.domain = domain;
    this.open = new IndexedQueue();
    this.nodes.clear();
    this.work = null;
    this.done = false;
    this.actions = null;
    this.path = null;
  }
  frontier() {
    return this.open.keys().map((k) => this.nodes.get(k)!.state.cell);
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    const h = (s: PlanState) => Math.max(this.domain.heuristic(s), this.learned.get(this.domain.key(s)) ?? 0);
    const start = this.domain.key(this.domain.start),
      closed = new Set<string>();
    this.nodes.set(start, { state: this.domain.start, actions: [], g: 0 });
    yield* this.open.set(start, h(this.domain.start));
    let chosen: Branch | undefined;
    while (this.open.size && closed.size < 24) {
      const key = (yield* this.open.pop())!.key,
        b = this.nodes.get(key)!;
      if (this.domain.isGoal(b.state)) {
        chosen = b;
        break;
      }
      closed.add(key);
      this.expanded++;
      this.visited.add(b.state.cell);
      yield;
      for (const e of yield* this.domain.successors(b.state)) {
        const k = this.domain.key(e.state),
          g = b.g + e.cost;
        if (!closed.has(k) && g < (this.nodes.get(k)?.g ?? Infinity)) {
          this.nodes.set(k, { state: e.state, actions: [...b.actions, e.action], g });
          yield* this.open.set(k, g + h(e.state), h(e.state));
        }
        yield;
      }
    }
    chosen ??= this.open.peek() ? this.nodes.get(this.open.peek()!.key) : undefined;
    if (chosen && !this.domain.isGoal(chosen.state)) {
      const f = chosen.g + h(chosen.state);
      for (const key of closed) {
        const b = this.nodes.get(key)!;
        this.learned.set(key, Math.max(h(b.state), f - b.g));
        yield;
      }
    }
    this.memory = this.learned.size + this.nodes.size;
    yield* this.complete(chosen ? [...chosen.actions, ...(this.domain.isGoal(chosen.state) ? this.domain.finish(chosen.state) : [])] : null, this.width, this.domain.start.cell);
  }
}
export class AnytimeSearch extends MeteredSearch {
  private open = new IndexedQueue();
  private nodes = new Map<string, PlanState>();
  private g = new Map<string, number>();
  private parents = new Map<string, { key: string; action: Action }>();
  private closed = new Set<string>();
  private incons = new Set<string>();
  private incumbent: string | null = null;
  private weight = 2.5;
  constructor(
    private domain: PlanningDomain,
    private width: number
  ) {
    super();
  }
  frontier() {
    return this.open.keys().map((k) => this.nodes.get(k)!.cell);
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    const start = this.domain.key(this.domain.start);
    this.nodes.set(start, this.domain.start);
    this.g.set(start, 0);
    yield* this.open.set(start, this.weight * this.domain.heuristic(this.domain.start));
    for (;;) {
      while (this.open.size && (!this.incumbent || this.open.peek()!.a < this.g.get(this.incumbent)!)) {
        // Improve the first solution for at most 512 further metered operations.
        if (this.incumbent && this.operations >= this.foundAt + 512) break;
        const key = (yield* this.open.pop())!.key,
          state = this.nodes.get(key)!;
        this.closed.add(key);
        this.expanded++;
        this.visited.add(state.cell);
        yield;
        if (this.domain.isGoal(state)) {
          this.incumbent = key;
          this.foundAt = Math.min(this.foundAt, this.operations);
          continue;
        }
        for (const e of yield* this.domain.successors(state)) {
          const k = this.domain.key(e.state),
            score = this.g.get(key)! + e.cost;
          if (score < (this.g.get(k) ?? Infinity)) {
            this.g.set(k, score);
            this.nodes.set(k, e.state);
            this.parents.set(k, { key, action: e.action });
            if (this.domain.isGoal(e.state)) {
              if (!this.incumbent || score < this.g.get(this.incumbent)!) this.incumbent = k;
              this.foundAt = Math.min(this.foundAt, this.operations);
            }
            if (this.closed.has(k)) this.incons.add(k);
            else yield* this.open.set(k, score + this.weight * this.domain.heuristic(e.state));
          }
          yield;
        }
        this.memory = Math.max(this.memory, this.nodes.size + this.parents.size + this.open.size + this.incons.size);
      }
      if (!this.incumbent || this.weight === 1 || this.operations >= this.foundAt + 512) break;
      this.weight = Math.max(1, this.weight - 0.5);
      const keys = new Set([...this.open.keys(), ...this.incons]);
      this.incons.clear();
      this.closed.clear();
      for (const k of keys) yield* this.open.set(k, this.g.get(k)! + this.weight * this.domain.heuristic(this.nodes.get(k)!));
    }
    if (!this.incumbent) {
      yield* this.complete(null, this.width, this.domain.start.cell);
      return;
    }
    const actions: Action[] = [];
    let current = this.incumbent;
    while (current !== start) {
      const p = this.parents.get(current)!;
      actions.push(p.action);
      current = p.key;
      yield;
    }
    yield* this.complete([...actions.reverse(), ...this.domain.finish(this.nodes.get(this.incumbent)!)], this.width, this.domain.start.cell);
  }
  private foundAt = Infinity;
}
export function neighbors(cell: number, width: number, height: number, terrain: Terrain[]) {
  return adjacent(cell, width, height).filter((c) => isWalkable(terrain[c]));
}
export function createSearch(width: number, height: number, terrain: Terrain[], start: Point, goal: Point, algorithm: AlgorithmId): Search {
  const initial: PlanState = { cell: start.y * width + start.x, energy: 0, mask: 0, inventory: 0, supply: 0, boxes: [] },
    to = goal.y * width + goal.x;
  const domain: PlanningDomain = {
    start: initial,
    target: { id: `cell:${to}`, cell: to, kind: "visit" },
    preparation: 0,
    key: (s) => String(s.cell),
    cell: (s) => s.cell,
    isGoal: (s) => s.cell === to,
    heuristic: (s) => (Math.abs((s.cell % width) - (to % width)) + Math.abs(Math.floor(s.cell / width) - Math.floor(to / width))) * 4,
    between: (a, b) => (Math.abs((a.cell % width) - (b.cell % width)) + Math.abs(Math.floor(a.cell / width) - Math.floor(b.cell / width))) * 4,
    *successors(s) {
      const edges = [];
      for (const c of adjacent(s.cell, width, height)) {
        yield;
        if (isWalkable(terrain[c]))
          edges.push({
            state: { ...s, cell: c },
            action: { kind: "move" as const, from: s.cell, to: c, duration: terrainCost(terrain[c]) * 4 },
            cost: terrainCost(terrain[c]) * 4,
          });
      }
      return edges;
    },
    *predecessors(s) {
      const edges = [];
      for (const c of adjacent(s.cell, width, height)) {
        yield;
        if (isWalkable(terrain[c]) && isWalkable(terrain[s.cell]))
          edges.push({
            state: { ...s, cell: c },
            action: { kind: "move" as const, from: c, to: s.cell, duration: terrainCost(terrain[s.cell]) * 4 },
            cost: terrainCost(terrain[s.cell]) * 4,
          });
      }
      return edges;
    },
    *goals() {
      yield;
      return isWalkable(terrain[to]) ? [{ ...initial, cell: to }] : [];
    },
    finish: () => [],
  };
  return createDomainSearch(domain, algorithm, width);
}
