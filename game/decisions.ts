import { MeteredSearch } from "./search";
import { botTerrain, copyModeState, distance, isRaceMode, objectives, resolveModeTick, ruleWinners, samePoint, type ModeState, type RuleBot } from "./modes";
import { isWalkable, terrainCost, type LevelDefinition, type Point, type Terrain } from "./schema";
import { applyTerrainChanges, gemActive, gemPending, gemsSettled, maximumGemPoints, resolveGemClaims, type CompetitiveGem } from "./classic";

type Work<T = void> = Generator<void, T, unknown>;
export function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export class RandomDecision extends MeteredSearch {
  constructor(
    private width: number,
    private height: number,
    private terrain: Terrain[],
    private start: Point,
    private previous: Point | null,
    private random: () => number
  ) {
    super();
  }
  frontier() {
    return [];
  }
  protected *run(): Work {
    const cell = this.start.y * this.width + this.start.x;
    let next = yield* this.inspect(cell, this.width, this.height, this.terrain);
    if (next.length > 1 && this.previous) next = next.filter((c) => c !== this.previous!.y * this.width + this.previous!.x);
    yield;
    this.expanded = 1;
    this.visited.add(cell);
    this.memory = next.length + 1;
    const target = next[Math.floor(this.random() * next.length)];
    yield;
    yield* this.complete(target === undefined ? [cell] : [cell, target], this.width);
  }
}
export type SimulationGem = CompetitiveGem;
export interface SimBot extends RuleBot {
  remaining: number;
  intention: Point | null;
}
export interface DecisionState {
  tick: number;
  terrain: Terrain[];
  bots: SimBot[];
  modeState: ModeState;
  gems: SimulationGem[];
  appliedChanges?: number[];
}
function cloneState(s: DecisionState): DecisionState {
  return {
    tick: s.tick,
    terrain: [...s.terrain],
    bots: s.bots.map((b) => ({ ...b, keys: [...b.keys], checkpoints: [...b.checkpoints], intention: b.intention ? { ...b.intention } : null })),
    modeState: copyModeState(s.modeState),
    gems: s.gems.map((g) => ({ ...g })),
    appliedChanges: [...(s.appliedChanges ?? [])],
  };
}
interface Node {
  state: DecisionState;
  parent: Node | null;
  action: Point | null;
  children: Node[];
  untried: Point[] | null;
  visits: number;
  value: number;
}
const MAX_OPERATIONS = 32 * 16,
  RESERVED_FINISH = 16;
export class MctsDecision extends MeteredSearch {
  private root: Node;
  private finishing = false;
  constructor(
    private level: LevelDefinition,
    private actor: number,
    state: DecisionState,
    private seed: number,
    private random: () => number
  ) {
    super();
    this.root = { state: cloneState(state), parent: null, action: null, children: [], untried: null, visits: 0, value: 0 };
  }
  frontier() {
    return this.root.children.flatMap((n) => (n.action ? [n.action.y * this.level.board.width + n.action.x] : []));
  }
  advance(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) throw new Error("Anggaran komputasi harus berupa angka nonnegatif.");
    if (this.done) return 0;
    let used = 0;
    if (!this.finishing) used = super.advance(Math.min(Math.floor(budget), Math.max(0, MAX_OPERATIONS - RESERVED_FINISH - this.operations)));
    if (!this.done && this.operations >= MAX_OPERATIONS - RESERVED_FINISH && !this.finishing) {
      this.work = this.finish();
      this.finishing = true;
    }
    if (this.finishing && used < Math.floor(budget)) used += super.advance(Math.floor(budget) - used);
    return used;
  }
  private *actions(state: DecisionState, actor = this.actor): Work<Point[]> {
    const bot = state.bots[actor],
      { width, height } = this.level.board;
    const terrain = botTerrain(this.level, state.modeState, state.terrain, bot, state.tick);
    const cells = yield* this.inspect(bot.y * width + bot.x, width, height, terrain);
    const actions = cells.map((c) => ({ x: c % width, y: Math.floor(c / width) }));
    actions.push({ x: bot.x, y: bot.y });
    yield;
    return actions;
  }
  private *transition(source: DecisionState, action: Point): Work<DecisionState> {
    const state = cloneState(source),
      actor = state.bots[this.actor],
      { width } = this.level.board;
    const duration = samePoint(actor, action) ? 1 : terrainCost(state.terrain[action.y * width + action.x]) * 4;
    actor.intention = { ...action };
    actor.remaining = duration;
    for (let t = 0; t < duration && state.tick < this.level.timeLimit; t++) {
      state.tick++;
      const applied = new Set(state.appliedChanges);
      applyTerrainChanges(this.level, state.terrain, state.bots, state.tick, applied);
      state.appliedChanges = [...applied];
      const arrivals = new Set<string>();
      // Hazards activate before movement, just as in the live tick.
      if (this.level.mode === "survival")
        for (const bot of state.bots) {
          const at = state.modeState.dangerAt[bot.y * width + bot.x];
          if (bot.eliminatedTick === null && at && at <= state.tick) bot.eliminatedTick = state.tick;
          yield;
        }
      for (let i = 0; i < state.bots.length; i++) {
        const bot = state.bots[i];
        if (bot.eliminatedTick !== null || bot.finishTick !== null) continue;
        if (i !== this.actor && bot.remaining <= 0) {
          const options = yield* this.actions(state, i);
          bot.intention = options[Math.floor(this.random() * options.length)];
          bot.remaining = samePoint(bot, bot.intention!) ? 1 : terrainCost(state.terrain[bot.intention!.y * width + bot.intention!.x]) * 4;
        }
        if (bot.remaining > 0 && --bot.remaining === 0 && bot.intention) {
          const legal = botTerrain(this.level, state.modeState, state.terrain, bot, state.tick);
          if (isWalkable(legal[bot.intention.y * width + bot.intention.x])) {
            if (!samePoint(bot, bot.intention)) arrivals.add(bot.id);
            bot.x = bot.intention.x;
            bot.y = bot.intention.y;
          }
          bot.intention = null;
        }
        yield;
      }
      resolveModeTick(this.level, state.modeState, state.bots, state.tick, arrivals, this.seed);
      if (this.level.mode === "gems") resolveGemClaims(state.gems, state.bots, state.tick, this.seed, this.level);
      yield;
      if (this.terminal(state)) break;
    }
    this.expanded++;
    this.visited.add(actor.y * width + actor.x);
    return state;
  }
  private terminal(state: DecisionState) {
    return (
      state.tick >= this.level.timeLimit ||
      (isRaceMode(this.level.mode) && state.bots.some((b) => b.finishTick !== null)) ||
      (this.level.mode === "survival" && state.bots.filter((b) => b.eliminatedTick === null).length <= 1) ||
      (this.level.mode === "cargo" && state.modeState.parcels.every((p) => p.state === "delivered")) ||
      (this.level.mode === "gems" && gemsSettled(state.gems))
    );
  }
  private evaluate(state: DecisionState) {
    const bot = state.bots[this.actor],
      board = this.level.board;
    if (this.terminal(state)) {
      const winners = ruleWinners(this.level.mode, state.bots, state.tick);
      return winners.includes(bot.id) ? (winners.length === 1 ? 1 : 0.5) : -1;
    }
    if (bot.eliminatedTick !== null) return -1;
    if (bot.finishTick !== null) return 1;
    const available = state.gems.filter((g) => gemActive(g, state.tick));
    const targets =
      this.level.mode === "gems" ? (available.length ? available : state.gems.filter((g) => gemPending(g, state.tick))) : objectives(this.level, state.modeState, bot, state.tick);
    const nearest = targets.length ? Math.min(...targets.map((p) => distance(bot, p))) : 0;
    const progress = 1 - nearest / (board.width + board.height);
    const rivals = Math.max(0, ...state.bots.filter((b) => b.id !== bot.id).map((b) => b.score));
    switch (this.level.mode) {
      case "cargo":
        return 0.2 * progress + (0.8 * (bot.score + 0.2 * bot.inventory - rivals)) / Math.max(1, board.parcels.length);
      case "gems":
        return 0.2 * progress + (0.8 * (bot.score - rivals)) / Math.max(1, maximumGemPoints(this.level));
      case "race":
        return board.checkpoints.length ? (0.55 * bot.checkpoints.length) / board.checkpoints.length + 0.35 * progress : 0.9 * progress;
      case "territory":
        return 0.2 * progress + (0.8 * (bot.score - rivals)) / board.terrain.length;
      case "outposts":
        return 0.15 * progress + (0.5 * state.modeState.posts.filter((p) => p.owner === bot.id).length) / 3 + (0.35 * (bot.score - rivals)) / Math.max(1, (state.tick / 20) * 3);
      case "keys":
        return 0.4 * progress + (0.5 * bot.keys.length) / Math.max(1, board.keys.length);
      case "survival": {
        const at = state.modeState.dangerAt[bot.y * board.width + bot.x] || this.level.timeLimit + 1;
        return 0.4 * progress + 0.6 * Math.min(1, (at - state.tick) / 100);
      }
      default:
        return 0.9 * progress;
    }
  }
  private *finish(): Work {
    let best: Node | null = null;
    for (const node of this.root.children) {
      if (!best || node.visits > best.visits || (node.visits === best.visits && node.value / Math.max(1, node.visits) > best.value / Math.max(1, best.visits))) best = node;
      yield;
    }
    const bot = this.root.state.bots[this.actor],
      target = best?.action ?? this.root.untried?.[0] ?? bot;
    const width = this.level.board.width,
      from = bot.y * width + bot.x,
      to = target.y * width + target.x;
    yield* this.complete(from === to ? [from] : [from, to], width);
  }
  protected *run(): Work {
    for (let rollout = 0; rollout < 8; rollout++) {
      let node = this.root,
        depth = 0;
      while (depth < 4 && !this.terminal(node.state)) {
        node.untried ??= yield* this.actions(node.state);
        if (node.untried.length) {
          const index = Math.floor(this.random() * node.untried.length),
            action = node.untried.splice(index, 1)[0];
          yield;
          const state = yield* this.transition(node.state, action);
          const child: Node = { state, parent: node, action, children: [], untried: null, visits: 0, value: 0 };
          node.children.push(child);
          node = child;
          depth++;
          this.memory++;
          break;
        }
        let best: Node | null = null,
          value = -Infinity;
        for (const child of node.children) {
          const uct = child.value / Math.max(1, child.visits) + Math.sqrt((2 * Math.log(Math.max(1, node.visits))) / Math.max(1, child.visits));
          if (uct > value) {
            best = child;
            value = uct;
          }
          yield;
        }
        if (!best) break;
        node = best;
        depth++;
      }
      let state = node.state;
      while (depth++ < 4 && !this.terminal(state) && state.bots[this.actor].eliminatedTick === null && state.bots[this.actor].finishTick === null) {
        const choices = yield* this.actions(state);
        state = yield* this.transition(state, choices[Math.floor(this.random() * choices.length)]);
      }
      const reward = this.evaluate(state);
      yield;
      let back: Node | null = node;
      while (back) {
        back.visits++;
        back.value += reward;
        back = back.parent;
        yield;
      }
    }
    yield* this.finish();
  }
}
