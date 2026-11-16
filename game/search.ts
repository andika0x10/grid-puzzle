import type { AlgorithmId } from "./algorithms";
import { isWalkable, terrainCost, type Point, type Terrain } from "./schema";
interface Entry {
  cell: number;
  g: number;
  priority: number;
  h: number;
  order: number;
}
class Heap {
  items: Entry[] = [];
  private less(a: Entry, b: Entry) {
    return a.priority < b.priority || (a.priority === b.priority && (a.h < b.h || (a.h === b.h && a.order < b.order)));
  }
  push(item: Entry) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): Entry | undefined {
    const a = this.items,
      first = a[0],
      last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1,
          r = l + 1;
        let n = i;
        if (l < a.length && this.less(a[l], a[n])) n = l;
        if (r < a.length && this.less(a[r], a[n])) n = r;
        if (n === i) break;
        [a[i], a[n]] = [a[n], a[i]];
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
  visited: Set<number>;
  frontier(): number[];
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
class ForwardSearch implements Search {
  done = false;
  path: Point[] | null = null;
  expanded = 0;
  memory = 1;
  visited = new Set<number>();
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
    this.scores = new Float64Array(terrain.length).fill(Infinity);
    this.parent = new Int32Array(terrain.length).fill(-1);
    this.scores[start] = 0;
    this.push(start, 0);
  }
  private push(cell: number, g: number) {
    const h = Math.abs((cell % this.width) - (this.goal % this.width)) + Math.abs(Math.floor(cell / this.width) - Math.floor(this.goal / this.width));
    const priority = this.algorithm === "greedy" ? h : g + h * (this.algorithm === "weighted-astar" ? 1.5 : 1);
    const item = { cell, g, priority, h, order: this.sequence++ };
    this.algorithm === "dfs" ? this.stack.push(item) : this.heap.push(item);
  }
  frontier() {
    return [...new Set((this.algorithm === "dfs" ? this.stack : this.heap.items).map((n) => n.cell))];
  }
  step() {
    if (this.done) return;
    let current: Entry | undefined;
    do {
      current = this.algorithm === "dfs" ? this.stack.pop() : this.heap.pop();
    } while (current && current.g !== this.scores[current.cell]);
    if (!current) {
      this.done = true;
      return;
    }
    this.expanded++;
    this.visited.add(current.cell);
    if (current.cell === this.goal) {
      const cells: number[] = [];
      let c = this.goal;
      while (c !== -1) {
        cells.push(c);
        if (c === this.start) break;
        c = this.parent[c];
      }
      this.path = cells.reverse().map((n) => point(n, this.width));
      this.done = true;
      return;
    }
    const next = neighbors(current.cell, this.width, this.height, this.terrain);
    if (this.algorithm === "dfs") next.reverse();
    for (const cell of next) {
      const g = current.g + terrainCost(this.terrain[cell]);
      if (this.scores[cell] === Infinity || ((this.algorithm === "astar" || this.algorithm === "weighted-astar") && g < this.scores[cell])) {
        this.scores[cell] = g;
        this.parent[cell] = current.cell;
        this.push(cell, g);
      }
    }
    this.memory = Math.max(this.memory, this.frontier().length + this.visited.size);
  }
}
class BidirectionalSearch implements Search {
  done = false;
  path: Point[] | null = null;
  expanded = 0;
  memory = 2;
  visited = new Set<number>();
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
    this.queues = [[start], [goal]];
    this.distances = [new Int32Array(terrain.length).fill(-1), new Int32Array(terrain.length).fill(-1)];
    this.parents = [new Int32Array(terrain.length).fill(-1), new Int32Array(terrain.length).fill(-1)];
    this.distances[0][start] = 0;
    this.distances[1][goal] = 0;
  }
  frontier() {
    return [...new Set(this.queues.flatMap((q, i) => q.slice(this.heads[i])))];
  }
  private finish() {
    this.done = true;
    if (this.meet < 0) return;
    const a: number[] = [],
      b: number[] = [];
    let c = this.meet;
    while (c !== -1) {
      a.push(c);
      c = this.parents[0][c];
    }
    c = this.parents[1][this.meet];
    while (c !== -1) {
      b.push(c);
      c = this.parents[1][c];
    }
    this.path = [...a.reverse(), ...b].map((n) => point(n, this.width));
  }
  step() {
    if (this.done) return;
    if (this.start === this.goal) {
      this.expanded++;
      this.path = [point(this.start, this.width)];
      this.done = true;
      return;
    }
    if (this.heads.some((h, i) => h >= this.queues[i].length)) {
      this.finish();
      return;
    }
    const lower = this.distances[0][this.queues[0][this.heads[0]]] + this.distances[1][this.queues[1][this.heads[1]]];
    if (lower >= this.best) {
      this.finish();
      return;
    }
    const side = this.queues[0].length - this.heads[0] <= this.queues[1].length - this.heads[1] ? 0 : 1,
      other = 1 - side,
      cell = this.queues[side][this.heads[side]++];
    this.expanded++;
    this.visited.add(cell);
    for (const n of [cell, ...neighbors(cell, this.width, this.height, this.terrain)]) {
      if (this.distances[side][n] < 0) {
        this.distances[side][n] = this.distances[side][cell] + 1;
        this.parents[side][n] = cell;
        this.queues[side].push(n);
      }
      if (this.distances[other][n] >= 0) {
        const cost = this.distances[side][n] + this.distances[other][n];
        if (cost < this.best) {
          this.best = cost;
          this.meet = n;
        }
      }
    }
    this.memory = Math.max(this.memory, this.frontier().length + this.visited.size);
    if (this.heads.some((h, i) => h >= this.queues[i].length)) this.finish();
    else if (this.distances[0][this.queues[0][this.heads[0]]] + this.distances[1][this.queues[1][this.heads[1]]] >= this.best) this.finish();
  }
}
export function createSearch(width: number, height: number, terrain: Terrain[], start: Point, goal: Point, algorithm: AlgorithmId): Search {
  const from = start.y * width + start.x,
    to = goal.y * width + goal.x;
  return algorithm === "bidirectional" ? new BidirectionalSearch(width, height, terrain, from, to) : new ForwardSearch(width, height, terrain, from, to, algorithm);
}
