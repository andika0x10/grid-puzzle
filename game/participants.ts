import { z } from "zod";
import { algorithms, defaultConfig, unavailableReason, type MatchConfig } from "./algorithms";
import type { LevelDefinition } from "./schema";

export const PARTICIPANTS_STORAGE_KEY = "grid-puzzle.participants.v1";
export type ParticipantPreferences = Pick<MatchConfig, "player" | "opponents">;
type Store = Pick<Storage, "getItem" | "setItem">;
const algorithmSchema = z.enum(algorithms.map((algorithm) => algorithm.id));
const preferencesSchema = z
  .object({ version: z.literal(1), player: algorithmSchema, opponents: z.array(algorithmSchema).min(1).max(3) })
  .refine(({ player, opponents }) => !opponents.includes(player) && new Set(opponents).size === opponents.length);
let volatilePreferences: ParticipantPreferences | null = null;
let volatileStore: Store | null = null;

function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function readParticipants(storage: Store | null = browserStorage()): ParticipantPreferences {
  if (volatilePreferences && storage === volatileStore) return { ...volatilePreferences, opponents: [...volatilePreferences.opponents] };
  try {
    const saved = preferencesSchema.parse(JSON.parse(storage?.getItem(PARTICIPANTS_STORAGE_KEY) ?? "null"));
    return { player: saved.player, opponents: saved.opponents };
  } catch {
    const { player, opponents } = defaultConfig(0);
    return { player, opponents };
  }
}
export function saveParticipants(preferences: ParticipantPreferences, storage: Store | null = browserStorage()) {
  const saved = preferencesSchema.parse({ version: 1, player: preferences.player, opponents: preferences.opponents });
  let persisted = false;
  try {
    storage?.setItem(PARTICIPANTS_STORAGE_KEY, JSON.stringify(saved));
    persisted = !!storage;
  } catch {
    /* Keep the selection for this tab when browser storage is unavailable. */
  }
  volatilePreferences = persisted ? null : { player: saved.player, opponents: saved.opponents };
  volatileStore = persisted ? null : storage;
  return { persisted };
}
export function resolveParticipants(level: LevelDefinition, preferences: ParticipantPreferences) {
  const available = algorithms.filter((algorithm) => !unavailableReason(algorithm.id, level)).map((algorithm) => algorithm.id);
  const player = available.includes(preferences.player) ? preferences.player : "astar";
  const opponents = preferences.opponents.filter((id) => available.includes(id) && id !== player);
  for (const id of available) {
    if (opponents.length >= preferences.opponents.length) break;
    if (id !== player && !opponents.includes(id)) opponents.push(id);
  }
  const config: MatchConfig = { player, opponents, seed: level.seed };
  const adjusted = player !== preferences.player || opponents.some((id, index) => id !== preferences.opponents[index]);
  return { config, adjusted };
}
