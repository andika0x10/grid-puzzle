import type { AlgorithmId } from "./algorithms";
import { isWalkable, terrainCost, type Point, type Terrain } from "./schema";

// Queue access/comparison, neighbor inspection, scoring and path recovery each
// cost an operation. Rendering and diagnostic snapshots consume no budget.
export const SEARCH_OPERATIONS_PER_TICK = 16;
type Work<T = void> = Generator<void, T, unknown>;
interface Entry {
  cell: number;
  g: number;
  priority: number;
  h: number;
  order: number;
}
class Heap {
  items: Entry[] = [];
  private *less(a: Entry, b: Entry): Work<boolean> {
    yield;
    return a.priority < b.priority || (a.priority === b.priority && (a.h < b.h || (a.h === b.h && a.order < b.order)));
  }
  *push(item: Entry): Work {
    const a = this.items;
    a.push(item);
    yield;
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!(yield* this.less(a[i], a[p]))) break;
      [a[i], a[p]] = [a[p], a[i]];
      yield;
      i = p;
    }
  }
  *pop(): Work<Entry | undefined> {
    const a = this.items,
      first = a[0],
      last = a.pop();
    yield;
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1,
          r = l + 1;
        let n = i;
        if (l < a.length && (yield* this.less(a[l], a[n]))) n = l;
        if (r < a.length && (yield* this.less(a[r], a[n]))) n = r;
        if (n === i) break;
        [a[i], a[n]] = [a[n], a[i]];
        yield;
        i = n;
      }
    }
    return first;
  }
}
export interface Search {
  done: boolean;
  path: Point[] | null;
  expanded: number;
  memory: number;
  operations: number;
  visited: Set<number>;
  frontier(): number[];
  advance(budget: number): number;
  step(): void;
  update?(start: Point, goal: Point, terrain: Terrain[]): void;
}
export function neighbors(cell: number, width: number, height: number, terrain: Terrain[]): number[] {
  const x = cell % width,
    y = Math.floor(cell / width),
    out: number[] = [];
  for (const [dx, dy] of [
    [1, 0],
    [0, -1],
    [-1, 0],
    [0, 1],
  ]) {
    const nx = x + dx,
      ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < width && ny < height && isWalkable(terrain[ny * width + nx])) out.push(ny * width + nx);
  }
  return out;
}
const point = (cell: number, width: number): Point => ({ x: cell % width, y: Math.floor(cell / width) });
export abstract class MeteredSearch implements Search {
  done = false;
  path: Point[] | null = null;
  expanded = 0;
  memory = 1;
  operations = 0;
  visited = new Set<number>();
  protected work: Work | null = null;
  abstract frontier(): number[];
  protected abstract run(): Work;
  advance(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) throw new Error("Anggaran komputasi harus berupa angka nonnegatif.");
    this.work ??= this.run();
    let used = 0;
    while (!this.done && used < Math.floor(budget)) {
      const next = this.work.next();
      if (next.done) this.done = true;
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
  protected *complete(cells: number[] | null, width: number): Work {
    if (cells) {
      const path: Point[] = [];
      for (const cell of cells) {
        path.push(point(cell, width));
        yield;
      }
      this.path = path;
    }
    this.done = true;
    yield;
  }
  protected *inspect(cell: number, width: number, height: number, terrain: Terrain[]): Work<number[]> {
    const out: number[] = [],
      x = cell % width,
      y = Math.floor(cell / width);
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && isWalkable(terrain[ny * width + nx])) out.push(ny * width + nx);
      yield;
    }
    return out;
  }
}
class ForwardSearch extends MeteredSearch {
  private heap = new Heap();
  private stack: Entry[] = [];
  private queueHead = 0;
  private scores: Float64Array;
  private parent: Int32Array;
  private sequence = 0;
  constructor(
    private width: number,
    private height: number,
    private terrain: Terrain[],
    private start: number,
    private goal: number,
    private algorithm: AlgorithmId
  ) {
    super();
    this.scores = new Float64Array(terrain.length).fill(Infinity);
    this.parent = new Int32Array(terrain.length).fill(-1);
    this.scores[start] = 0;
  }
  private *push(cell: number, g: number): Work {
    let h = 0,
      priority = 0;
    if (this.algorithm !== "dfs" && this.algorithm !== "bfs") {
      if (this.algorithm !== "dijkstra") {
        h = Math.abs((cell % this.width) - (this.goal % this.width)) + Math.abs(Math.floor(cell / this.width) - Math.floor(this.goal / this.width));
        yield;
      }
      priority = h;
      if (this.algorithm === "weighted-astar") {
        priority *= 1.5;
        yield;
      }
      if (this.algorithm !== "greedy") {
        priority += g;
        yield;
      }
    }
    const item = { cell, g, priority, h, order: this.sequence++ };
    if (this.algorithm === "dfs" || this.algorithm === "bfs") {
      this.stack.push(item);
      yield;
    } else yield* this.heap.push(item);
  }
  frontier() {
    return [...new Set((this.algorithm === "bfs" ? this.stack.slice(this.queueHead) : this.algorithm === "dfs" ? this.stack : this.heap.items).map((n) => n.cell))];
  }
  protected *run(): Work {
    yield* this.push(this.start, 0);
    while (true) {
      let current: Entry | undefined;
      do {
        if (this.algorithm === "dfs" || this.algorithm === "bfs") {
          current = this.algorithm === "bfs" ? this.stack[this.queueHead++] : this.stack.pop();
          yield;
        } else current = yield* this.heap.pop();
        yield;
      } while (current && current.g !== this.scores[current.cell]);
      if (!current) {
        yield* this.complete(null, this.width);
        return;
      }
      this.expanded++;
      this.visited.add(current.cell);
      yield;
      if (current.cell === this.goal) {
        const cells: number[] = [];
        let c = this.goal;
        while (c !== -1) {
          cells.push(c);
          yield;
          if (c === this.start) break;
          c = this.parent[c];
        }
        yield* this.complete(cells.reverse(), this.width);
        return;
      }
      const next = yield* this.inspect(current.cell, this.width, this.height, this.terrain);
      if (this.algorithm === "dfs") next.reverse();
      for (const cell of next) {
        const g = current.g + terrainCost(this.terrain[cell]);
        yield;
        const better =
          this.scores[cell] === Infinity || ((this.algorithm === "astar" || this.algorithm === "weighted-astar" || this.algorithm === "dijkstra") && g < this.scores[cell]);
        yield;
        if (better) {
          this.scores[cell] = g;
          this.parent[cell] = current.cell;
          yield;
          yield* this.push(cell, g);
        }
      }
      this.memory = Math.max(this.memory, this.frontier().length + this.visited.size);
    }
  }
}
class BidirectionalSearch extends MeteredSearch {
  private queues: number[][];
  private heads = [0, 0];
  private distances: Int32Array[];
  private parents: Int32Array[];
  private best = Infinity;
  private meet = -1;
  constructor(
    private width: number,
    private height: number,
    private terrain: Terrain[],
    private start: number,
    private goal: number
  ) {
    super();
    this.memory = 2;
    this.queues = [[start], [goal]];
    this.distances = [new Int32Array(terrain.length).fill(-1), new Int32Array(terrain.length).fill(-1)];
    this.parents = [new Int32Array(terrain.length).fill(-1), new Int32Array(terrain.length).fill(-1)];
    this.distances[0][start] = 0;
    this.distances[1][goal] = 0;
  }
  frontier() {
    return [...new Set(this.queues.flatMap((q, i) => q.slice(this.heads[i])))];
  }
  private *finish(): Work {
    if (this.meet < 0) {
      yield* this.complete(null, this.width);
      return;
    }
    const a: number[] = [],
      b: number[] = [];
    let c = this.meet;
    while (c !== -1) {
      a.push(c);
      c = this.parents[0][c];
      yield;
    }
    c = this.parents[1][this.meet];
    while (c !== -1) {
      b.push(c);
      c = this.parents[1][c];
      yield;
    }
    yield* this.complete([...a.reverse(), ...b], this.width);
  }
  protected *run(): Work {
    // Initial queue insertions use the same budget as forward searches.
    yield;
    yield;
    if (this.start === this.goal) {
      this.expanded++;
      yield* this.complete([this.start], this.width);
      return;
    }
    while (true) {
      const empty = this.heads.some((h, i) => h >= this.queues[i].length);
      yield;
      if (empty) {
        yield* this.finish();
        return;
      }
      const lower = this.distances[0][this.queues[0][this.heads[0]]] + this.distances[1][this.queues[1][this.heads[1]]];
      yield;
      if (lower >= this.best) {
        yield* this.finish();
        return;
      }
      const side = this.queues[0].length - this.heads[0] <= this.queues[1].length - this.heads[1] ? 0 : 1,
        other = 1 - side;
      yield;
      const cell = this.queues[side][this.heads[side]++];
      yield;
      this.expanded++;
      this.visited.add(cell);
      yield;
      const next = yield* this.inspect(cell, this.width, this.height, this.terrain);
      for (const n of [cell, ...next]) {
        const unseen = this.distances[side][n] < 0;
        yield;
        if (unseen) {
          this.distances[side][n] = this.distances[side][cell] + 1;
          this.parents[side][n] = cell;
          yield;
          this.queues[side].push(n);
          yield;
        }
        const reached = this.distances[other][n] >= 0;
        yield;
        if (reached) {
          const cost = this.distances[side][n] + this.distances[other][n];
          yield;
          if (cost < this.best) {
            this.best = cost;
            this.meet = n;
            yield;
          }
        }
      }
      this.memory = Math.max(this.memory, this.frontier().length + this.visited.size);
    }
  }
}
// Backward incremental search (Koenig & Likhachev, D* Lite). Lazy heap entries
// let updates invalidate a key without an unmetered remove/decrease-key scan.
export class DStarLiteSearch extends MeteredSearch {
  private g: Float64Array;
  private rhs: Float64Array;
  private heap = new Heap();
  private queued = new Map<number, Entry>();
  private initialized = false;
  private pending: Terrain[] | null = null;
  private queuedUpdate: { start: Point; goal: Point; terrain: Terrain[] } | null = null;
  private start: number;
  private goal: number;
  private km = 0;
  private sequence = 0;
  private known = new Set<number>();
  constructor(
    private width: number,
    private height: number,
    private terrain: Terrain[],
    start: Point,
    goal: Point
  ) {
    super();
    this.terrain = [...terrain];
    this.start = start.y * width + start.x;
    this.goal = goal.y * width + goal.x;
    this.g = new Float64Array(terrain.length).fill(Infinity);
    this.rhs = new Float64Array(terrain.length).fill(Infinity);
    this.rhs[this.goal] = 0;
  }
  private distance(a: number, b: number) {
    return Math.abs((a % this.width) - (b % this.width)) + Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
  }
  private key(cell: number): [number, number] {
    const v = Math.min(this.g[cell], this.rhs[cell]);
    return [v + this.distance(this.start, cell) + this.km, v];
  }
  private before(a: [number, number], b: [number, number]) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }
  private *adjacent(cell: number): Work<number[]> {
    const out: number[] = [],
      x = cell % this.width,
      y = Math.floor(cell / this.width);
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ]) {
      const nx = x + dx,
        ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) out.push(ny * this.width + nx);
      yield;
    }
    return out;
  }
  private cost(from: number, to: number) {
    return isWalkable(this.terrain[from]) && isWalkable(this.terrain[to]) ? terrainCost(this.terrain[to]) : Infinity;
  }
  private *insert(cell: number): Work {
    const [priority, h] = this.key(cell);
    yield;
    const entry = { cell, priority, h, g: 0, order: this.sequence++ };
    this.queued.set(cell, entry);
    yield* this.heap.push(entry);
  }
  private *updateVertex(cell: number): Work {
    if (cell !== this.goal) {
      let best = Infinity;
      for (const n of yield* this.adjacent(cell)) {
        best = Math.min(best, this.cost(cell, n) + this.g[n]);
        yield;
      }
      this.rhs[cell] = best;
    }
    this.queued.delete(cell);
    yield;
    if (this.g[cell] !== this.rhs[cell]) yield* this.insert(cell);
  }
  private *top(): Work<Entry | undefined> {
    while (this.heap.items.length) {
      const entry = this.heap.items[0];
      yield;
      if (this.queued.get(entry.cell) === entry) return entry;
      yield* this.heap.pop();
    }
    return undefined;
  }
  frontier() {
    return [...this.queued.keys()];
  }
  update(start: Point, goal: Point, terrain: Terrain[]) {
    const next = start.y * this.width + start.x,
      to = goal.y * this.width + goal.x;
    // A generator can be paused halfway through a heap swap or predecessor
    // update. Finish that search before repairing the graph, and never expose
    // its stale result. Changing the goal resets all state and is safe at once.
    if (to === this.goal && !this.done && this.work) {
      this.queuedUpdate = { start: { ...start }, goal: { ...goal }, terrain: [...terrain] };
      return;
    }
    this.queuedUpdate = null;
    if (to !== this.goal) {
      this.g.fill(Infinity);
      this.rhs.fill(Infinity);
      this.rhs[to] = 0;
      this.goal = to;
      this.heap = new Heap();
      this.queued.clear();
      this.known.clear();
      this.km = 0;
      this.initialized = false;
    } else this.km += this.distance(this.start, next);
    this.start = next;
    this.pending = [...terrain];
    this.done = false;
    this.path = null;
    this.work = null;
    this.visited.clear();
  }
  advance(budget: number) {
    const used = super.advance(budget);
    if (this.done && this.queuedUpdate) {
      const pending = this.queuedUpdate;
      this.update(pending.start, pending.goal, pending.terrain);
    }
    return used;
  }
  protected *run(): Work {
    if (!this.initialized) {
      yield* this.insert(this.goal);
      this.initialized = true;
    }
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      const changed: number[] = [];
      for (let i = 0; i < next.length; i++) {
        if (this.terrain[i] !== next[i]) changed.push(i);
        yield;
      }
      this.terrain = next;
      for (const cell of changed) {
        yield* this.updateVertex(cell);
        for (const n of yield* this.adjacent(cell)) yield* this.updateVertex(n);
      }
    }
    while (true) {
      const top = yield* this.top(),
        desired = this.key(this.start);
      yield;
      if ((!top || !this.before([top.priority, top.h], desired)) && this.rhs[this.start] === this.g[this.start]) break;
      if (!top) break;
      yield* this.heap.pop();
      this.queued.delete(top.cell);
      const u = top.cell,
        updated = this.key(u);
      yield;
      if (this.before([top.priority, top.h], updated)) yield* this.insert(u);
      else {
        this.expanded++;
        this.visited.add(u);
        this.known.add(u);
        if (this.g[u] > this.rhs[u]) this.g[u] = this.rhs[u];
        else {
          this.g[u] = Infinity;
          yield* this.updateVertex(u);
        }
        for (const p of yield* this.adjacent(u)) yield* this.updateVertex(p);
      }
      this.memory = Math.max(this.memory, this.known.size + this.queued.size);
    }
    if (!Number.isFinite(this.g[this.start]) || !isWalkable(this.terrain[this.start]) || !isWalkable(this.terrain[this.goal])) {
      yield* this.complete(null, this.width);
      return;
    }
    const cells = [this.start],
      seen = new Set(cells);
    while (cells.at(-1) !== this.goal) {
      const current = cells.at(-1)!;
      let best = -1,
        value = Infinity;
      for (const n of yield* this.adjacent(current)) {
        const cost = this.cost(current, n) + this.g[n];
        if (cost < value) {
          value = cost;
          best = n;
        }
        yield;
      }
      if (best < 0 || seen.has(best)) {
        yield* this.complete(null, this.width);
        return;
      }
      cells.push(best);
      seen.add(best);
      yield;
    }
    yield* this.complete(cells, this.width);
  }
}

export function createSearch(width: number, height: number, terrain: Terrain[], start: Point, goal: Point, algorithm: AlgorithmId): Search {
  const from = start.y * width + start.x,
    to = goal.y * width + goal.x;
  if (algorithm === "dstar-lite") return new DStarLiteSearch(width, height, terrain, start, goal);
  if (algorithm === "random" || algorithm === "mcts") throw new Error("Algoritma ini memakai controller tindakan, bukan pencarian rute.");
  return algorithm === "bidirectional" ? new BidirectionalSearch(width, height, terrain, from, to) : new ForwardSearch(width, height, terrain, from, to, algorithm);
}
