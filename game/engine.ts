import { algorithms, unavailableReason, type AlgorithmId, type MatchConfig } from "./algorithms";
import { createDomainSearch, SEARCH_OPERATIONS_PER_TICK, type Search } from "./search";
import { levelSchema, type LevelDefinition, type Point, type Terrain } from "./schema";
import { ModeDomain } from "./planning";
import { MctsDecision, RandomDecision, randomSource, type DecisionState } from "./decisions";
import {
  actionEqual,
  advanceWorld,
  botDetail,
  cellOf,
  cloneWorld,
  copyModeState,
  initialModeState,
  legalActions,
  observation,
  reveal,
  resolveActions,
  ruleWinners,
  seededHash,
  syncCircuit,
  terminal,
  type Action,
  type ActionKind,
  type Intent,
  type ModeState,
  type RuleBot,
  type RuleWorld,
} from "./modes";
export const TICK_MS = 50;
export type BotStatus = "searching" | "moving" | "waiting" | "eliminated" | "finished" | "unreachable" | "timeout" | "stopped";
export interface BotFrame extends RuleBot {
  algorithm: AlgorithmId;
  player: boolean;
  facing: "down" | "left" | "right" | "up";
  status: BotStatus;
  expanded: number;
  memory: number;
  searchTicks: number;
  computeOps: number;
  moveTicks: number;
  cost: number;
  visited: number[];
  frontier: number[];
  route: Point[];
  action: ActionKind | null;
  detail: string;
}
export interface MatchFrame {
  tick: number;
  phase: "running" | "finished";
  terrain: Terrain[];
  bots: BotFrame[];
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
  score: number;
  metric: { kind: "time" | "score" | "survival"; value: number };
  rulesVersion: number;
}
interface Bot extends BotFrame {
  search: Search | null;
  domain: ModeDomain | null;
  plan: Action[];
  index: number;
  remaining: number;
  retryAt: number;
  visits: Map<number, number>;
  failed: Set<string>;
  random: () => number;
  failedRevision: number;
  dirty: Set<number>;
}
function initialBots(l: LevelDefinition, c: MatchConfig): BotFrame[] {
  return [c.player, ...c.opponents].map((algorithm, i) => ({
    ...l.board.spawn,
    id: `bot-${i}`,
    algorithm,
    player: i === 0,
    score: 0,
    inventory: 0,
    energy: 24,
    known: l.mode === "fog" ? Array(l.board.terrain.length).fill(null) : [],
    visible: [],
    finishTick: null,
    eliminatedTick: null,
    facing: "up",
    status: "waiting",
    expanded: 0,
    memory: 0,
    searchTicks: 0,
    computeOps: 0,
    moveTicks: 0,
    cost: 0,
    visited: [],
    frontier: [],
    route: [],
    action: null,
    detail: "",
  }));
}
export function previewFrame(l: LevelDefinition, c: MatchConfig): MatchFrame {
  const bots = initialBots(l, c),
    world: RuleWorld = { tick: 0, terrain: [...l.board.terrain], bots, modeState: initialModeState(l) };
  syncCircuit(l, world);
  for (const b of bots) {
    reveal(l, world, b);
    b.detail = botDetail(l.mode, b);
  }
  return { ...world, bots, phase: "running", winners: [], note: l.briefing, rulesVersion: l.rulesVersion };
}
export class MatchEngine {
  private world: RuleWorld;
  private bots: Bot[];
  private finished = false;
  private note: string;
  private changed = new Set<number>();
  private decisionView: DecisionState | null = null;
  readonly level: LevelDefinition;
  constructor(
    level: LevelDefinition,
    readonly config: MatchConfig
  ) {
    this.level = levelSchema.parse(level);
    const ids = [config.player, ...config.opponents];
    if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length || ids.some((id) => !algorithms.some((a) => a.id === id) || unavailableReason(id, this.level)))
      throw new Error("Pilih 2–4 algoritma berbeda yang mendukung arena.");
    const frame = previewFrame(this.level, config);
    this.bots = frame.bots.map((b) => ({
      ...b,
      search: null,
      domain: null,
      plan: [],
      index: 0,
      remaining: 0,
      retryAt: 0,
      visits: new Map([[cellOf(b, level.board.width), 1]]),
      failed: new Set(),
      random: randomSource(seededHash(b.algorithm, config.seed)),
      failedRevision: 0,
      dirty: new Set<number>(),
    }));
    this.world = { tick: 0, terrain: frame.terrain, bots: this.bots, modeState: frame.modeState };
    this.note = level.briefing;
  }
  private observed(bot: Bot): DecisionState {
    const obs = observation(this.level, this.decisionView ?? this.world, bot);
    const tasks: NonNullable<DecisionState["tasks"]> = {};
    if (this.decisionView) {
      for (const [id, task] of Object.entries(this.decisionView.tasks ?? {}))
        if (obs.bots.some((b) => b.id === id) && (this.level.mode !== "fog" || id === bot.id || bot.visible.includes(task.action.to))) tasks[id] = structuredClone(task);
    } else
      for (const b of this.bots)
        if (b.remaining > 0 && b.plan[b.index] && obs.bots.some((x) => x.id === b.id)) tasks[b.id] = { action: { ...b.plan[b.index] }, remaining: b.remaining };
    return { ...obs, tasks };
  }
  private available(bot: Bot) {
    const target = bot.domain?.target,
      s = this.world.modeState;
    if (!target) return true;
    if (this.level.mode === "circuit" && s.mode === "circuit") return target.object === s.contract;
    if (this.level.mode === "energy" && s.mode === "energy") return target.kind !== "claim" || !s.owners[target.object!] || s.owners[target.object!] === bot.id;
    if (this.level.mode === "bridge" && s.mode === "bridge") {
      if (target.kind === "collect") return s.suppliesReady[target.object!] <= this.world.tick;
      if (target.kind === "build") return !(s.builtMask & (1 << target.object!));
      if (target.kind === "claim" && target.object !== -1) return !s.owners[target.object!];
    }
    if (this.level.mode === "hunt" && s.mode === "hunt") return s.targets[target.object ?? 0]?.active || this.world.tick < (target.tick ?? 0);
    return true;
  }
  private plan(bot: Bot) {
    bot.plan = [];
    bot.index = 0;
    bot.remaining = 0;
    bot.route = [];
    bot.action = null;
    if (bot.failedRevision !== this.world.modeState.revision) {
      bot.failed.clear();
      bot.failedRevision = this.world.modeState.revision;
    }
    const observed = this.observed(bot),
      actor = observed.bots.find((b) => b.id === bot.id)!;
    const domain = new ModeDomain(this.level, observed, actor, bot.visits, bot.failed);
    bot.domain = domain;
    if (domain.target.id === "idle") {
      bot.status = "waiting";
      bot.retryAt = this.world.tick + 8;
      bot.failed.clear();
      return;
    }
    bot.status = "searching";
    if (bot.algorithm === "random") bot.search = new RandomDecision(this.level, observed, actor, domain, bot.visits, bot.random);
    else if (bot.algorithm === "mcts")
      bot.search = new MctsDecision(
        this.level,
        observed.bots.findIndex((b) => b.id === bot.id),
        observed,
        this.config.seed,
        bot.random,
        bot.visits
      );
    else if (bot.algorithm === "dstar-lite" && bot.search?.updateDomain) bot.search.updateDomain(domain, bot.dirty);
    else bot.search = createDomainSearch(domain, bot.algorithm, this.level.board.width);
    bot.dirty.clear();
  }
  private readyAction(bot: Bot) {
    const action = bot.plan[bot.index];
    if (!action) {
      const target = bot.domain?.target;
      if (this.level.mode === "hunt" && target?.tick !== undefined && cellOf(bot, this.level.board.width) === target.cell && this.world.tick <= target.tick + 16) {
        const duration = Math.max(1, Math.min(16, target.tick + 1 - this.world.tick));
        bot.plan = [{ kind: "wait", from: target.cell, to: target.cell, duration }];
        bot.index = 0;
        bot.remaining = duration;
        bot.status = "moving";
        bot.action = "wait";
        return;
      }
      bot.status = "waiting";
      bot.action = null;
      bot.retryAt = this.world.tick;
      return;
    }
    if (!legalActions(this.level, this.world, bot).some((a) => actionEqual(a, action))) {
      bot.status = "waiting";
      bot.retryAt = this.world.tick;
      bot.plan = [];
      bot.route = [];
      bot.action = null;
      return;
    }
    bot.status = "moving";
    bot.remaining = action.duration;
    bot.action = action.kind;
  }
  step(): MatchFrame {
    if (this.finished) return this.snapshot();
    const oldTerrain = [...this.world.terrain];
    const chargerRates = this.world.modeState.mode === "energy" ? this.world.modeState.chargers.map((c) => ({ cell: c.cell, rate: Math.min(4, c.stock) })) : [];
    advanceWorld(this.level, this.world, this.world.tick + 1);
    this.changed = new Set(oldTerrain.flatMap((t, c) => (t !== this.world.terrain[c] ? [c] : [])));
    if (this.world.modeState.mode === "energy")
      for (const [i, c] of this.world.modeState.chargers.entries()) if (Math.min(4, c.stock) !== chargerRates[i].rate) this.changed.add(c.cell);
    for (const b of this.bots) for (const c of this.changed) b.dirty.add(c);
    this.decisionView = null;
    this.decisionView = {
      ...cloneWorld(this.world),
      tasks: Object.fromEntries(this.bots.filter((b) => b.remaining > 0 && b.plan[b.index]).map((b) => [b.id, { action: { ...b.plan[b.index] }, remaining: b.remaining }])),
    };
    const intents: Intent[] = [];
    for (const bot of this.bots) {
      if (bot.eliminatedTick !== null) {
        bot.status = "eliminated";
        bot.plan = [];
        bot.route = [];
        bot.remaining = 0;
        continue;
      }
      if (bot.finishTick !== null) continue;
      if (!this.available(bot)) {
        bot.status = "waiting";
        bot.plan = [];
        bot.remaining = 0;
        bot.retryAt = this.world.tick;
      }
      if ((bot.status === "waiting" && this.world.tick >= bot.retryAt) || (bot.algorithm === "dstar-lite" && bot.status === "searching" && bot.dirty.size > 0)) this.plan(bot);
      if (bot.status === "searching" && bot.search) {
        const expanded = bot.search.expanded;
        bot.computeOps += bot.search.advance(SEARCH_OPERATIONS_PER_TICK);
        bot.searchTicks++;
        bot.expanded += bot.search.expanded - expanded;
        bot.memory = Math.max(bot.memory, bot.search.memory);
        bot.visited = [...bot.search.visited];
        bot.frontier = bot.search.frontier();
        if (bot.search.done) {
          if (!bot.search.actions) {
            if (bot.domain) bot.failed.add(bot.domain.target.id);
            bot.status = "waiting";
            bot.retryAt = this.world.tick + 1;
          } else {
            bot.plan = bot.search.actions.map((a) => ({ ...a }));
            bot.index = 0;
            bot.route = bot.search.path?.map((p) => ({ ...p })) ?? [];
            if (!bot.plan.length) {
              bot.status = "waiting";
              bot.retryAt = this.world.tick + 1;
            } else this.readyAction(bot);
          }
        }
      } else if (bot.status === "moving" && bot.remaining > 0) {
        bot.moveTicks++;
        if (--bot.remaining === 0) intents.push({ botId: bot.id, action: bot.plan[bot.index] });
      }
    }
    const accepted = resolveActions(this.level, this.world, intents, this.config.seed);
    for (const { botId, action } of intents) {
      const bot = this.bots.find((b) => b.id === botId)!;
      if (accepted.has(botId)) {
        bot.cost += action.duration;
        if (action.to !== action.from) {
          bot.facing =
            action.to % this.level.board.width > action.from % this.level.board.width
              ? "right"
              : action.to % this.level.board.width < action.from % this.level.board.width
                ? "left"
                : action.to > action.from
                  ? "down"
                  : "up";
          bot.visits.set(action.to, (bot.visits.get(action.to) ?? 0) + 1);
        }
        bot.index++;
        if (action.energyAfter !== undefined && bot.energy !== action.energyAfter) {
          bot.plan = [];
          bot.route = [];
          bot.status = "waiting";
          bot.retryAt = this.world.tick + 1;
          bot.action = null;
        } else this.readyAction(bot);
      } else {
        bot.status = "waiting";
        bot.retryAt = this.world.tick + 1;
        bot.plan = [];
        bot.route = [];
        bot.action = null;
      }
    }
    // A target can walk onto a stationary participant in the same complete tick.

    for (let c = 0; c < oldTerrain.length; c++) if (oldTerrain[c] !== this.world.terrain[c]) for (const b of this.bots) b.dirty.add(c);
    if (this.world.modeState.mode === "energy")
      for (const [i, c] of this.world.modeState.chargers.entries()) if (Math.min(4, c.stock) !== chargerRates[i].rate) for (const b of this.bots) b.dirty.add(c.cell);
    for (const e of this.world.modeState.events) if (e.kind === "reveal" && e.graphChanged && e.cell !== undefined) this.bots.find((b) => b.id === e.botId)?.dirty.add(e.cell);
    this.finished = terminal(this.level, this.world);
    const event = [...this.world.modeState.events].reverse().find((e) => !["step", "reveal", "charge"].includes(e.kind));
    if (event) {
      const names: Partial<Record<typeof event.kind, string>> = {
        crack: "Jejak mulai retak. Cari pijakan berikutnya.",
        collapse: "Sebagian lantai runtuh!",
        catch: "Target tertangkap. Perhatikan kemunculan berikutnya.",
        toggle: "Sambungan listrik dan akses berubah.",
        claim: "Objektif diklaim. Perebutan berlanjut.",
        collect: "Bahan diambil. Stok kembali empat detik lagi.",
        build: "Jembatan baru bisa dipakai semua peserta.",
        push: "Posisi peti berubah. Rencana lawan ikut terpengaruh.",
        dock: "Peti terkunci di tujuan. Satu poin untuk pendorongnya.",
        eliminated: "Satu penjelajah tereliminasi.",
      };
      this.note = names[event.kind] ?? this.note;
    }
    for (const bot of this.bots) {
      bot.detail = botDetail(this.level.mode, bot);
      if (bot.eliminatedTick !== null) {
        bot.status = "eliminated";
        bot.route = [];
      } else if (bot.finishTick !== null) bot.status = "finished";
      else if (this.finished) {
        bot.status = this.level.mode === "fog" ? "stopped" : "finished";
        bot.action = null;
      }
    }
    if (this.finished) this.note = this.world.tick >= this.level.timeLimit ? "Waktu habis. Hasil seluruh peserta telah dihitung." : "Pertandingan selesai. Lihat hasil peserta.";
    return this.snapshot();
  }
  snapshot(): MatchFrame {
    return {
      tick: this.world.tick,
      phase: this.finished ? "finished" : "running",
      terrain: [...this.world.terrain],
      bots: this.bots.map((b) => ({
        id: b.id,
        algorithm: b.algorithm,
        player: b.player,
        x: b.x,
        y: b.y,
        score: b.score,
        inventory: b.inventory,
        energy: b.energy,
        known: [...b.known],
        visible: [...b.visible],
        finishTick: b.finishTick,
        eliminatedTick: b.eliminatedTick,
        facing: b.facing,
        status: b.status,
        expanded: b.expanded,
        memory: b.memory,
        searchTicks: b.searchTicks,
        computeOps: b.computeOps,
        moveTicks: b.moveTicks,
        cost: b.cost,
        visited: [...b.visited],
        frontier: [...b.frontier],
        route: b.route.map((p) => ({ ...p })),
        action: b.action,
        detail: b.detail,
      })),
      modeState: copyModeState(this.world.modeState),
      winners: this.finished ? ruleWinners(this.level.mode, this.bots, this.world.tick) : [],
      note: this.note,
      rulesVersion: this.level.rulesVersion,
    };
  }
}
export function matchResult(frame: MatchFrame): MatchResult {
  const player = frame.bots.find((b) => b.player)!,
    mode = frame.modeState.mode;
  return {
    player: player.algorithm,
    won: frame.winners.includes(player.id),
    draw: frame.winners.length > 1,
    finishTick: player.finishTick,
    score: player.score,
    rulesVersion: frame.rulesVersion,
    metric:
      mode === "fog"
        ? { kind: "time", value: player.finishTick ?? 0 }
        : mode === "collapse"
          ? { kind: "survival", value: player.eliminatedTick ?? frame.tick }
          : { kind: "score", value: player.score },
  };
}
