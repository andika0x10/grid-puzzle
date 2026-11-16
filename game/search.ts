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
abstract class MeteredSearch implements Search {
  done = false;
  path: Point[] | null = null;
  expanded = 0;
  memory = 1;
  operations = 0;
  visited = new Set<number>();
  private work: Work | null = null;
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
    if (this.algorithm !== "dfs") {
      h = Math.abs((cell % this.width) - (this.goal % this.width)) + Math.abs(Math.floor(cell / this.width) - Math.floor(this.goal / this.width));
      yield;
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
    if (this.algorithm === "dfs") {
      this.stack.push(item);
      yield;
    } else yield* this.heap.push(item);
  }
  frontier() {
    return [...new Set((this.algorithm === "dfs" ? this.stack : this.heap.items).map((n) => n.cell))];
  }
  protected *run(): Work {
    yield* this.push(this.start, 0);
    while (true) {
      let current: Entry | undefined;
      do {
        if (this.algorithm === "dfs") {
          current = this.stack.pop();
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
        const better = this.scores[cell] === Infinity || ((this.algorithm === "astar" || this.algorithm === "weighted-astar") && g < this.scores[cell]);
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
export function createSearch(width: number, height: number, terrain: Terrain[], start: Point, goal: Point, algorithm: AlgorithmId): Search {
  const from = start.y * width + start.x,
    to = goal.y * width + goal.x;
  return algorithm === "bidirectional" ? new BidirectionalSearch(width, height, terrain, from, to) : new ForwardSearch(width, height, terrain, from, to, algorithm);
}
