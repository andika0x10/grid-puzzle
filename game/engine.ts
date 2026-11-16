import { algorithms, unavailableReason, type AlgorithmId, type MatchConfig } from "./algorithms";
import { createSearch, SEARCH_OPERATIONS_PER_TICK, type Search } from "./search";
import { isWalkable, terrainCost, type LevelDefinition, type Point, type Terrain } from "./schema";

export const TICK_MS = 50;
export type BotStatus = "searching" | "moving" | "finished" | "unreachable" | "timeout" | "stopped";
export interface BotFrame extends Point {
  id: string;
  algorithm: AlgorithmId;
  player: boolean;
  facing: "down" | "left" | "right" | "up";
  status: BotStatus;
  score: number;
  expanded: number;
  memory: number;
  searchTicks: number;
  computeOps: number;
  moveTicks: number;
  cost: number;
  finishTick: number | null;
  visited: number[];
  frontier: number[];
  route: Point[];
}
export interface Gem extends Point {
  id: string;
  taken: boolean;
  claimedBy: string | null;
  claimedTick: number | null;
}
export interface MatchFrame {
  tick: number;
  phase: "running" | "finished";
  terrain: Terrain[];
  bots: BotFrame[];
  gems: Gem[];
  winners: string[];
  note: string;
}
export interface MatchResult {
  player: AlgorithmId;
  won: boolean;
  draw: boolean;
  finishTick: number | null;
  gems: number;
}
interface Bot extends BotFrame {
  search: Search | null;
  targetId: string | null;
  routeIndex: number;
  remaining: number;
  failed: Set<string>;
}
export function previewFrame(level: LevelDefinition, config: MatchConfig): MatchFrame {
  return {
    tick: 0,
    phase: "running",
    terrain: [...level.board.terrain],
    gems: level.board.gems.map((p, i) => ({ ...p, id: `gem-${i}`, taken: false, claimedBy: null, claimedTick: null })),
    winners: [],
    note: "Pilih peserta, lalu mulai pertandingan.",
    bots: [config.player, ...config.opponents].map((algorithm, i) => ({
      ...level.board.spawn,
      id: `bot-${i}`,
      algorithm,
      player: i === 0,
      facing: "down",
      status: "searching",
      score: 0,
      expanded: 0,
      memory: 0,
      searchTicks: 0,
      computeOps: 0,
      moveTicks: 0,
      cost: 0,
      finishTick: null,
      visited: [],
      frontier: [],
      route: [],
    })),
  };
}
function hash(text: string, seed: number) {
  let h = seed >>> 0;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export class MatchEngine {
  private tickNumber = 0;
  private finished = false;
  private terrain: Terrain[];
  private bots: Bot[];
  private gems: Gem[];
  private applied = new Set<number>();
  private note = "Pertandingan dimulai. Penjelajah sedang mencari jalan.";
  constructor(
    readonly level: LevelDefinition,
    readonly config: MatchConfig
  ) {
    const ids = [config.player, ...config.opponents];
    if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some((id) => !algorithms.some((a) => a.id === id) || unavailableReason(id, level)))
      throw new Error("Pilih 2–4 algoritma berbeda yang cocok dengan medan.");
    const initial = previewFrame(level, config);
    this.terrain = initial.terrain;
    this.gems = initial.gems;
    this.bots = initial.bots.map((b) => ({ ...b, search: null, targetId: null, routeIndex: 0, remaining: 0, failed: new Set<string>() }));
    for (const bot of this.bots) this.plan(bot);
  }
  private plan(bot: Bot) {
    bot.route = [];
    bot.routeIndex = 0;
    bot.remaining = 0;
    bot.visited = [];
    bot.frontier = [];
    let target: Point | undefined;
    if (this.level.mode === "race") {
      target = this.level.board.goal;
      bot.targetId = null;
    } else {
      const available = this.gems
        .filter((g) => !g.taken && !bot.failed.has(g.id))
        .sort((a, b) => {
          const distance = (p: Point) => Math.abs(p.x - bot.x) + Math.abs(p.y - bot.y);
          return distance(a) - distance(b) || hash(a.id + bot.algorithm, this.config.seed) - hash(b.id + bot.algorithm, this.config.seed);
        });
      target = available[0];
      bot.targetId = available[0]?.id ?? null;
    }
    if (!target) {
      bot.search = null;
      bot.status = this.gems.every((g) => g.taken) ? "finished" : "unreachable";
      return;
    }
    bot.status = "searching";
    bot.search = createSearch(this.level.board.width, this.level.board.height, this.terrain, bot, target, bot.algorithm);
  }
  private arrive(bot: Bot) {
    if (this.level.mode === "race" && this.level.board.goal && same(bot, this.level.board.goal)) {
      bot.status = "finished";
      bot.finishTick = this.tickNumber;
    }
  }
  step(): MatchFrame {
    if (this.finished) return this.snapshot();
    this.tickNumber++;
    let changed = false;
    this.level.changes.forEach((change, i) => {
      if (this.applied.has(i) || change.tick > this.tickNumber || (!isWalkable(change.terrain) && this.bots.some((b) => same(b, change)))) return;
      this.terrain[change.y * this.level.board.width + change.x] = change.terrain;
      this.applied.add(i);
      changed = true;
    });
    if (changed) {
      this.note = "Medan berubah. Penjelajah menghitung ulang rutenya.";
      for (const bot of this.bots)
        if (bot.status !== "finished") {
          bot.failed.clear();
          this.plan(bot);
        }
    }
    for (const bot of this.bots) {
      if (bot.status === "searching" && bot.search) {
        const previous = bot.search.expanded;
        bot.computeOps += bot.search.advance(SEARCH_OPERATIONS_PER_TICK);
        bot.searchTicks++;
        bot.expanded += bot.search.expanded - previous;
        bot.memory = Math.max(bot.memory, bot.search.memory);
        bot.visited = [...bot.search.visited];
        bot.frontier = bot.search.frontier();
        if (bot.search.done) {
          if (!bot.search.path) {
            if (bot.targetId) {
              bot.failed.add(bot.targetId);
              this.plan(bot);
            } else bot.status = "unreachable";
          } else {
            bot.route = bot.search.path;
            bot.routeIndex = 1;
            bot.status = "moving";
            if (bot.route.length <= 1) this.arrive(bot);
            else bot.remaining = terrainCost(this.terrain[bot.route[1].y * this.level.board.width + bot.route[1].x]) * 4;
          }
        }
      } else if (bot.status === "moving") {
        const next = bot.route[bot.routeIndex];
        if (!next) {
          if (this.level.mode === "gems") this.plan(bot);
          continue;
        }
        const terrain = this.terrain[next.y * this.level.board.width + next.x];
        if (!isWalkable(terrain)) {
          this.plan(bot);
          continue;
        }
        bot.moveTicks++;
        bot.remaining--;
        if (bot.remaining <= 0) {
          bot.facing = next.x > bot.x ? "right" : next.x < bot.x ? "left" : next.y > bot.y ? "down" : "up";
          bot.x = next.x;
          bot.y = next.y;
          bot.cost += terrainCost(terrain);
          bot.routeIndex++;
          this.arrive(bot);
          const after = bot.route[bot.routeIndex];
          if (after) bot.remaining = terrainCost(this.terrain[after.y * this.level.board.width + after.x]) * 4;
        }
      }
    }
    if (this.level.mode === "gems") {
      const taken = new Set<string>();
      for (const gem of this.gems)
        if (!gem.taken) {
          const claimants = this.bots
            .filter((b) => same(b, gem))
            .sort((a, b) => hash(`${gem.id}:${a.algorithm}`, this.config.seed) - hash(`${gem.id}:${b.algorithm}`, this.config.seed) || (a.algorithm < b.algorithm ? -1 : 1));
          if (claimants.length) {
            const owner = claimants[0];
            gem.taken = true;
            gem.claimedBy = owner.id;
            gem.claimedTick = this.tickNumber;
            taken.add(gem.id);
            owner.score++;
            this.note = `${algorithms.find((a) => a.id === owner.algorithm)!.short} merebut gem. Penjelajah yang kehilangan target menghitung ulang rutenya.`;
          }
        }
      for (const bot of this.bots) if (bot.targetId && taken.has(bot.targetId)) this.plan(bot);
      if (this.gems.every((g) => g.taken)) {
        this.finished = true;
        for (const b of this.bots) b.status = "finished";
      }
    }
    // Resolve the whole tick before stopping: finishers on the same tick tie.
    if (this.level.mode === "race" && this.bots.some((b) => b.finishTick !== null)) {
      this.finished = true;
      for (const bot of this.bots) if (bot.status !== "finished" && bot.status !== "unreachable") bot.status = "stopped";
      this.note = "Garis finis tercapai. Pertandingan selesai.";
    }
    if (!this.finished && this.tickNumber >= this.level.timeLimit) {
      this.finished = true;
      for (const bot of this.bots) if (bot.status !== "finished" && bot.status !== "unreachable") bot.status = "timeout";
      this.note = "Waktu pertandingan habis.";
    }
    if (this.bots.every((b) => b.status === "finished" || b.status === "unreachable")) {
      // A scheduled opening can make an unreachable target accessible again.
      if (!this.level.changes.some((c, i) => !this.applied.has(i) && isWalkable(c.terrain))) this.finished = true;
    }
    return this.snapshot();
  }
  snapshot(): MatchFrame {
    let winners: string[] = [];
    if (this.finished) {
      if (this.level.mode === "race") {
        const times = this.bots.flatMap((b) => (b.finishTick === null ? [] : [b.finishTick]));
        if (times.length) {
          const best = Math.min(...times);
          winners = this.bots.filter((b) => b.finishTick === best).map((b) => b.id);
        }
      } else {
        const best = Math.max(...this.bots.map((b) => b.score));
        if (best > 0) winners = this.bots.filter((b) => b.score === best).map((b) => b.id);
      }
    }
    return {
      tick: this.tickNumber,
      phase: this.finished ? "finished" : "running",
      terrain: [...this.terrain],
      gems: this.gems.map((g) => ({ ...g })),
      winners,
      note: this.note,
      bots: this.bots.map(({ search: _search, targetId: _targetId, routeIndex: _routeIndex, remaining: _remaining, failed: _failed, ...b }) => ({
        ...b,
        visited: [...b.visited],
        frontier: [...b.frontier],
        route: b.route.map((p) => ({ ...p })),
      })),
    };
  }
}
export function matchResult(frame: MatchFrame): MatchResult {
  const player = frame.bots.find((b) => b.player)!;
  return {
    player: player.algorithm,
    won: frame.winners.includes(player.id),
    draw: frame.winners.length > 1,
    finishTick: player.finishTick,
    gems: player.score,
  };
}
