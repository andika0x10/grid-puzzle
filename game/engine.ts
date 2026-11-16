import { algorithms, unavailableReason, type AlgorithmId, type MatchConfig } from "./algorithms";
import { createSearch, SEARCH_OPERATIONS_PER_TICK, type Search } from "./search";
import { isWalkable, terrainCost, type LevelDefinition, type Point, type Terrain } from "./schema";
import { botTerrain, copyModeState, initialModeState, isRaceMode, objectives, resolveModeTick, ruleWinners, seededHash, type ModeState } from "./modes";
import { MctsDecision, randomSource, RandomDecision, type DecisionState } from "./decisions";
import { applyTerrainChanges, checkpointObjectives, gemActive, gemPending, gemsSettled, gemUtility, legacyHash, raceReady, resolveGemClaims, type CompetitiveGem } from "./classic";

export const TICK_MS = 50;
export type BotStatus = "searching" | "moving" | "waiting" | "eliminated" | "finished" | "unreachable" | "timeout" | "stopped";
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
  inventory: number;
  keys: LevelDefinition["board"]["keys"][number]["color"][];
  eliminatedTick: number | null;
  checkpoints: number[];
  checkpointTotal: number;
}
export type Gem = CompetitiveGem;
export interface MatchFrame {
  tick: number;
  phase: "running" | "finished";
  terrain: Terrain[];
  bots: BotFrame[];
  gems: Gem[];
  winners: string[];
  note: string;
  modeState: ModeState;
  rulesVersion: number;
}
export interface MatchResult {
  player: AlgorithmId;
  won: boolean;
  draw: boolean;
  finishTick: number | null;
  gems: number;
  metric?: { kind: "time" | "score" | "survival"; value: number };
  rulesVersion?: number;
}
interface Bot extends BotFrame {
  search: Search | null;
  targetId: string | null;
  routeIndex: number;
  remaining: number;
  failed: Set<string>;
  previous: Point | null;
  random: () => number;
}
export function previewFrame(level: LevelDefinition, config: MatchConfig): MatchFrame {
  return {
    tick: 0,
    phase: "running",
    terrain: [...level.board.terrain],
    gems: level.board.gems.map((p, i) => ({
      ...p,
      value: p.value ?? 1,
      spawnTick: p.spawnTick ?? 0,
      expireTick: p.expireTick ?? null,
      expired: false,
      awardedPoints: 0,
      id: `gem-${i}`,
      taken: false,
      claimedBy: null,
      claimedTick: null,
    })),
    winners: [],
    note: "Pilih peserta, lalu mulai pertandingan.",
    modeState: initialModeState(level),
    rulesVersion: level.rulesVersion,
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
      inventory: 0,
      keys: [],
      eliminatedTick: null,
      checkpoints: [],
      checkpointTotal: level.board.checkpoints.length,
    })),
  };
}
const hash = legacyHash;
const getBotName = (id: AlgorithmId) => algorithms.find((a) => a.id === id)!.short;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export class MatchEngine {
  private tickNumber = 0;
  private finished = false;
  private terrain: Terrain[];
  private bots: Bot[];
  private gems: Gem[];
  private modeState: ModeState;
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
    this.modeState = initial.modeState;
    if (level.mode !== "race" && level.mode !== "gems") this.note = level.mission;
    this.bots = initial.bots.map((b) => ({
      ...b,
      search: null,
      targetId: null,
      routeIndex: 0,
      remaining: 0,
      failed: new Set<string>(),
      previous: null,
      random: randomSource(seededHash(b.algorithm, config.seed)),
    }));
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
      const candidates = checkpointObjectives(this.level, bot)
        .filter((p) => !bot.failed.has(p.id))
        .sort(
          (a, b) =>
            Math.abs(a.x - bot.x) + Math.abs(a.y - bot.y) - Math.abs(b.x - bot.x) - Math.abs(b.y - bot.y) ||
            hash(a.id + bot.algorithm, this.config.seed) - hash(b.id + bot.algorithm, this.config.seed)
        );
      target = candidates[0];
      bot.targetId = candidates[0]?.id === "goal" ? null : (candidates[0]?.id ?? null);
    } else if (this.level.mode === "gems") {
      const available = this.gems
        .filter((g) => gemActive(g, this.tickNumber) && !bot.failed.has(g.id) && (this.level.rulesVersion < 2 || gemUtility(this.level, g, bot, this.tickNumber) > 0))
        .sort((a, b) => {
          const distance = (p: Point) => Math.abs(p.x - bot.x) + Math.abs(p.y - bot.y);
          return (
            (this.level.rulesVersion >= 2 ? gemUtility(this.level, b, bot, this.tickNumber) - gemUtility(this.level, a, bot, this.tickNumber) : distance(a) - distance(b)) ||
            hash(a.id + bot.algorithm, this.config.seed) - hash(b.id + bot.algorithm, this.config.seed)
          );
        });
      target = available[0];
      bot.targetId = available[0]?.id ?? null;
      if (!target && this.level.rulesVersion >= 2) {
        const upcoming = this.gems
          .filter((g) => gemPending(g, this.tickNumber) && !bot.failed.has(g.id))
          .sort(
            (a, b) =>
              (a.spawnTick ?? 0) - (b.spawnTick ?? 0) ||
              Math.abs(a.x - bot.x) + Math.abs(a.y - bot.y) - Math.abs(b.x - bot.x) - Math.abs(b.y - bot.y) ||
              hash(a.id + bot.algorithm, this.config.seed) - hash(b.id + bot.algorithm, this.config.seed)
          );
        target = upcoming[0];
        bot.targetId = upcoming[0]?.id ?? null;
        if (target && same(bot, target)) {
          bot.status = "waiting";
          return;
        }
      }
    } else {
      let candidates = objectives(this.level, this.modeState, bot, this.tickNumber);
      if (this.level.mode === "outposts") {
        const uncontested = candidates.filter((p) => !this.bots.some((other) => other.id !== bot.id && same(other, p)));
        if (uncontested.length) candidates = uncontested;
      }
      const available = candidates
        .filter((p) => !bot.failed.has(p.id))
        .sort(
          (a, b) =>
            Math.abs(a.x - bot.x) + Math.abs(a.y - bot.y) - Math.abs(b.x - bot.x) - Math.abs(b.y - bot.y) ||
            seededHash(a.id + bot.algorithm, this.config.seed) - seededHash(b.id + bot.algorithm, this.config.seed)
        );
      target = available[0];
      bot.targetId = available[0]?.id ?? null;
      if (!target && this.level.mode === "cargo" && bot.inventory && this.level.board.depot) {
        target = this.level.board.depot;
        bot.targetId = "depot";
      }
    }
    const direct = bot.algorithm === "random" || bot.algorithm === "mcts";
    if (!target) {
      if (direct && this.level.mode !== "gems") target = { x: bot.x, y: bot.y };
      else {
        if (bot.algorithm !== "dstar-lite") bot.search = null;
        bot.status =
          this.level.mode === "race" || this.level.mode === "keys"
            ? "unreachable"
            : this.level.mode === "gems"
              ? gemsSettled(this.gems)
                ? "finished"
                : this.gems.some((g) => gemPending(g, this.tickNumber) || (this.level.rulesVersion >= 2 && !g.taken && !g.expired && g.expireTick != null))
                  ? "waiting"
                  : "unreachable"
              : "waiting";
        return;
      }
    }
    bot.status = "searching";
    const terrain = botTerrain(this.level, this.modeState, this.terrain, bot, this.tickNumber);
    if (bot.algorithm === "random") bot.search = new RandomDecision(this.level.board.width, this.level.board.height, terrain, bot, bot.previous, bot.random);
    else if (bot.algorithm === "mcts") bot.search = new MctsDecision(this.level, this.bots.indexOf(bot), this.decisionState(), this.config.seed, bot.random);
    else if (bot.algorithm === "dstar-lite" && bot.search?.update) bot.search.update(bot, target, terrain);
    else bot.search = createSearch(this.level.board.width, this.level.board.height, terrain, bot, target, bot.algorithm);
  }
  private decisionState(): DecisionState {
    return {
      tick: this.tickNumber,
      terrain: [...this.terrain],
      modeState: copyModeState(this.modeState),
      gems: this.gems.map((g) => ({ ...g })),
      appliedChanges: [...this.applied],
      bots: this.bots.map((b) => ({
        id: b.id,
        algorithm: b.algorithm,
        x: b.x,
        y: b.y,
        score: b.score,
        inventory: b.inventory,
        keys: [...b.keys],
        checkpoints: [...b.checkpoints],
        eliminatedTick: b.eliminatedTick,
        finishTick: b.finishTick,
        remaining: b.remaining,
        intention: b.route[b.routeIndex] ? { ...b.route[b.routeIndex] } : null,
      })),
    };
  }
  private arrive(bot: Bot) {
    if (this.level.mode === "race" && this.level.board.goal && same(bot, this.level.board.goal) && raceReady(this.level, bot)) {
      bot.status = "finished";
      bot.finishTick = this.tickNumber;
    }
    if (
      bot.status === "moving" &&
      bot.routeIndex >= bot.route.length &&
      ((this.level.mode !== "gems" && this.level.mode !== "race") || bot.algorithm === "random" || bot.algorithm === "mcts" || this.level.board.checkpoints.length > 0)
    )
      bot.status = "waiting";
  }
  step(): MatchFrame {
    if (this.finished) return this.snapshot();
    this.tickNumber++;
    const changed = applyTerrainChanges(this.level, this.terrain, this.bots, this.tickNumber, this.applied);
    if (changed.size) {
      this.note = this.level.board.gates.length ? "Gerbang beralih. Perhatikan jalan yang terbuka." : "Medan berubah. Penjelajah menyesuaikan rute.";
      for (const bot of this.bots)
        if (bot.status !== "finished" && bot.status !== "eliminated") {
          bot.failed.clear();
          // Snapshot searches finish their current computation. The live move
          // check rejects blocked steps; distant shutters must not starve them.
          if (bot.status === "searching" && bot.algorithm !== "dstar-lite") continue;
          if (bot.status !== "moving" || bot.route.slice(bot.routeIndex).some((p) => changed.has(p.y * this.level.board.width + p.x))) this.plan(bot);
        }
    }
    if (this.level.mode === "survival")
      for (const bot of this.bots) {
        const at = this.modeState.dangerAt[bot.y * this.level.board.width + bot.x];
        if (bot.eliminatedTick === null && at && at <= this.tickNumber) {
          bot.eliminatedTick = this.tickNumber;
          bot.status = "eliminated";
          bot.route = [];
          bot.remaining = 0;
        }
      }
    const arrivals = new Set<string>();
    for (const bot of this.bots) {
      if (bot.status === "waiting" && (this.level.mode === "race" || this.level.mode === "gems")) this.plan(bot);
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
            if (bot.route.length <= 1) {
              this.arrive(bot);
              if (bot.status === "moving") bot.status = "waiting";
            } else bot.remaining = terrainCost(this.terrain[bot.route[1].y * this.level.board.width + bot.route[1].x]) * 4;
          }
        }
      } else if (bot.status === "moving") {
        const next = bot.route[bot.routeIndex];
        if (!next) {
          if (this.level.mode === "gems" || bot.algorithm === "random" || bot.algorithm === "mcts") this.plan(bot);
          continue;
        }
        const terrain = botTerrain(this.level, this.modeState, this.terrain, bot, this.tickNumber)[next.y * this.level.board.width + next.x];
        if (!isWalkable(terrain)) {
          this.plan(bot);
          continue;
        }
        bot.moveTicks++;
        bot.remaining--;
        if (bot.remaining <= 0) {
          bot.facing = next.x > bot.x ? "right" : next.x < bot.x ? "left" : next.y > bot.y ? "down" : "up";
          bot.previous = { x: bot.x, y: bot.y };
          bot.x = next.x;
          bot.y = next.y;
          arrivals.add(bot.id);
          bot.cost += terrainCost(terrain);
          bot.routeIndex++;
          this.arrive(bot);
          const after = bot.route[bot.routeIndex];
          if (after) bot.remaining = terrainCost(this.terrain[after.y * this.level.board.width + after.x]) * 4;
        }
      }
    }
    if (this.level.mode === "gems") {
      const taken = resolveGemClaims(this.gems, this.bots, this.tickNumber, this.config.seed, this.level);
      const claimed = this.gems.filter((g) => taken.has(g.id) && g.claimedTick === this.tickNumber);
      if (claimed.length) {
        const gem = claimed.at(-1)!,
          owner = this.bots.find((b) => b.id === gem.claimedBy)!;
        this.note = `${getBotName(owner.algorithm)} merebut ${gem.value === 5 ? "rubi" : gem.value === 3 ? "safir" : "emas"}: +${gem.awardedPoints} poin.`;
      } else if (taken.size) this.note = "Gem bertimer telah lenyap. Incar kesempatan berikutnya.";
      else if (this.gems.some((g) => g.spawnTick === this.tickNumber)) this.note = "Gelombang gem baru muncul. Para pemburu bersiap merebutnya.";
      for (const bot of this.bots) if (bot.targetId && taken.has(bot.targetId)) this.plan(bot);
      if (gemsSettled(this.gems)) {
        this.finished = true;
        for (const b of this.bots) b.status = "finished";
      }
    }
    if (this.level.mode === "race") {
      const before = this.bots.map((b) => b.checkpoints.length);
      resolveModeTick(this.level, this.modeState, this.bots, this.tickNumber, arrivals, this.config.seed);
      for (const [i, bot] of this.bots.entries()) {
        if (bot.finishTick !== null) {
          bot.status = "finished";
          continue;
        }
        if (bot.checkpoints.length !== before[i]) {
          bot.failed.clear();
          this.note = `Pos lintasan diaktifkan. ${getBotName(bot.algorithm)}: ${bot.checkpoints.length}/${this.level.board.checkpoints.length} pos.`;
          this.plan(bot);
        } else if (bot.status === "waiting") this.plan(bot);
      }
    }
    if (this.level.mode !== "race" && this.level.mode !== "gems") {
      const previousKeys = this.bots.map((b) => b.keys.length),
        previousInventory = this.bots.map((b) => b.inventory);
      resolveModeTick(this.level, this.modeState, this.bots, this.tickNumber, arrivals, this.config.seed);
      for (const [i, bot] of this.bots.entries()) {
        if (bot.eliminatedTick !== null) {
          bot.status = "eliminated";
          bot.route = [];
          continue;
        }
        if (bot.finishTick !== null) {
          bot.status = "finished";
          continue;
        }
        const keyChanged = bot.keys.length !== previousKeys[i],
          inventoryChanged = bot.inventory !== previousInventory[i];
        let retarget = keyChanged || inventoryChanged;
        if (keyChanged) bot.failed.clear();
        if (this.level.mode === "cargo" && bot.targetId?.startsWith("parcel-")) retarget ||= this.modeState.parcels.find((p) => p.id === bot.targetId)?.state !== "available";
        if (bot.status === "waiting") {
          if (this.level.mode === "outposts") {
            const post = this.modeState.posts.find((p) => same(p, bot));
            retarget ||= !post || post.owner === bot.id || (post.contested && this.modeState.posts.some((p) => p.owner !== bot.id && !this.bots.some((b) => same(b, p))));
          } else retarget = true;
        }
        if (this.level.mode === "survival") {
          const at = bot.targetId?.startsWith("safe-") ? this.modeState.dangerAt[Number(bot.targetId.slice(5))] : 0;
          retarget ||= !!at && at <= this.tickNumber;
        }
        if (retarget) this.plan(bot);
      }
      if (this.level.mode === "cargo" && this.modeState.parcels.every((p) => p.state === "delivered")) this.finished = true;
      if (this.level.mode === "survival" && this.bots.filter((b) => b.eliminatedTick === null).length <= 1) this.finished = true;
    }
    // Resolve the whole tick before stopping: finishers on the same tick tie.
    if (isRaceMode(this.level.mode) && this.bots.some((b) => b.finishTick !== null)) {
      this.finished = true;
      for (const bot of this.bots) if (bot.status !== "finished" && bot.status !== "unreachable") bot.status = "stopped";
      this.note = "Garis finis tercapai. Pertandingan selesai.";
    }
    if (!this.finished && this.tickNumber >= this.level.timeLimit) {
      this.finished = true;
      for (const bot of this.bots) if (bot.status !== "finished" && bot.status !== "unreachable" && bot.status !== "eliminated") bot.status = "timeout";
      this.note = "Waktu pertandingan habis.";
    }
    if (
      this.bots.every((b) => b.status === "finished" || b.status === "unreachable") &&
      this.level.mode !== "survival" &&
      this.level.mode !== "territory" &&
      this.level.mode !== "outposts"
    ) {
      // A scheduled opening can make an unreachable target accessible again.
      if (
        !this.level.changes.some((c, i) => !this.applied.has(i) && isWalkable(c.terrain)) &&
        !(this.level.mode === "gems" && this.gems.some((g) => gemPending(g, this.tickNumber)))
      )
        this.finished = true;
    }
    if (this.finished && !isRaceMode(this.level.mode) && this.level.mode !== "gems")
      for (const bot of this.bots) if (bot.status !== "eliminated" && bot.status !== "unreachable") bot.status = "finished";
    return this.snapshot();
  }
  snapshot(): MatchFrame {
    const winners = this.finished ? ruleWinners(this.level.mode, this.bots, this.tickNumber) : [];
    return {
      tick: this.tickNumber,
      phase: this.finished ? "finished" : "running",
      terrain: [...this.terrain],
      gems: this.gems.map((g) => ({ ...g })),
      winners,
      note: this.note,
      modeState: copyModeState(this.modeState),
      rulesVersion: this.level.rulesVersion,
      bots: this.bots.map(
        ({ search: _search, targetId: _targetId, routeIndex: _routeIndex, remaining: _remaining, failed: _failed, previous: _previous, random: _random, ...b }) => ({
          ...b,
          keys: [...b.keys],
          checkpoints: [...b.checkpoints],
          visited: [...b.visited],
          frontier: [...b.frontier],
          route: b.route.map((p) => ({ ...p })),
        })
      ),
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
    gems: frame.modeState.mode === "gems" ? player.score : 0,
    rulesVersion: frame.rulesVersion,
    metric: isRaceMode(frame.modeState.mode)
      ? { kind: "time", value: player.finishTick ?? 0 }
      : frame.modeState.mode === "survival"
        ? { kind: "survival", value: player.eliminatedTick ?? frame.tick }
        : { kind: "score", value: player.score },
  };
}
