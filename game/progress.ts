import { z } from "zod";
import type { MatchResult } from "./engine";
import type { GameMode, SectionDefinition } from "./schema";
export const STORAGE_KEY = "grid-puzzle.progress.v5";
const LEGACY_KEYS = ["gridlab.demo.progress.v1", "grid-puzzle.progress.v1", "grid-puzzle.progress.v2", "grid-puzzle.progress.v3", "grid-puzzle.progress.v4"];
const UPDATE_EVENT = "grid-puzzle-progress";
const metric = z.object({ kind: z.enum(["time", "score", "survival"]), value: z.number().nonnegative() });
const entrySchema = z.object({
  completed: z.boolean(),
  matches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  bestMetric: metric.nullable(),
  rulesVersion: z.number().int().positive(),
});
const progressSchema = z.object({ version: z.literal(5), levels: z.record(z.string(), entrySchema) });
export type Progress = z.infer<typeof progressSchema>;
type Store = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;
export const emptyProgress = (): Progress => ({ version: 5, levels: {} });
let volatileProgress: Progress | null = null,
  volatileStore: Store | null = null;
function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
function deleteOldProgress(storage: Store | null) {
  for (const key of LEGACY_KEYS)
    try {
      storage?.removeItem?.(key);
    } catch {
      /* A blocked store must not prevent play. */
    }
}
export function readProgress(storage: Store | null = browserStorage()): Progress {
  deleteOldProgress(storage);
  if (volatileProgress && storage === volatileStore) return volatileProgress;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? progressSchema.parse(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}
function better(a: Progress["levels"][string]["bestMetric"], b: Progress["levels"][string]["bestMetric"]) {
  if (!a) return b;
  if (!b || a.kind !== b.kind) return a;
  return (a.kind === "time" ? b.value < a.value : b.value > a.value) ? b : a;
}
export function mergeProgress(a: Progress, b: Progress): Progress {
  const levels = { ...a.levels };
  for (const [id, next] of Object.entries(b.levels)) {
    const old = levels[id];
    levels[id] = old
      ? {
          completed: old.completed || next.completed,
          matches: Math.max(old.matches, next.matches),
          wins: Math.max(old.wins, next.wins),
          bestMetric: old.rulesVersion === next.rulesVersion ? better(old.bestMetric, next.bestMetric) : (old.rulesVersion > next.rulesVersion ? old : next).bestMetric,
          rulesVersion: Math.max(old.rulesVersion, next.rulesVersion),
        }
      : next;
  }
  return { version: 5, levels };
}
function persist(progress: Progress, storage: Store | null) {
  let persisted = false;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
    persisted = !!storage;
  } catch {}
  volatileProgress = persisted ? null : progress;
  volatileStore = persisted ? null : storage;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UPDATE_EVENT));
  return { progress, persisted };
}
export async function recordMatch(levelId: string, mode: GameMode, result: MatchResult, storage: Store | null = browserStorage()) {
  const save = () => {
    const current = mergeProgress(readProgress(storage), storage === volatileStore ? (volatileProgress ?? emptyProgress()) : emptyProgress());
    const previous = current.levels[levelId] ?? { completed: false, matches: 0, wins: 0, bestMetric: null, rulesVersion: result.rulesVersion };
    const old = previous.rulesVersion === result.rulesVersion ? previous : { ...previous, bestMetric: null };
    const value = mode === "fog" && result.finishTick === null ? null : result.metric;
    current.levels[levelId] = {
      completed: true,
      matches: old.matches + 1,
      wins: old.wins + Number(result.won),
      bestMetric: better(old.bestMetric, value),
      rulesVersion: result.rulesVersion,
    };
    return persist(current, storage);
  };
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("grid-puzzle-progress-v5", save);
  return save();
}
export function resetProgress() {
  const storage = browserStorage();
  deleteOldProgress(storage);
  return persist(emptyProgress(), storage);
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
  const section = sections.find((s) => s.levelIds.includes(id));
  if (!section) return false;
  const index = section.levelIds.indexOf(id);
  return section.levelIds.slice(0, index).every((previous) => progress.levels[previous]?.completed);
}
