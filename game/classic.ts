import { isWalkable, type LevelDefinition, type Point, type Terrain } from "./schema";
import type { RuleBot } from "./modes";

export interface CompetitiveGem extends Point {
  id: string;
  taken: boolean;
  claimedBy: string | null;
  claimedTick: number | null;
  value?: number;
  spawnTick?: number;
  expireTick?: number | null;
  expired?: boolean;
  awardedPoints?: number;
}
export const gemActive = (gem: CompetitiveGem, tick: number) => !gem.taken && !gem.expired && (gem.spawnTick ?? 0) <= tick && (gem.expireTick == null || tick < gem.expireTick);
export const gemPending = (gem: CompetitiveGem, tick: number) => !gem.taken && !gem.expired && (gem.spawnTick ?? 0) > tick;
export const gemsSettled = (gems: CompetitiveGem[]) => gems.every((g) => g.taken || g.expired);
export const feverMultiplier = (level: LevelDefinition, tick: number) => (level.fever.some((f) => f.startTick <= tick && tick < f.endTick) ? 2 : 1);
export const maximumGemPoints = (level: LevelDefinition) => level.board.gems.reduce((n, g) => n + (g.value ?? 1) * (level.fever.length ? 2 : 1), 0);
export function legacyHash(text: string, seed: number) {
  let h = seed >>> 0;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
export function checkpointObjectives(level: LevelDefinition, bot: RuleBot) {
  const missing = level.board.checkpoints.flatMap((p, i) => (bot.checkpoints.includes(i) ? [] : [{ ...p, id: `checkpoint-${i}` }]));
  return missing.length ? missing : level.board.goal ? [{ ...level.board.goal, id: "goal" }] : [];
}
export const raceReady = (level: LevelDefinition, bot: Pick<RuleBot, "checkpoints">) => level.board.checkpoints.every((_, i) => bot.checkpoints.includes(i));
// A common value/deadline policy supplies targets to every route algorithm.
// Distance is an optimistic lower bound; walls can make an enticing gem a trap.
export function gemUtility(level: LevelDefinition, gem: CompetitiveGem, bot: Point, tick: number) {
  const d = Math.abs(gem.x - bot.x) + Math.abs(gem.y - bot.y),
    arrival = tick + d * 4;
  if (!gemActive(gem, tick) || (gem.expireTick != null && arrival >= gem.expireTick)) return 0;
  return ((gem.value ?? 1) * feverMultiplier(level, arrival)) / (d + 2);
}
export function resolveGemClaims(gems: CompetitiveGem[], bots: RuleBot[], tick: number, seed: number, level?: LevelDefinition) {
  const changed = new Set<string>();
  for (const gem of gems) {
    if (!gem.taken && !gem.expired && gem.expireTick != null && gem.expireTick <= tick) {
      gem.expired = true;
      changed.add(gem.id);
    }
    if (!gemActive(gem, tick)) continue;
    const owner = bots
      .filter((b) => b.x === gem.x && b.y === gem.y)
      .sort((a, b) => legacyHash(`${gem.id}:${a.algorithm}`, seed) - legacyHash(`${gem.id}:${b.algorithm}`, seed) || (a.algorithm < b.algorithm ? -1 : 1))[0];
    if (owner) {
      const points = (gem.value ?? 1) * (level ? feverMultiplier(level, tick) : 1);
      gem.taken = true;
      gem.claimedBy = owner.id;
      gem.claimedTick = tick;
      gem.awardedPoints = points;
      owner.score += points;
      changed.add(gem.id);
    }
  }
  return changed;
}
// A deferred closing is superseded by a later scheduled event for that cell.
// Both the real engine and MCTS use the same clock and occupancy rule.
export function applyTerrainChanges(level: LevelDefinition, terrain: Terrain[], bots: Point[], tick: number, applied: Set<number>) {
  const changed = new Set<number>();
  level.changes.forEach((change, i) => {
    if (applied.has(i) || change.tick > tick) return;
    if (
      level.changes.some((later, j) => later.x === change.x && later.y === change.y && later.tick <= tick && (later.tick > change.tick || (later.tick === change.tick && j > i)))
    ) {
      applied.add(i);
      return;
    }
    if (!isWalkable(change.terrain) && bots.some((b) => b.x === change.x && b.y === change.y)) return;
    const cell = change.y * level.board.width + change.x;
    if (terrain[cell] !== change.terrain) {
      terrain[cell] = change.terrain;
      changed.add(cell);
    }
    applied.add(i);
  });
  return changed;
}
