import { MeteredSearch } from "./search";
import { ModeDomain, type PlanState, type Work } from "./planning";
import {
  actionEqual,
  advanceWorld,
  cellOf,
  cloneWorld,
  legalActions,
  resolveActions,
  ruleWinners,
  terminal,
  type Action,
  type Intent,
  type RuleBot,
  type RuleWorld,
} from "./modes";
import type { LevelDefinition } from "./schema";
import { blastCells, extraBlocked, guardCells } from "./extra-modes";
export function randomSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function usefulActions(l: LevelDefinition, w: RuleWorld, b: RuleBot, domain: ModeDomain) {
  const all = legalActions(l, w, b);
  return all.filter(
    (a) =>
      a.kind !== "wait" ||
      (l.mode === "hunt" && domain.target.cell === a.from) ||
      (l.mode === "bridge" && l.bridge.supplies.some((p) => cellOf(p, l.board.width) === a.from)) ||
      (l.mode === "energy" && l.energy.chargers.some((p) => cellOf(p, l.board.width) === a.from)) ||
      (a.kind === "wait" && l.mode === "stealth")
  );
}
export class RandomDecision extends MeteredSearch {
  constructor(
    private level: LevelDefinition,
    private world: RuleWorld,
    private bot: RuleBot,
    private domain: ModeDomain,
    private visits: ReadonlyMap<number, number>,
    private random: () => number
  ) {
    super();
  }
  frontier() {
    return [];
  }
  protected *run(): Work {
    for (let i = 0; i < this.domain.preparation; i++) yield;
    const actions = usefulActions(this.level, this.world, this.bot, this.domain),
      edges = yield* this.domain.successors(this.domain.start);
    const weighted: { action: Action; weight: number }[] = [];
    let total = 0;
    for (const action of actions) {
      const edge = edges.find((e) => actionEqual(e.action, action));
      const next = edge?.state ?? this.domain.start;
      const gain = this.domain.utility(next) - this.domain.utility(this.domain.start);
      let weight = Math.exp(Math.max(-3, Math.min(3, gain * 14))) / (1 + (this.visits.get(action.to) ?? 0) * 0.7);
      if (action.kind === "claim") weight *= 100;
      if (action.kind === "build") weight *= 5;
      if (action.kind === "collect" && this.bot.inventory < 2) weight *= 8;
      if (action.kind === "charge") weight *= this.bot.energy < 12 ? 30 : 2;
      if (action.kind === "wait") weight *= 0.15;
      weighted.push({ action, weight });
      total += weight;
      yield;
    }
    let chosen: Action | undefined;
    if (weighted.length) {
      if (this.random() < 0.15) chosen = weighted[Math.floor(this.random() * weighted.length)].action;
      else {
        let roll = this.random() * total;
        for (const item of weighted) {
          roll -= item.weight;
          if (roll <= 0) {
            chosen = item.action;
            break;
          }
          yield;
        }
        chosen ??= weighted.at(-1)!.action;
      }
    }
    this.expanded = 1;
    this.memory = weighted.length + this.visits.size;
    this.visited.add(this.domain.start.cell);
    yield* this.complete(chosen ? [chosen] : null, this.level.board.width, this.domain.start.cell);
  }
}
export interface DecisionState extends RuleWorld {
  tasks?: Record<string, { action: Action; remaining: number }>;
}
interface Node {
  state: DecisionState;
  parent: Node | null;
  action: Action | null;
  children: Node[];
  untried: Action[] | null;
  visits: number;
  value: number;
}
export const MCTS_MAX_OPERATIONS = 1024;
export class MctsDecision extends MeteredSearch {
  private root: Node;
  private finishing = false;
  private rootDomain: ModeDomain;
  private actorId: string;
  completedRollouts = 0;
  constructor(
    private level: LevelDefinition,
    actor: number,
    state: DecisionState,
    private seed: number,
    private random: () => number,
    private visits: ReadonlyMap<number, number> = new Map()
  ) {
    super();
    this.actorId = state.bots[actor].id;
    const copy = this.copy(state);
    this.root = { state: copy, parent: null, action: null, children: [], untried: null, visits: 0, value: 0 };
    this.rootDomain = new ModeDomain(level, copy, copy.bots[actor], visits);
  }
  private copy(s: DecisionState): DecisionState {
    return { ...cloneWorld(s), tasks: structuredClone(s.tasks ?? {}) };
  }
  frontier() {
    return this.root.children.flatMap((n) => (n.action ? [n.action.to] : []));
  }
  advance(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) throw new Error("Anggaran harus berupa angka nonnegatif.");
    if (this.done) return 0;
    const max = Math.floor(budget);
    let used = 0;
    if (!this.finishing) used = super.advance(Math.min(max, Math.max(0, MCTS_MAX_OPERATIONS - 32 - this.operations)));
    if (!this.done && this.operations >= MCTS_MAX_OPERATIONS - 32 && !this.finishing) {
      this.work = this.finish();
      this.finishing = true;
    }
    if (this.finishing && used < max) used += super.advance(max - used);
    return used;
  }
  private *candidateActions(state: DecisionState): Work<Action[]> {
    const bot = state.bots.find((b) => b.id === this.actorId)!;
    const domain = new ModeDomain(this.level, state, bot, this.visits);
    const actions = usefulActions(this.level, state, bot, domain);
    for (let i = 0; i < actions.length; i++) yield;
    return actions;
  }
  private *opponent(state: DecisionState, bot: RuleBot): Work<Action | undefined> {
    const actions = legalActions(this.level, state, bot).filter((a) => a.kind !== "wait");
    if (!actions.length) return undefined;
    const ownDomain = new ModeDomain(this.level, state, bot);
    for (let i = 0; i < ownDomain.preparation; i++) yield;
    let best = actions[0],
      value = -Infinity;
    for (const a of actions) {
      let v = -(
        Math.abs((a.to % this.level.board.width) - (ownDomain.target.cell % this.level.board.width)) +
        Math.abs(Math.floor(a.to / this.level.board.width) - Math.floor(ownDomain.target.cell / this.level.board.width))
      );
      if (["claim", "build", "collect"].includes(a.kind)) v += 30;
      if (a.kind === "charge") v += bot.energy < 12 ? 40 : 1;
      if (state.modeState.mode === "collapse") v += (state.modeState.dangerAt[a.to] || 1201) / 40;
      if (v > value) {
        best = a;
        value = v;
      }
      yield;
    }
    return this.random() < 0.15 ? actions[Math.floor(this.random() * actions.length)] : best;
  }
  private *transition(source: DecisionState, action: Action): Work<DecisionState> {
    const state = this.copy(source),
      tasks = state.tasks!;
    tasks[this.actorId] = { action, remaining: action.duration };
    for (let t = 0; t < action.duration && state.tick < this.level.timeLimit; t++) {
      advanceWorld(this.level, state, state.tick + 1);
      const intents: Intent[] = [];
      for (const bot of state.bots) {
        if (bot.eliminatedTick !== null || bot.finishTick !== null) continue;
        if (!tasks[bot.id] && bot.id !== this.actorId) {
          const next = yield* this.opponent(state, bot);
          if (next) tasks[bot.id] = { action: next, remaining: next.duration };
        }
        const task = tasks[bot.id];
        if (task && --task.remaining <= 0) {
          intents.push({ botId: bot.id, action: task.action });
          delete tasks[bot.id];
        }
        yield;
      }
      resolveActions(this.level, state, intents, this.seed);
      yield;
      if (terminal(this.level, state)) break;
    }
    this.expanded++;
    const actor = state.bots.find((b) => b.id === this.actorId)!;
    this.visited.add(cellOf(actor, this.level.board.width));
    return state;
  }
  private evaluate(state: DecisionState) {
    const bot = state.bots.find((b) => b.id === this.actorId)!;
    if (terminal(this.level, state)) {
      const winners = ruleWinners(this.level.mode, state.bots, state.tick);
      return winners.includes(bot.id) ? (winners.length === 1 ? 1 : 0.4) : -1;
    }
    if (bot.eliminatedTick !== null) return -1;
    const initial = this.root.state.bots.find((b) => b.id === this.actorId)!,
      target = this.rootDomain.target,
      s = state.modeState;
    const completed =
      bot.score > initial.score ||
      (target.kind === "collect" && bot.inventory > initial.inventory) ||
      (target.kind === "charge" && bot.energy === 24 && initial.energy < 24) ||
      (target.kind === "build" && s.mode === "bridge" && s.builders[target.object!] === bot.id);
    if (completed) return Math.min(0.94, 0.8 + (bot.score - initial.score) * 0.03);
    const domain = new ModeDomain(this.level, state, bot, this.visits),
      potential = this.rootDomain.utility(domain.start);
    const rival = Math.max(0, ...state.bots.filter((b) => b.id !== bot.id).map((b) => b.score));
    return Math.max(-0.95, Math.min(0.95, 0.35 * potential + 0.12 * (bot.score - rival)));
  }
  private prior(action: Action) {
    let value = 0;
    if (["claim", "build", "collect"].includes(action.kind)) value += 1;
    if (action.kind === "charge") value += this.root.state.bots.find((b) => b.id === this.actorId)!.energy < 12 ? 1 : -0.2;
    const p: PlanState = { ...this.rootDomain.start, cell: action.to };
    value += this.rootDomain.utility(p);
    if (action.kind === "wait") value -= 0.15;
    return value;
  }
  private *finish(): Work {
    let best: Node | null = null;
    for (const node of this.root.children) {
      if (node.visits > 0 && (!best || node.visits > best.visits || (node.visits === best.visits && node.value / node.visits > best.value / best.visits))) best = node;
      yield;
    }
    let action = best?.action ?? null;
    if (!action) {
      const options =
        this.root.untried ??
        usefulActions(
          this.level,
          this.root.state,
          this.root.state.bots.find((b) => b.id === this.actorId)!,
          this.rootDomain
        );
      action = [...options].sort((a, b) => this.prior(b) - this.prior(a))[0] ?? null;
    }
    yield* this.complete(action ? [action] : null, this.level.board.width, this.rootDomain.start.cell);
  }
  protected *run(): Work {
    for (let i = 0; i < this.rootDomain.preparation; i++) yield;
    for (let rollout = 0; rollout < 32; rollout++) {
      let node = this.root,
        depth = 0;
      while (depth < 8 && !terminal(this.level, node.state)) {
        node.untried ??= yield* this.candidateActions(node.state);
        if (node.untried.length) {
          node.untried.sort((a, b) => this.prior(b) - this.prior(a));
          const action = node.untried.splice(0, 1)[0];
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
          const uct =
            child.value / Math.max(1, child.visits) +
            Math.sqrt((2 * Math.log(Math.max(1, node.visits))) / Math.max(1, child.visits)) +
            (0.2 * this.prior(child.action!)) / (1 + child.visits);
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
      const rootCoverage = this.root.children.some((c) => c.visits === 0) || (this.root.untried?.length ?? 0) > 0;
      // Cover root choices with short completed simulations before deeper rollouts.
      while (!rootCoverage && depth++ < 8 && !terminal(this.level, state) && state.bots.find((b) => b.id === this.actorId)!.eliminatedTick === null) {
        const options = yield* this.candidateActions(state);
        if (!options.length) break;
        options.sort((a, b) => this.prior(b) - this.prior(a));
        const action = this.random() < 0.2 ? options[Math.floor(this.random() * options.length)] : options[0];
        state = yield* this.transition(state, action);
      }
      const reward = this.evaluate(state);
      yield;
      for (let back: Node | null = node; back; back = back.parent) {
        back.visits++;
        back.value += reward;
        yield;
      }
      this.completedRollouts++;
      if (this.root.untried?.length === 0 && this.root.children.every((c) => c.visits > 0)) {
        const ranked = [...this.root.children].sort((a, b) => b.value / b.visits - a.value / a.visits);
        if (ranked.length <= 1 || ranked[0].value / ranked[0].visits - ranked[1].value / ranked[1].visits > 0.01 || this.completedRollouts >= 12) break;
      }
    }
    yield* this.finish();
  }
}

/** Depth-limited multiplayer search over simultaneous commitments. Opponents
 * choose for their own utility (Max-n) or minimize the root utility (Paranoid).
 * Existing actions retain their remaining duration in every simulated tick. */
export class MultiplayerDecision extends MeteredSearch {
  private best: Action | null = null;
  private finishing = false;
  private actorId: string;
  private rootDomain: ModeDomain;
  private rootValues = new Map<Action, number>();
  constructor(
    private level: LevelDefinition,
    private state: DecisionState,
    actor: RuleBot,
    private seed: number,
    private paranoid: boolean,
    private visits: ReadonlyMap<number, number>
  ) {
    super();
    this.actorId = actor.id;
    this.rootDomain = new ModeDomain(level, state, actor, visits);
  }
  frontier() {
    return [...this.rootValues.keys()].map((a) => a.to);
  }
  advance(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) throw Error("Anggaran harus berupa angka nonnegatif.");
    let used = super.advance(Math.min(Math.floor(budget), Math.max(0, 2016 - this.operations)));
    if (!this.done && this.operations >= 2016 && !this.finishing) {
      this.work = this.finish();
      this.finishing = true;
    }
    if (this.finishing && used < budget) used += super.advance(Math.floor(budget) - used);
    return used;
  }
  private *options(w: DecisionState, b: RuleBot, count: number): Work<Action[]> {
    const domain = new ModeDomain(this.level, w, b, b.id === this.actorId ? this.visits : new Map());
    for (let i = 0; i < domain.preparation; i++) yield;
    const edges = yield* domain.successors(domain.start),
      actions = usefulActions(this.level, w, b, domain);
    const score = (a: Action) => {
      const next = edges.find((e) => actionEqual(e.action, a))?.state ?? domain.start;
      let value = domain.utility(next);
      if (["claim", "build", "collect"].includes(a.kind)) value += 3;
      if (a.kind === "distract" && guardCells(this.level, w).has(a.from)) value += 2;
      if (a.kind === "bomb" && w.modeState.mode === "bomb") {
        const cells = blastCells(this.level, w, a.from);
        value += cells.filter((c) => w.modeState.mode === "bomb" && w.modeState.wood.includes(c)).length * 0.5 - 0.3;
      }
      if (a.kind === "barrier") value -= 0.15;
      if (a.kind === "wait") value -= 0.2;
      return value;
    };
    const ranked = actions.map((a) => ({ a, value: score(a) }));
    for (let i = 0; i < ranked.length; i++) yield;
    ranked.sort((a, b) => b.value - a.value);
    return ranked.slice(0, count).map((v) => v.a);
  }
  private *simulate(intents: Intent[]): Work<number[]> {
    const w: DecisionState = { ...cloneWorld(this.state), tasks: structuredClone(this.state.tasks ?? {}) };
    for (const i of intents) if (!w.tasks![i.botId]) w.tasks![i.botId] = { action: i.action, remaining: i.action.duration };
    const duration = Math.max(1, ...Object.values(w.tasks!).map((t) => t.remaining));
    for (let tick = 0; tick < duration && !terminal(this.level, w); tick++) {
      advanceWorld(this.level, w, w.tick + 1);
      const completed: Intent[] = [];
      for (const b of w.bots) {
        const task = w.tasks![b.id];
        if (task && --task.remaining <= 0) {
          completed.push({ botId: b.id, action: task.action });
          delete w.tasks![b.id];
        }
        yield;
      }
      resolveActions(this.level, w, completed, this.seed);
      yield;
    }
    this.expanded++;
    const sight = guardCells(this.level, w),
      values: number[] = [];
    for (const b of w.bots) {
      if (b.eliminatedTick !== null) values.push(-1000);
      else {
        const d =
          b.id === this.actorId
            ? this.rootDomain
            : new ModeDomain(
                this.level,
                this.state,
                this.state.bots.find((v) => v.id === b.id)!
              );
        const start = { ...d.start, cell: cellOf(b, this.level.board.width), energy: this.level.mode === "energy" ? b.energy : 0, inventory: b.inventory };
        values.push(
          b.score * 20 + (b.finishTick !== null ? 500 : 0) + d.utility(start) * 8 - (sight.has(start.cell) ? 4 : 0) - (extraBlocked(this.level, w, start.cell, 24) ? 12 : 0)
        );
      }
      yield;
    }
    return values;
  }
  private *responses(players: { bot: RuleBot; options: Action[] }[], index: number, intents: Intent[]): Work<number[]> {
    if (index >= players.length) return yield* this.simulate(intents);
    const p = players[index],
      actorIndex = this.state.bots.findIndex((b) => b.id === p.bot.id),
      root = this.state.bots.findIndex((b) => b.id === this.actorId);
    let chosen: number[] | null = null;
    for (const a of p.options) {
      const result = yield* this.responses(players, index + 1, [...intents, { botId: p.bot.id, action: a }]);
      if (!chosen || (this.paranoid ? result[root] < chosen[root] : result[actorIndex] > chosen[actorIndex])) chosen = result;
      yield;
    }
    return chosen ?? (yield* this.simulate(intents));
  }
  private *finish(): Work {
    yield* this.complete(this.best ? [this.best] : null, this.level.board.width, this.rootDomain.start.cell);
  }
  protected *run(): Work {
    const actor = this.state.bots.find((b) => b.id === this.actorId)!,
      root = this.state.bots.indexOf(actor);
    const options = yield* this.options(this.state, actor, 4);
    this.best = options[0] ?? null;
    const opponents: { bot: RuleBot; options: Action[] }[] = [];
    for (const b of this.state.bots)
      if (b.id !== actor.id && b.eliminatedTick === null && !this.state.tasks?.[b.id]) opponents.push({ bot: b, options: yield* this.options(this.state, b, 2) });
    let bestValue = -Infinity;
    for (const a of options) {
      const values = yield* this.responses(opponents, 0, [{ botId: actor.id, action: a }]);
      const value = values[root] - Math.max(...values.filter((_, i) => i !== root), 0) * 0.25;
      this.rootValues.set(a, value);
      if (value > bestValue) {
        bestValue = value;
        this.best = a;
      }
      this.visited.add(a.to);
      this.memory = Math.max(this.memory, this.state.terrain.length * (opponents.length + 2));
      yield;
    }
    yield* this.finish();
  }
}
