import { isWalkable, type GameMode, type KeyColor, type LevelDefinition, type Point, type Terrain } from "./schema";
import { checkpointObjectives, raceReady } from "./classic";

export const modeInfo: Record<GameMode, { title: string; unit: string; help: string }> = {
  race: {
    title: "Balap rute",
    unit: "dtk",
    help: "Aktifkan semua pos lintasan dalam urutan bebas, lalu capai bendera finis. Gerbang berjam membuka dan menutup sesuai jadwal; jalur memutar bisa lebih cepat daripada menunggu. Pos bersifat pribadi untuk tiap bot. Kedatangan finis pada tick sama seri.",
  },
  gems: {
    title: "Perebutan gem",
    unit: "poin",
    help: "Emas bernilai 1, safir biru 3, dan rubi merah 5 poin. Gem muncul bergelombang; gem bertimer akan hilang jika terlambat. Saat Gem ganda aktif, perolehan bernilai dua kali lipat. Satu gem hanya punya satu pemilik. Kedatangan serentak ditentukan seed.",
  },
  cargo: {
    title: "Kurir kargo",
    unit: "barang",
    help: "Ambil barang dan bawa ke depot biru. Tas memuat tiga barang. Poin baru masuk setelah disetor; barang di tas saat waktu habis belum dihitung.",
  },
  territory: {
    title: "Rebut wilayah",
    unit: "petak",
    help: "Warnai petak dengan melewatinya. Petak lawan bisa direbut kembali. Kuasai petak terbanyak saat waktu habis. Kedatangan serentak ditentukan seed.",
  },
  survival: {
    title: "Zona selamat",
    unit: "dtk bertahan",
    help: "Hindari petak bahaya. Tanda segitiga muncul sebelum gelombang aktif. Bot di petak berbahaya tereliminasi, termasuk saat menghitung. Bertahan paling lama untuk menang.",
  },
  keys: {
    title: "Kunci dan pintu",
    unit: "dtk",
    help: "Kumpulkan semua kunci, buka pintu dengan warna yang sama, lalu capai bendera finis. Kunci tersedia untuk setiap bot dan tetap disimpan setelah membuka pintu.",
  },
  outposts: {
    title: "Rebut pos",
    unit: "poin",
    help: "Tempati pos sendirian selama delapan tick untuk menguasainya. Pos milikmu menghasilkan satu poin tiap 20 tick, meski kamu pergi. Kehadiran beberapa bot menghentikan penguasaan dan poin pos itu.",
  },
};
export const isRaceMode = (mode: GameMode) => mode === "race" || mode === "keys";
export const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function botMetricText(mode: GameMode, bot: RuleBot & { status?: string }, tick: number, finished = false) {
  if (mode === "survival") return `${(((bot.eliminatedTick ?? tick) * 50) / 1000).toFixed(2)} dtk bertahan`;
  if (isRaceMode(mode)) {
    if (finished && bot.finishTick === null) return bot.status === "unreachable" ? "Jalan terputus" : bot.status === "timeout" ? "Waktu habis" : "Belum finis";
    return `${(((bot.finishTick ?? tick) * 50) / 1000).toFixed(2)} dtk`;
  }
  return `${bot.score} ${modeInfo[mode].unit}${mode === "cargo" && !finished ? ` · tas ${bot.inventory}` : ""}`;
}
export function seededHash(text: string, seed: number) {
  let h = seed >>> 0;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  // Avalanche the seed as well as the name, so adjacent seeds vary fairly.
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
  keys: KeyColor[];
  eliminatedTick: number | null;
  finishTick: number | null;
  checkpoints: number[];
}
export interface Parcel extends Point {
  id: string;
  state: "available" | "carried" | "delivered";
  carrier: string | null;
}
export interface Outpost extends Point {
  id: string;
  owner: string | null;
  capturing: string | null;
  captureTicks: number;
  contested: boolean;
}
export interface ModeState {
  mode: GameMode;
  parcels: Parcel[];
  territory: (string | null)[];
  dangerAt: number[];
  posts: Outpost[];
}
export function initialModeState(level: LevelDefinition): ModeState {
  const dangerAt = Array(level.board.width * level.board.height).fill(0) as number[];
  for (const wave of level.waves)
    for (const p of wave.cells) {
      const c = p.y * level.board.width + p.x;
      dangerAt[c] = dangerAt[c] ? Math.min(dangerAt[c], wave.tick) : wave.tick;
    }
  return {
    mode: level.mode,
    parcels: level.board.parcels.map((p, i) => ({ ...p, id: `parcel-${i}`, state: "available", carrier: null })),
    territory: level.mode === "territory" ? Array(level.board.terrain.length).fill(null) : [],
    dangerAt: level.mode === "survival" ? dangerAt : [],
    posts: level.board.posts.map((p, i) => ({ ...p, id: `post-${i}`, owner: null, capturing: null, captureTicks: 0, contested: false })),
  };
}
export function copyModeState(s: ModeState): ModeState {
  return { mode: s.mode, parcels: s.parcels.map((p) => ({ ...p })), territory: [...s.territory], dangerAt: [...s.dangerAt], posts: s.posts.map((p) => ({ ...p })) };
}
export function botTerrain(level: LevelDefinition, state: ModeState, terrain: Terrain[], bot: RuleBot, tick: number): Terrain[] {
  const out = [...terrain];
  for (const d of level.board.doors) if (!bot.keys.includes(d.color)) out[d.y * level.board.width + d.x] = "wall";
  if (level.mode === "survival")
    state.dangerAt.forEach((at, c) => {
      if (at && at <= tick) out[c] = "wall";
    });
  return out;
}
export interface Objective extends Point {
  id: string;
}
export function objectives(level: LevelDefinition, state: ModeState, bot: RuleBot, tick: number): Objective[] {
  const b = level.board;
  if (level.mode === "race") return checkpointObjectives(level, bot);
  if (level.mode === "keys") {
    const missing = b.keys.filter((k) => !bot.keys.includes(k.color));
    return missing.length ? missing.map((k) => ({ ...k, id: `key-${k.color}` })) : [{ ...b.goal!, id: "goal" }];
  }
  if (level.mode === "cargo") {
    const available = state.parcels.filter((p) => p.state === "available");
    return bot.inventory >= level.cargoCapacity || !available.length ? (bot.inventory && b.depot ? [{ ...b.depot, id: "depot" }] : []) : available;
  }
  if (level.mode === "outposts") return state.posts.filter((p) => p.owner !== bot.id).map((p) => ({ ...p }));
  if (level.mode === "territory")
    return state.territory.flatMap((owner, c) =>
      owner !== bot.id && !samePoint(bot, { x: c % b.width, y: Math.floor(c / b.width) }) && isWalkable(b.terrain[c])
        ? [{ x: c % b.width, y: Math.floor(c / b.width), id: `tile-${c}` }]
        : []
    );
  if (level.mode === "survival") {
    const next = level.waves.find((w) => w.tick > tick)?.tick;
    const safe = state.dangerAt.flatMap((at, c) =>
      isWalkable(b.terrain[c]) && (!at || at > (next ?? level.timeLimit)) ? [{ x: c % b.width, y: Math.floor(c / b.width), id: `safe-${c}` }] : []
    );
    // Stay put when already safe for the next wave; other algorithms can still
    // choose to explore, but path planners do not repeatedly search a zero route.
    return safe.some((p) => samePoint(p, bot)) ? [] : safe;
  }
  return [];
}
function claim<T extends RuleBot>(bots: T[], object: string, seed: number) {
  return [...bots].sort((a, b) => seededHash(`${object}:${a.algorithm}`, seed) - seededHash(`${object}:${b.algorithm}`, seed) || a.algorithm.localeCompare(b.algorithm))[0];
}
// Shared forward rules: both the live engine and MCTS rollouts use this function.
export function resolveModeTick(level: LevelDefinition, state: ModeState, bots: RuleBot[], tick: number, arrivals: Set<string>, seed: number) {
  const alive = () => bots.filter((b) => b.eliminatedTick === null);
  if (level.mode === "race")
    for (const bot of bots) {
      level.board.checkpoints.forEach((p, i) => {
        if (samePoint(bot, p) && !bot.checkpoints.includes(i)) bot.checkpoints.push(i);
      });
      if (level.board.goal && samePoint(bot, level.board.goal) && raceReady(level, bot)) bot.finishTick ??= tick;
    }
  if (level.mode === "cargo") {
    for (const p of state.parcels)
      if (p.state === "available") {
        const owner = claim(
          alive().filter((b) => samePoint(b, p) && b.inventory < level.cargoCapacity),
          p.id,
          seed
        );
        if (owner) {
          p.state = "carried";
          p.carrier = owner.id;
          owner.inventory++;
        }
      }
    for (const bot of alive())
      if (level.board.depot && samePoint(bot, level.board.depot) && bot.inventory) {
        for (const p of state.parcels) if (p.state === "carried" && p.carrier === bot.id) p.state = "delivered";
        bot.score += bot.inventory;
        bot.inventory = 0;
      }
  }
  if (level.mode === "territory") {
    const cells = new Set(bots.filter((b) => arrivals.has(b.id)).map((b) => b.y * level.board.width + b.x));
    for (const c of cells) {
      const owner = claim(
        bots.filter((b) => arrivals.has(b.id) && b.y * level.board.width + b.x === c),
        `tile-${c}:${tick}`,
        seed
      );
      if (owner) state.territory[c] = owner.id;
    }
    for (const bot of bots) bot.score = 0;
    for (const owner of state.territory) {
      const bot = bots.find((b) => b.id === owner);
      if (bot) bot.score++;
    }
  }
  if (level.mode === "keys")
    for (const bot of bots) {
      for (const k of level.board.keys) if (samePoint(bot, k) && !bot.keys.includes(k.color)) bot.keys.push(k.color);
      if (bot.keys.length === level.board.keys.length && level.board.goal && samePoint(bot, level.board.goal)) bot.finishTick ??= tick;
    }
  if (level.mode === "survival")
    for (const bot of alive()) {
      const at = state.dangerAt[bot.y * level.board.width + bot.x];
      if (at && at <= tick) bot.eliminatedTick = tick;
    }
  if (level.mode === "outposts")
    for (const post of state.posts) {
      const present = alive().filter((b) => samePoint(b, post));
      post.contested = present.length > 1;
      const bot = present.length === 1 ? present[0] : undefined;
      if (bot && bot.id !== post.owner) {
        post.captureTicks = post.capturing === bot.id ? post.captureTicks + 1 : 1;
        post.capturing = bot.id;
        if (post.captureTicks >= 8) {
          post.owner = bot.id;
          post.capturing = null;
          post.captureTicks = 0;
        }
      } else {
        post.capturing = null;
        post.captureTicks = 0;
      }
      if (!post.contested && tick % 20 === 0) {
        const owner = bots.find((b) => b.id === post.owner);
        if (owner) owner.score++;
      }
    }
}
export function scoreWinners(bots: RuleBot[]) {
  const best = Math.max(...bots.map((b) => b.score));
  return best > 0 ? bots.filter((b) => b.score === best).map((b) => b.id) : [];
}
export function ruleWinners(mode: GameMode, bots: RuleBot[], tick: number) {
  if (isRaceMode(mode)) {
    const best = Math.min(...bots.map((b) => b.finishTick ?? Infinity));
    return Number.isFinite(best) ? bots.filter((b) => b.finishTick === best).map((b) => b.id) : [];
  }
  if (mode === "survival") {
    const alive = bots.filter((b) => b.eliminatedTick === null);
    const last = Math.max(...bots.map((b) => b.eliminatedTick ?? tick));
    return (alive.length ? alive : bots.filter((b) => b.eliminatedTick === last)).map((b) => b.id);
  }
  return scoreWinners(bots);
}
