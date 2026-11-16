import { z } from "zod";
import type { MatchResult } from "./engine";
import type { SectionDefinition } from "./schema";
import type { GameMode } from "./schema";
import { isRaceMode } from "./modes";
export const STORAGE_KEY = "grid-puzzle.progress.v4";
const PREVIOUS_KEY = "grid-puzzle.progress.v3";
const OLDER_KEY = "grid-puzzle.progress.v2";
const LEGACY_KEY = "gridlab.demo.progress.v1";
const UPDATE_EVENT = "grid-puzzle-progress";
const entrySchema = z.object({
  completed: z.boolean(),
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  bestTicks: z.number().nonnegative().nullable(),
  bestGems: z.number().int().nonnegative(),
  rulesVersion: z.number().int().positive().optional(),
  bestMetric: z
    .object({ kind: z.enum(["time", "score", "survival"]), value: z.number().nonnegative() })
    .nullable()
    .optional(),
});
const progressSchema = z.object({ version: z.literal(4), levels: z.record(z.string(), entrySchema) });
const previousSchema = progressSchema.extend({ version: z.literal(3) });
const olderSchema = progressSchema.extend({ version: z.literal(2) });
export type Progress = z.infer<typeof progressSchema>;
type Store = Pick<Storage, "getItem" | "setItem">;
export const emptyProgress = (): Progress => ({ version: 4, levels: {} });
let volatileProgress: Progress | null = null;
let volatileStore: Store | null = null;
function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function readProgress(storage: Store | null = browserStorage()): Progress {
  if (volatileProgress && storage === volatileStore) return volatileProgress;
  if (!storage) return emptyProgress();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return progressSchema.parse(JSON.parse(raw));
    const previous = previousSchema.safeParse(JSON.parse(storage.getItem(PREVIOUS_KEY) ?? "null"));
    if (previous.success) {
      return {
        version: 4,
        levels: Object.fromEntries(
          Object.entries(previous.data.levels).map(([id, value]) => [
            id,
            { ...value, bestMetric: value.bestTicks !== null ? { kind: "time", value: value.bestTicks } : value.bestGems ? { kind: "score", value: value.bestGems } : null },
          ])
        ),
      };
    }
    const older = olderSchema.safeParse(JSON.parse(storage.getItem(OLDER_KEY) ?? "null"));
    if (older.success) {
      // Earlier records used a different clock and shared gem scoring. Keep
      // completion/history, and retain the original v2 data under its old key.
      return { version: 4, levels: Object.fromEntries(Object.entries(older.data.levels).map(([id, value]) => [id, { ...value, bestTicks: null, bestGems: 0 }])) };
    }
    const legacy = JSON.parse(storage.getItem(LEGACY_KEY) ?? "null");
    const progress = emptyProgress();
    if (legacy?.version === 1 && legacy.levels && typeof legacy.levels === "object") {
      for (const [id, value] of Object.entries(legacy.levels) as [string, { passed?: boolean }][])
        if (/^navigation-[1-5]$/.test(id) && value?.passed === true) progress.levels[id] = { completed: true, matches: 0, wins: 0, bestTicks: null, bestGems: 0 };
    }
    return progress;
  } catch {
    return storage === volatileStore ? (volatileProgress ?? emptyProgress()) : emptyProgress();
  }
}
export function mergeProgress(a: Progress, b: Progress): Progress {
  const levels = { ...a.levels };
  for (const [id, next] of Object.entries(b.levels)) {
    const old = levels[id];
    if (!old) {
      levels[id] = next;
      continue;
    }
    const times = [old.bestTicks, next.bestTicks].filter((n): n is number => n !== null);
    const oldRevision = old.rulesVersion ?? 1,
      nextRevision = next.rulesVersion ?? 1;
    const newer = oldRevision === nextRevision ? null : oldRevision > nextRevision ? old : next;
    levels[id] = {
      completed: old.completed || next.completed,
      matches: Math.max(old.matches, next.matches),
      wins: Math.max(old.wins, next.wins),
      bestTicks: newer ? newer.bestTicks : times.length ? Math.min(...times) : null,
      bestGems: newer ? newer.bestGems : Math.max(old.bestGems, next.bestGems),
      bestMetric: newer ? newer.bestMetric : betterMetric(old.bestMetric, next.bestMetric),
      rulesVersion: Math.max(oldRevision, nextRevision),
    };
  }
  return { version: 4, levels };
}
function persist(progress: Progress, storage: Store | null) {
  let persisted = false;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
    persisted = !!storage;
  } catch {
    /* Keep playing in this tab when storage is unavailable. */
  }
  volatileProgress = persisted ? null : progress;
  volatileStore = persisted ? null : storage;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UPDATE_EVENT));
  return { progress, persisted };
}
function betterMetric(a: Progress["levels"][string]["bestMetric"], b: Progress["levels"][string]["bestMetric"]) {
  if (!a) return b ?? null;
  if (!b || a.kind !== b.kind) return a;
  return (a.kind === "time" ? b.value < a.value : b.value > a.value) ? b : a;
}
export async function recordMatch(levelId: string, mode: GameMode, result: MatchResult, storage: Store | null = browserStorage()) {
  const save = () => {
    const current = mergeProgress(readProgress(storage), storage === volatileStore ? (volatileProgress ?? emptyProgress()) : emptyProgress());
    const previous = current.levels[levelId] ?? { completed: false, matches: 0, wins: 0, bestTicks: null, bestGems: 0 };
    const revision = result.rulesVersion ?? 1;
    const old = (previous.rulesVersion ?? 1) === revision ? previous : { ...previous, bestTicks: null, bestGems: 0, bestMetric: null };
    const playerFinished = result.finishTick;
    const time = isRaceMode(mode) && playerFinished !== null && playerFinished !== undefined ? playerFinished : null;
    current.levels[levelId] = {
      completed: true,
      matches: old.matches + 1,
      wins: old.wins + Number(result.won),
      rulesVersion: revision,
      bestTicks: time === null ? old.bestTicks : old.bestTicks === null ? time : Math.min(old.bestTicks, time),
      bestGems: Math.max(old.bestGems, result.gems),
      bestMetric: betterMetric(
        old.bestMetric,
        isRaceMode(mode) ? (time !== null ? { kind: "time", value: time } : null) : (result.metric ?? { kind: "score", value: result.gems })
      ),
    };
    return persist(current, storage);
  };
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("grid-puzzle-progress", save);
  return save();
}
export function resetProgress() {
  return persist(emptyProgress(), browserStorage());
}
export function subscribeProgress(listener: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", changed);
  window.addEventListener(UPDATE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener(UPDATE_EVENT, listener);
  };
}
export function isLevelUnlocked(id: string, sections: SectionDefinition[], progress: Progress) {
  const ids = sections.flatMap((s) => s.levelIds),
    index = ids.indexOf(id);
  return index >= 0 && ids.slice(0, index).every((previous) => progress.levels[previous]?.completed);
}
