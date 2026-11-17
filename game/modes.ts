import { isWalkable, terrainCost, type GameMode, type LevelDefinition, type Point, type Terrain } from "./schema";
export const modeInfo: Record<GameMode, { title: string; unit: string; help: string }> = {
  fog: {
    title: "Labirin Kabut",
    unit: "dtk",
    help: "Cari jalan keluar dengan pemindai radius dua petak. Pengetahuan tiap bot terpisah. Rute yang belum terlihat hanya dugaan; penemuan baru dapat memaksa pencarian ulang.",
  },
  collapse: {
    title: "Lantai Runtuh",
    unit: "dtk bertahan",
    help: "Lantai runtuh 24 tick setelah ditinggalkan. Gelombang keruntuhan juga menyapu arena. Spawn terlindungi delapan detik. Terus bergerak dan bertahan paling lama; bot tanpa pijakan lanjutan tereliminasi. Retakan berlaku untuk semua bot.",
  },
  hunt: {
    title: "Perburuan Bergerak",
    unit: "poin",
    help: "Potong lintasan target bergerak. Satu tangkapan memberi satu poin, lalu target muncul kembali satu detik kemudian. Garis putus menunjukkan lintasannya. Raih poin terbanyak.",
  },
  circuit: {
    title: "Sambung Sirkuit",
    unit: "poin",
    help: "Datangi saklar untuk mengubah sambungan dan gerbang bersama. Cocokkan seluruh saklar dengan pola kontrak, lalu klaim terminal menyala untuk tiga poin. Setiap klaim membuka kontrak berikutnya.",
  },
  energy: {
    title: "Ekspedisi Energi",
    unit: "poin",
    help: "Energi maksimal 24. Langkah biasa memakai satu, medan lambat empat. Aktifkan suar dengan lima energi untuk tiga poin. Stasiun bersama mengisi empat energi per tick, memiliki stok 40, dan pulih satu per tick. Kehabisan energi di luar stasiun membuat bot mogok.",
  },
  bridge: {
    title: "Jembatan Rakitan",
    unit: "poin",
    help: "Ambil bahan, lalu bangun bentang bertanda untuk dua poin. Semua bot dapat memakai jembatan jadi. Penanda pulau memberi tiga poin. Setelah semua penanda diklaim, keluar memberi lima dan mengakhiri pertandingan. Bahan maksimal tiga, muncul kembali setiap empat detik.",
  },
  crates: {
    title: "Dorong Peti",
    unit: "peti",
    help: "Dorong peti ke tujuan bercorak. Satu peti memberi satu poin kepada pendorongnya dan terkunci. Peti bersama bisa membantu atau mengganggu rencana lawan. Dorongan ke sudut mati ditolak.",
  },
};
export const isRaceMode = (m: GameMode) => m === "fog";
export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const cellOf = (p: Point, w: number) => p.y * w + p.x;
export const pointOf = (c: number, w: number): Point => ({ x: c % w, y: Math.floor(c / w) });
export function seededHash(text: string, seed: number) {
  let h = seed >>> 0;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
export interface RuleBot extends Point {
  id: string;
  algorithm: string;
  score: number;
  inventory: number;
  energy: number;
  known: (Terrain | null)[];
  visible: number[];
  finishTick: number | null;
  eliminatedTick: number | null;
}
export type ActionKind = "move" | "wait" | "toggle" | "claim" | "charge" | "collect" | "build" | "push";
export interface Action {
  kind: ActionKind;
  from: number;
  to: number;
  duration: number;
  object?: number;
  expected?: number;
  energyAfter?: number;
}
export interface RuleEvent {
  kind: "step" | "reveal" | "crack" | "collapse" | "catch" | "toggle" | "claim" | "charge" | "collect" | "build" | "push" | "dock" | "eliminated";
  botId?: string;
  cell?: number;
  object?: number;
  graphChanged?: boolean;
}
interface BaseState {
  revision: number;
  events: RuleEvent[];
}
export type ModeState =
  | (BaseState & { mode: "fog" })
  | (BaseState & { mode: "collapse"; dangerAt: number[]; nextCollapse: number })
  | (BaseState & { mode: "hunt"; targets: { cell: number; routeIndex: number; nextMove: number; respawnAt: number; active: boolean }[] })
  | (BaseState & { mode: "circuit"; mask: number; contract: number; owners: string[] })
  | (BaseState & { mode: "energy"; chargers: { cell: number; stock: number }[]; owners: (string | null)[] })
  | (BaseState & { mode: "bridge"; builtMask: number; suppliesReady: number[]; builders: (string | null)[]; owners: (string | null)[] })
  | (BaseState & { mode: "crates"; boxes: { id: number; cell: number; owner: string | null }[]; deadCells: number[] });
export interface RuleWorld {
  tick: number;
  terrain: Terrain[];
  bots: RuleBot[];
  modeState: ModeState;
}
export function adjacent(cell: number, width: number, height: number) {
  const x = cell % width,
    y = Math.floor(cell / width);
  return [
    [x + 1, y],
    [x, y - 1],
    [x - 1, y],
    [x, y + 1],
  ]
    .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < width && ny < height)
    .map(([nx, ny]) => ny * width + nx);
}
export function deadSquares(level: LevelDefinition) {
  if (level.mode !== "crates") return [];
  const { width: w, height: h, terrain } = level.board;
  const seen = new Set(level.crates.docks.map((p) => cellOf(p, w))),
    queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (const n of adjacent(c, w, h)) {
      const behind = 2 * n - c;
      if (Math.abs((behind % w) - (n % w)) + Math.abs(Math.floor(behind / w) - Math.floor(n / w)) !== 1) continue;
      if (behind >= 0 && behind < terrain.length && isWalkable(terrain[n]) && isWalkable(terrain[behind]) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return terrain.flatMap((t, c) => (isWalkable(t) && !seen.has(c) ? [c] : []));
}
export function initialModeState(l: LevelDefinition): ModeState {
  const base = { revision: 0, events: [] };
  switch (l.mode) {
    case "fog":
      return { ...base, mode: "fog" };
    case "collapse": {
      const dangerAt = Array<number>(l.board.terrain.length).fill(0);
      for (const wave of l.collapse.waves)
        for (const p of wave.cells) {
          const c = cellOf(p, l.board.width);
          dangerAt[c] = dangerAt[c] ? Math.min(dangerAt[c], wave.tick) : wave.tick;
        }
      return { ...base, mode: "collapse", dangerAt, nextCollapse: Math.min(...dangerAt.filter(Boolean)) };
    }
    case "hunt":
      return {
        ...base,
        mode: "hunt",
        targets: l.hunt.targets.map((t) => ({ cell: cellOf(t.route[0], l.board.width), routeIndex: 0, nextMove: t.stepTicks, respawnAt: 0, active: true })),
      };
    case "circuit":
      return { ...base, mode: "circuit", mask: l.circuit.initialMask, contract: 0, owners: [] };
    case "energy":
      return { ...base, mode: "energy", chargers: l.energy.chargers.map((p) => ({ cell: cellOf(p, l.board.width), stock: 40 })), owners: l.energy.beacons.map(() => null) };
    case "bridge":
      return {
        ...base,
        mode: "bridge",
        builtMask: 0,
        suppliesReady: l.bridge.supplies.map(() => 0),
        builders: l.bridge.spans.map(() => null),
        owners: l.bridge.markers.map(() => null),
      };
    case "crates":
      return { ...base, mode: "crates", boxes: l.crates.boxes.map((p, id) => ({ id, cell: cellOf(p, l.board.width), owner: null })), deadCells: deadSquares(l) };
  }
}
export const copyModeState = (s: ModeState): ModeState => structuredClone(s);
export function cloneWorld(w: RuleWorld): RuleWorld {
  return {
    tick: w.tick,
    terrain: [...w.terrain],
    modeState: copyModeState(w.modeState),
    bots: w.bots.map((b) => ({
      id: b.id,
      algorithm: b.algorithm,
      x: b.x,
      y: b.y,
      score: b.score,
      inventory: b.inventory,
      energy: b.energy,
      finishTick: b.finishTick,
      eliminatedTick: b.eliminatedTick,
      known: [...b.known],
      visible: [...b.visible],
    })),
  };
}
export function reveal(l: LevelDefinition, w: RuleWorld, b: RuleBot) {
  if (l.mode !== "fog") return false;
  let changed = false;
  const visible: number[] = [];
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = b.x + dx,
        y = b.y + dy;
      if (Math.abs(dx) + Math.abs(dy) > 2 || x < 0 || y < 0 || x >= l.board.width || y >= l.board.height) continue;
      const c = y * l.board.width + x;
      visible.push(c);
      if (b.known[c] !== w.terrain[c]) {
        const old = b.known[c] ?? "ground",
          graphChanged = isWalkable(old) !== isWalkable(w.terrain[c]) || terrainCost(old) !== terrainCost(w.terrain[c]);
        b.known[c] = w.terrain[c];
        w.modeState.events.push({ kind: "reveal", botId: b.id, cell: c, graphChanged });
        changed = true;
      }
    }
  b.visible = visible;
  return changed;
}
export function observation(l: LevelDefinition, w: RuleWorld, b: RuleBot): RuleWorld {
  const copy = cloneWorld(w);
  if (l.mode === "fog") {
    copy.terrain = b.known.map((t) => t ?? "ground");
    copy.bots = copy.bots.filter((other) => other.id === b.id || b.visible.includes(cellOf(other, l.board.width)));
    for (const other of copy.bots)
      if (other.id !== b.id) {
        other.known = [...b.known];
        other.visible = [...b.visible];
      }
    copy.modeState.events = copy.modeState.events.filter((e) => e.botId === b.id || (e.cell !== undefined && b.visible.includes(e.cell)));
  }
  return copy;
}
export function syncCircuit(l: LevelDefinition, w: RuleWorld) {
  if (l.mode !== "circuit" || w.modeState.mode !== "circuit") return;
  const mask = w.modeState.mask;
  for (const [i, s] of l.circuit.switches.entries())
    for (const p of s.gates) {
      const c = cellOf(p, l.board.width),
        open = !!(mask & (1 << i));
      if (open || !w.bots.some((b) => b.eliminatedTick === null && cellOf(b, l.board.width) === c)) w.terrain[c] = open ? "path" : "wall";
    }
}
export function advanceWorld(l: LevelDefinition, w: RuleWorld, tick: number) {
  w.tick = tick;
  const s = w.modeState;
  s.events = [];
  if (s.mode === "collapse" && tick >= s.nextCollapse) {
    s.nextCollapse = Infinity;
    for (let c = 0; c < s.dangerAt.length; c++) {
      const at = s.dangerAt[c];
      if (at && at <= tick && isWalkable(w.terrain[c])) {
        w.terrain[c] = "water";
        s.events.push({ kind: "collapse", cell: c });
        s.revision++;
      } else if (at > tick) s.nextCollapse = Math.min(s.nextCollapse, at);
    }
  }
  if (l.mode === "hunt" && s.mode === "hunt")
    s.targets.forEach((target, i) => {
      const def = l.hunt.targets[i];
      if (!target.active && tick >= target.respawnAt) {
        target.active = true;
        target.routeIndex = (target.routeIndex + 1) % def.route.length;
        target.cell = cellOf(def.route[target.routeIndex], l.board.width);
        target.nextMove = tick + def.stepTicks;
      } else if (target.active && tick >= target.nextMove) {
        target.routeIndex = (target.routeIndex + 1) % def.route.length;
        target.cell = cellOf(def.route[target.routeIndex], l.board.width);
        target.nextMove = tick + def.stepTicks;
      }
    });
  if (s.mode === "energy") for (const charger of s.chargers) charger.stock = Math.min(40, charger.stock + 1);
  syncCircuit(l, w);
  for (const b of w.bots)
    if (
      b.eliminatedTick === null &&
      (!isWalkable(w.terrain[cellOf(b, l.board.width)]) ||
        (l.mode === "energy" && b.energy === 0 && !(s.mode === "energy" && s.chargers.some((c) => c.cell === cellOf(b, l.board.width)))))
    ) {
      b.eliminatedTick = tick;
      s.events.push({ kind: "eliminated", botId: b.id });
    }
}
export function legalActions(l: LevelDefinition, w: RuleWorld, b: RuleBot): Action[] {
  if (b.eliminatedTick !== null || b.finishTick !== null) return [];
  const { width, height } = l.board,
    from = cellOf(b, width),
    s = w.modeState,
    actions: Action[] = [];
  const walk = (c: number) => isWalkable(w.terrain[c]);
  for (const to of adjacent(from, width, height)) {
    if (!walk(to)) continue;
    const box = s.mode === "crates" ? s.boxes.findIndex((p) => p.cell === to) : -1;
    let kind: ActionKind = "move",
      duration = terrainCost(w.terrain[to]) * 4,
      object: number | undefined;
    if (box >= 0 && s.mode === "crates") {
      const p = s.boxes[box],
        dest = to + (to - from);
      if (p.owner || !adjacent(to, width, height).includes(dest) || !walk(dest) || s.boxes.some((q) => q.cell === dest) || s.deadCells.includes(dest)) continue;
      kind = "push";
      object = p.cell;
      duration = Math.max(8, terrainCost(w.terrain[dest]) * 4);
    }
    if (l.mode === "energy" && b.energy < terrainCost(w.terrain[to])) continue;
    if (s.mode === "collapse" && [from, to].some((c) => s.dangerAt[c] > 0 && s.dangerAt[c] <= w.tick + duration)) continue;
    actions.push({ kind, from, to, duration, ...(object === undefined ? {} : { object }) });
  }
  if (l.mode === "circuit" && s.mode === "circuit") {
    l.circuit.switches.forEach((p, i) => {
      if (cellOf(p, width) === from) actions.push({ kind: "toggle", from, to: from, duration: 4, object: i, expected: s.mask & (1 << i) ? 0 : 1 });
    });
    const contract = l.circuit.contracts[s.contract];
    if (contract && cellOf(contract, width) === from && contract.mask === s.mask) actions.push({ kind: "claim", from, to: from, duration: 4, object: s.contract });
  }
  if (l.mode === "energy" && s.mode === "energy") {
    const charger = s.chargers.findIndex((c) => c.cell === from);
    if (charger >= 0 && s.chargers[charger].stock > 0 && b.energy < 24) actions.push({ kind: "charge", from, to: from, duration: 1, object: charger });
    l.energy.beacons.forEach((p, i) => {
      if (cellOf(p, width) === from && !s.owners[i] && b.energy >= 5) actions.push({ kind: "claim", from, to: from, duration: 4, object: i });
    });
  }
  if (l.mode === "bridge" && s.mode === "bridge") {
    l.bridge.supplies.forEach((p, i) => {
      if (cellOf(p, width) === from && s.suppliesReady[i] <= w.tick && b.inventory < 3) actions.push({ kind: "collect", from, to: from, duration: 4, object: i });
    });
    l.bridge.spans.forEach((span, i) => {
      if (!(s.builtMask & (1 << i)) && b.inventory >= span.cells.length && span.banks.some((p) => cellOf(p, width) === from))
        actions.push({ kind: "build", from, to: from, duration: 12, object: i });
    });
    l.bridge.markers.forEach((p, i) => {
      if (cellOf(p, width) === from && !s.owners[i]) actions.push({ kind: "claim", from, to: from, duration: 4, object: i });
    });
    if (l.board.goal && from === cellOf(l.board.goal, width) && s.owners.every(Boolean)) actions.push({ kind: "claim", from, to: from, duration: 4, object: -1 });
  }
  if (l.mode !== "collapse") actions.push({ kind: "wait", from, to: from, duration: 1 });
  return actions;
}
export function actionEqual(a: Action, b: Action) {
  return a.kind === b.kind && a.from === b.from && a.to === b.to && a.object === b.object && (b.expected === undefined || a.expected === b.expected);
}
export interface Intent {
  botId: string;
  action: Action;
}
export function resolveActions(l: LevelDefinition, w: RuleWorld, intents: Intent[], seed: number) {
  const s = w.modeState,
    width = l.board.width;
  const valid = intents.filter((i) => {
    const b = w.bots.find((b) => b.id === i.botId);
    return b && legalActions(l, w, b).some((a) => actionEqual(a, i.action));
  });
  const lock = new Set<string>();
  const accepted = new Set<string>();
  const ranked = [...valid].sort(
    (a, b) =>
      seededHash(`${a.action.kind}:${a.action.object ?? a.action.to}:${w.tick}:${w.bots.find((v) => v.id === a.botId)!.algorithm}`, seed) -
      seededHash(`${b.action.kind}:${b.action.object ?? b.action.to}:${w.tick}:${w.bots.find((v) => v.id === b.botId)!.algorithm}`, seed)
  );
  for (const { botId, action: a } of ranked) {
    const b = w.bots.find((v) => v.id === botId)!;
    const keys: string[] = [];
    if (a.kind === "push") keys.push(`box:${a.object}`, `box-dest:${2 * a.to - a.from}`);
    if (["toggle", "build", "collect"].includes(a.kind)) keys.push(`${a.kind}:${a.object}`);
    if (a.kind === "claim" && a.object !== -1) keys.push(`claim:${a.object}`);
    if (keys.some((k) => lock.has(k))) continue;
    for (const k of keys) lock.add(k);
    accepted.add(botId);
    if (a.kind === "move" || a.kind === "push") {
      const p = pointOf(a.to, width);
      b.x = p.x;
      b.y = p.y;
      if (l.mode === "energy") b.energy -= terrainCost(w.terrain[a.to]);
      s.events.push({ kind: "step", botId, cell: a.to });
      if (s.mode === "collapse") {
        const at = Math.max(l.mode === "collapse" ? l.collapse.graceTicks : 160, w.tick + 24);
        s.dangerAt[a.from] = s.dangerAt[a.from] ? Math.min(s.dangerAt[a.from], at) : at;
        s.nextCollapse = Math.min(s.nextCollapse, s.dangerAt[a.from]);
        s.events.push({ kind: "crack", cell: a.from });
        s.revision++;
      }
    }
    if (a.kind === "push" && l.mode === "crates" && s.mode === "crates") {
      const box = s.boxes.find((p) => p.cell === a.object)!;
      box.cell = 2 * a.to - a.from;
      s.events.push({ kind: "push", botId, cell: box.cell, object: box.id });
      if (l.crates.docks.some((p) => cellOf(p, width) === box.cell)) {
        box.owner = b.id;
        b.score++;
        s.events.push({ kind: "dock", botId, cell: box.cell, object: box.id });
      }
      s.revision++;
    }
    if (a.kind === "toggle" && s.mode === "circuit") {
      s.mask ^= 1 << a.object!;
      s.events.push({ kind: "toggle", botId, object: a.object });
      s.revision++;
    }
    if (a.kind === "charge" && s.mode === "energy") {
      const c = s.chargers[a.object!],
        amount = Math.min(4, 24 - b.energy, c.stock);
      b.energy += amount;
      c.stock -= amount;
      s.events.push({ kind: "charge", botId, object: a.object });
    }
    if (a.kind === "collect" && s.mode === "bridge") {
      b.inventory++;
      s.suppliesReady[a.object!] = w.tick + 80;
      s.events.push({ kind: "collect", botId, object: a.object });
      s.revision++;
    }
    if (a.kind === "build" && l.mode === "bridge" && s.mode === "bridge") {
      const span = l.bridge.spans[a.object!];
      b.inventory -= span.cells.length;
      b.score += 2;
      s.builtMask |= 1 << a.object!;
      s.builders[a.object!] = botId;
      for (const p of span.cells) w.terrain[cellOf(p, width)] = span.banks[0].y === span.banks[1].y ? "bridge-h" : "bridge-v";
      s.events.push({ kind: "build", botId, object: a.object });
      s.revision++;
    }
    if (a.kind === "claim") {
      if (s.mode === "circuit") {
        s.owners.push(botId);
        s.contract++;
        b.score += 3;
      }
      if (s.mode === "energy") {
        s.owners[a.object!] = botId;
        b.energy -= 5;
        b.score += 3;
      }
      if (s.mode === "bridge") {
        if (a.object === -1) {
          b.score += 5;
          b.finishTick = w.tick;
        } else {
          s.owners[a.object!] = botId;
          b.score += 3;
        }
      }
      s.events.push({ kind: "claim", botId, object: a.object });
      s.revision++;
    }
  }
  syncCircuit(l, w);
  settleWorld(l, w, seed);
  return accepted;
}
export function settleWorld(l: LevelDefinition, w: RuleWorld, seed: number) {
  const s = w.modeState;
  for (const b of w.bots) {
    if (b.eliminatedTick !== null) continue;
    if (l.mode === "collapse" && legalActions(l, w, b).length === 0) {
      b.eliminatedTick = w.tick;
      s.events.push({ kind: "eliminated", botId: b.id });
      continue;
    }
    if (l.mode === "fog") {
      if (reveal(l, w, b)) s.events.push({ kind: "reveal", botId: b.id });
      if (l.board.goal && samePoint(b, l.board.goal)) b.finishTick ??= w.tick;
    }
    if (l.mode === "energy" && b.energy === 0 && !(s.mode === "energy" && s.chargers.some((c) => c.cell === cellOf(b, l.board.width)))) {
      b.eliminatedTick = w.tick;
      s.events.push({ kind: "eliminated", botId: b.id });
    }
  }
  if (l.mode === "hunt" && s.mode === "hunt")
    s.targets.forEach((target, i) => {
      if (!target.active) return;
      const contenders = w.bots
        .filter((b) => b.eliminatedTick === null && cellOf(b, l.board.width) === target.cell)
        .sort((a, b) => seededHash(`target:${i}:${w.tick}:${a.algorithm}`, seed) - seededHash(`target:${i}:${w.tick}:${b.algorithm}`, seed));
      if (contenders[0]) {
        contenders[0].score++;
        target.active = false;
        target.respawnAt = w.tick + 20;
        s.events.push({ kind: "catch", botId: contenders[0].id, object: i, cell: target.cell });
        s.revision++;
      }
    });
}
export function terminal(l: LevelDefinition, w: RuleWorld) {
  const s = w.modeState;
  return (
    w.tick >= l.timeLimit ||
    w.bots.every((b) => b.eliminatedTick !== null) ||
    (l.mode === "fog" && w.bots.some((b) => b.finishTick !== null)) ||
    (l.mode === "collapse" && w.bots.filter((b) => b.eliminatedTick === null).length <= 1) ||
    (l.mode === "circuit" && s.mode === "circuit" && s.contract >= l.circuit.contracts.length) ||
    (s.mode === "energy" && s.owners.every(Boolean)) ||
    (s.mode === "bridge" && w.bots.some((b) => b.finishTick !== null)) ||
    (s.mode === "crates" && s.boxes.every((b) => b.owner !== null))
  );
}
export function ruleWinners(mode: GameMode, bots: RuleBot[], tick: number) {
  if (mode === "fog") {
    const best = Math.min(...bots.map((b) => b.finishTick ?? Infinity));
    return Number.isFinite(best) ? bots.filter((b) => b.finishTick === best).map((b) => b.id) : [];
  }
  if (mode === "collapse") {
    const best = Math.max(...bots.map((b) => b.eliminatedTick ?? tick));
    return bots.filter((b) => (b.eliminatedTick ?? tick) === best).map((b) => b.id);
  }
  const best = Math.max(...bots.map((b) => b.score));
  return best > 0 ? bots.filter((b) => b.score === best).map((b) => b.id) : [];
}
export function botMetricText(mode: GameMode, bot: RuleBot & { status?: string }, tick: number, finished = false) {
  if (mode === "collapse") return `${((bot.eliminatedTick ?? tick) / 20).toFixed(2)} dtk bertahan`;
  if (mode === "fog") {
    if (finished && bot.finishTick === null) return bot.status === "unreachable" ? "Jalan terputus" : "Belum keluar";
    return `${((bot.finishTick ?? tick) / 20).toFixed(2)} dtk`;
  }
  return `${bot.score} ${modeInfo[mode].unit}`;
}
export function botDetail(mode: GameMode, b: RuleBot) {
  return mode === "energy" ? `Energi ${b.energy}/24` : mode === "bridge" ? `Bahan ${b.inventory}/3` : mode === "fog" ? `${b.known.filter(Boolean).length} petak diketahui` : "";
}
