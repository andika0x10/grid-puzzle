import { adjacent, cellOf, type Action, type RuleBot, type RuleEvent, type RuleWorld } from "./modes";
import { isWalkable, type LevelDefinition, type Point } from "./schema";

interface Base {
  revision: number;
  events: RuleEvent[];
}
export type ExtraState =
  | (Base & { mode: "bomb"; bombs: { cell: number; owner: string; at: number }[]; wood: number[]; flames: { cell: number; until: number }[]; owners: (string | null)[] })
  | (Base & { mode: "snake"; tails: Record<string, number[]>; ready: number[] })
  | (Base & { mode: "flow"; owners: (string | null)[] })
  | (Base & { mode: "portal"; phase: number; owners: (string | null)[] })
  | (Base & { mode: "tactical"; walls: { cell: number; owner: string; until: number }[]; owners: (string | null)[] })
  | (Base & {
      mode: "stealth";
      guards: { index: number; next: number; stunnedUntil: number }[];
      alert: Record<string, number>;
      decoys: Record<string, number>;
      owners: (string | null)[];
    });

export function initialExtra(l: LevelDefinition): ExtraState | undefined {
  const base = { revision: 0, events: [] };
  switch (l.mode) {
    case "bomb":
      return { ...base, mode: "bomb", bombs: [], flames: [], wood: l.bomb.destructible.map((p) => cellOf(p, l.board.width)), owners: l.bomb.gems.map(() => null) };
    case "snake":
      return { ...base, mode: "snake", tails: {}, ready: l.snake.fruit.map(() => 0) };
    case "flow":
      return { ...base, mode: "flow", owners: l.flow.tokens.map(() => null) };
    case "portal":
      return { ...base, mode: "portal", phase: 0, owners: l.portal.tokens.map(() => null) };
    case "tactical":
      return { ...base, mode: "tactical", walls: [], owners: l.tactical.tokens.map(() => null) };
    case "stealth":
      return {
        ...base,
        mode: "stealth",
        guards: l.stealth.guards.map((g) => ({ index: 0, next: g.stepTicks, stunnedUntil: 0 })),
        alert: {},
        decoys: {},
        owners: l.stealth.intel.map(() => null),
      };
  }
}
export function extraTokens(l: LevelDefinition): Point[] {
  switch (l.mode) {
    case "bomb":
      return l.bomb.gems;
    case "snake":
      return l.snake.fruit;
    case "flow":
      return l.flow.tokens;
    case "portal":
      return l.portal.tokens;
    case "tactical":
      return l.tactical.tokens;
    case "stealth":
      return l.stealth.intel;
    default:
      return [];
  }
}
export const isExtra = (l: LevelDefinition) => ["bomb", "snake", "flow", "portal", "tactical", "stealth"].includes(l.mode);
export const transientArena = (l: LevelDefinition) => ["bomb", "snake", "stealth"].includes(l.mode);

export function blastCells(l: LevelDefinition, w: RuleWorld, start: number): number[] {
  const cells = [start],
    width = l.board.width;
  for (const d of [1, -1, width, -width]) {
    let previous = start;
    for (let n = 1; n <= 3; n++) {
      const c = previous + d;
      if (!adjacent(previous, width, l.board.height).includes(c)) break;
      const wood = w.modeState.mode === "bomb" && w.modeState.wood.includes(c);
      if (!isWalkable(w.terrain[c]) && !wood) break;
      cells.push(c);
      if (wood) break;
      previous = c;
    }
  }
  return cells;
}
export function guardCells(l: LevelDefinition, w: RuleWorld): Set<number> {
  const seen = new Set<number>(),
    s = w.modeState;
  if (l.mode !== "stealth" || s.mode !== "stealth") return seen;
  l.stealth.guards.forEach((g, i) => {
    const state = s.guards[i];
    if (state.stunnedUntil > w.tick) return;
    const p = g.route[state.index],
      q = g.route[(state.index + 1) % g.route.length];
    seen.add(cellOf(p, l.board.width));
    const dx = q.x - p.x,
      dy = q.y - p.y;
    for (let n = 1; n <= g.range; n++) {
      const center = { x: p.x + dx * n, y: p.y + dy * n };
      const c = cellOf(center, l.board.width);
      if (center.x < 0 || center.x >= l.board.width || center.y < 0 || center.y >= l.board.height || !isWalkable(w.terrain[c])) break;
      seen.add(c);
      if (n > 1)
        for (const side of [-1, 1]) {
          const x = center.x + dy * side,
            y = center.y + dx * side;
          if (x >= 0 && y >= 0 && x < l.board.width && y < l.board.height && isWalkable(w.terrain[y * l.board.width + x])) seen.add(y * l.board.width + x);
        }
    }
  });
  for (const p of l.stealth.bushes) seen.delete(cellOf(p, l.board.width));
  return seen;
}
export function extraBlocked(l: LevelDefinition, w: RuleWorld, c: number, duration = 4) {
  const s = w.modeState;
  if (s.mode === "snake" && Object.values(s.tails).some((tail) => tail.includes(c))) return true;
  if (s.mode === "bomb" && (s.flames.some((f) => f.cell === c && f.until > w.tick) || s.bombs.some((b) => b.at <= w.tick + duration + 6 && blastCells(l, w, b.cell).includes(c))))
    return true;
  return false;
}
// One input can traverse several cells. Live rules and all path planners share
// this exact transition, including its true duration and portal entry identity.
export function forcedMove(l: LevelDefinition, w: RuleWorld, from: number, entry: number): Action {
  let to = entry,
    duration = w.terrain[entry] === "slow" ? 16 : 4;
  if (l.mode === "portal" && w.modeState.mode === "portal") {
    const pads = l.portal.pads.map((p) => cellOf(p, l.board.width)),
      index = pads.indexOf(entry);
    if (index >= 0) {
      to = pads[(index + 1 + (w.modeState.phase % (pads.length - 1))) % pads.length];
      duration += 2;
    }
  }
  if (l.mode === "flow") {
    const current = l.flow.currents.find((p) => cellOf(p, l.board.width) === entry),
      ice = new Set(l.flow.ice.map((p) => cellOf(p, l.board.width)));
    const delta = current ? current.dy * l.board.width + current.dx : entry - from;
    let remaining = current?.distance ?? (ice.has(entry) ? l.board.width + l.board.height : 0);
    while (remaining-- > 0) {
      const next = to + delta;
      if (!adjacent(to, l.board.width, l.board.height).includes(next) || !isWalkable(w.terrain[next])) break;
      to = next;
      duration += 2;
      if (!current && !ice.has(to)) break;
    }
  }
  return { kind: "move", from, to, duration, ...(to !== entry ? { object: entry } : {}) };
}
export function safeBarrier(l: LevelDefinition, w: RuleWorld, cell: number) {
  if (
    l.mode !== "tactical" ||
    !isWalkable(w.terrain[cell]) ||
    w.bots.some((b) => cellOf(b, l.board.width) === cell) ||
    extraTokens(l).some((p) => cellOf(p, l.board.width) === cell) ||
    l.board.spawns?.some((p) => cellOf(p, l.board.width) === cell)
  )
    return false;
  const goals = extraTokens(l).map((p) => cellOf(p, l.board.width));
  // A placement must preserve access to EVERY remaining objective for EVERY bot.
  const seen = new Set<number>([goals[0]]),
    queue = [...seen];
  for (let i = 0; i < queue.length; i++)
    for (const n of adjacent(queue[i], l.board.width, l.board.height))
      if (n !== cell && isWalkable(w.terrain[n]) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  return goals.every((c) => seen.has(c)) && w.bots.filter((b) => b.eliminatedTick === null).every((b) => seen.has(cellOf(b, l.board.width)));
}
export function extraActions(l: LevelDefinition, w: RuleWorld, b: RuleBot): Action[] {
  const from = cellOf(b, l.board.width),
    out: Action[] = [],
    s = w.modeState;
  extraTokens(l).forEach((p, i) => {
    const ready = s.mode === "snake" ? s.ready[i] <= w.tick : "owners" in s && !s.owners[i];
    if (ready && cellOf(p, l.board.width) === from) out.push({ kind: "claim", from, to: from, object: i, duration: 4 });
  });
  if (l.mode === "bomb" && s.mode === "bomb" && !s.bombs.some((bomb) => bomb.owner === b.id)) out.push({ kind: "bomb", from, to: from, duration: 4 });
  if (l.mode === "tactical" && s.mode === "tactical" && s.walls.filter((wall) => wall.owner === b.id).length < 3)
    for (const to of adjacent(from, l.board.width, l.board.height)) if (safeBarrier(l, w, to)) out.push({ kind: "barrier", from, to: from, object: to, duration: 8 });
  if (l.mode === "stealth" && s.mode === "stealth" && (s.decoys[b.id] ?? 0) <= w.tick) out.push({ kind: "distract", from, to: from, duration: 4 });
  return out;
}
export function resolveExtra(l: LevelDefinition, w: RuleWorld, b: RuleBot, a: Action) {
  const s = w.modeState,
    width = l.board.width;
  if (a.kind === "move" && s.mode === "snake" && l.mode === "snake") {
    const tail = (s.tails[b.id] ??= []);
    tail.unshift(a.from);
    tail.length = Math.min(tail.length, l.snake.initialLength + Math.min(9, b.score));
    s.revision++;
  }
  if (a.kind === "move" && s.mode === "portal" && l.mode === "portal" && l.portal.pads.some((p) => cellOf(p, width) === (a.object ?? a.to))) {
    s.phase++;
    s.revision++;
    s.events.push({ kind: "teleport", botId: b.id, cell: a.to });
  }
  if (a.kind === "bomb" && s.mode === "bomb" && l.mode === "bomb") {
    s.bombs.push({ cell: a.from, owner: b.id, at: w.tick + l.bomb.fuseTicks });
    s.revision++;
    s.events.push({ kind: "bomb", botId: b.id, cell: a.from });
  }
  if (a.kind === "barrier" && s.mode === "tactical" && l.mode === "tactical" && safeBarrier(l, w, a.object!)) {
    s.walls.push({ cell: a.object!, owner: b.id, until: w.tick + l.tactical.wallTicks });
    w.terrain[a.object!] = "wall";
    s.revision++;
    s.events.push({ kind: "barrier", botId: b.id, cell: a.object });
  }
  if (a.kind === "distract" && s.mode === "stealth" && l.mode === "stealth") {
    s.decoys[b.id] = w.tick + 100;
    l.stealth.guards.forEach((g, i) => {
      const p = g.route[s.guards[i].index];
      if (Math.abs(p.x - b.x) + Math.abs(p.y - b.y) <= 5) s.guards[i].stunnedUntil = w.tick + 36;
    });
    s.revision++;
    s.events.push({ kind: "distract", botId: b.id, cell: a.from });
  }
  if (a.kind === "claim" && isExtra(l)) {
    if (s.mode === "snake") {
      s.ready[a.object!] = w.tick + 100;
      b.score++;
    } else if ("owners" in s) {
      s.owners[a.object!] = b.id;
      b.score += l.mode === "stealth" ? 3 : 2;
    }
    s.revision++;
  }
}
export function advanceExtra(l: LevelDefinition, w: RuleWorld) {
  const s = w.modeState;
  if (s.mode === "tactical")
    for (const wall of [...s.walls])
      if (wall.until <= w.tick) {
        w.terrain[wall.cell] = l.board.terrain[wall.cell];
        s.walls.splice(s.walls.indexOf(wall), 1);
        s.revision++;
      }
  if (s.mode === "bomb") {
    s.flames = s.flames.filter((f) => f.until > w.tick);
    let pending = s.bombs.filter((b) => b.at <= w.tick);
    while (pending.length) {
      const bomb = pending.shift()!;
      if (!s.bombs.includes(bomb)) continue;
      s.bombs.splice(s.bombs.indexOf(bomb), 1);
      const cells = blastCells(l, w, bomb.cell),
        owner = w.bots.find((b) => b.id === bomb.owner);
      for (const cell of cells) {
        s.flames.push({ cell, until: w.tick + 6 });
        if (s.wood.includes(cell)) {
          s.wood.splice(s.wood.indexOf(cell), 1);
          w.terrain[cell] = "ground";
          if (owner) owner.score++;
        }
        pending.push(...s.bombs.filter((b) => b.cell === cell));
        for (const b of w.bots)
          if (b.eliminatedTick === null && cellOf(b, l.board.width) === cell) {
            b.eliminatedTick = w.tick;
            if (owner && owner.id !== b.id) owner.score += 3;
            s.events.push({ kind: "eliminated", botId: b.id });
          }
      }
      s.events.push({ kind: "explosion", cell: bomb.cell });
      s.revision++;
    }
    for (const b of w.bots)
      if (b.eliminatedTick === null && s.flames.some((f) => f.cell === cellOf(b, l.board.width))) {
        b.eliminatedTick = w.tick;
        s.events.push({ kind: "eliminated", botId: b.id });
      }
  }
  if (l.mode === "stealth" && s.mode === "stealth") {
    l.stealth.guards.forEach((g, i) => {
      const state = s.guards[i];
      if (state.stunnedUntil <= w.tick && state.next <= w.tick) {
        state.index = (state.index + 1) % g.route.length;
        state.next = w.tick + g.stepTicks;
        s.revision++;
      }
    });
    const seen = guardCells(l, w);
    for (const b of w.bots)
      if (b.eliminatedTick === null) {
        const cell = cellOf(b, l.board.width);
        s.alert[b.id] = seen.has(cell) ? (s.alert[b.id] ?? 0) + 1 : Math.max(0, (s.alert[b.id] ?? 0) - 2);
        if (s.alert[b.id] >= 20) {
          b.eliminatedTick = w.tick;
          s.events.push({ kind: "eliminated", botId: b.id });
        }
      }
  }
}
export function extraTerminal(l: LevelDefinition, w: RuleWorld) {
  const s = w.modeState;
  return (
    ((s.mode === "bomb" || s.mode === "snake") && w.tick > 80 && w.bots.filter((b) => b.eliminatedTick === null).length <= 1) ||
    (isExtra(l) && "owners" in s && s.owners.length > 0 && s.owners.every(Boolean))
  );
}
