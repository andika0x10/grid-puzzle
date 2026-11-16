import catalog from "../content/catalog.json";
import { levelSchema, sectionSchema, validateTrace, type LevelDefinition, type ReplayTrace, type SectionDefinition } from "./schema";
import { emptyProgress, readProgress, saveProgress, recordResult, type DemoProgress } from "./progress";

export const sections: SectionDefinition[] = catalog.sections.map((s) => sectionSchema.parse(s)).sort((a, b) => a.order - b.order);
export const levels: LevelDefinition[] = catalog.levels.map((l) => levelSchema.parse(l));
export const getLevel = (id: string) => levels.find((l) => l.id === id);
export interface GameDataProvider {
  getCatalog(): Promise<{ sections: SectionDefinition[]; levels: LevelDefinition[] }>;
  getLevel(id: string): Promise<LevelDefinition | undefined>;
  getProgress(): DemoProgress;
  startAttempt(level: LevelDefinition, optionId: string, signal?: AbortSignal): Promise<ReplayTrace>;
  completePlayback(trace: ReplayTrace): { progress: DemoProgress; persisted: boolean };
}
function storage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
let volatileProgress: DemoProgress | null = null;
export function resetDemoProgress() {
  const progress = emptyProgress(),
    persisted = saveProgress(progress, storage());
  volatileProgress = persisted ? null : progress;
  return { progress, persisted };
}
export class DemoDataProvider implements GameDataProvider {
  private progress: DemoProgress = emptyProgress();
  async getCatalog() {
    return { sections, levels };
  }
  async getLevel(id: string) {
    return getLevel(id);
  }
  getProgress() {
    this.progress = volatileProgress ?? readProgress(storage());
    return this.progress;
  }
  async startAttempt(level: LevelDefinition, optionId: string, signal?: AbortSignal) {
    const ref = level.traceRefs[optionId];
    if (!ref) throw new Error("Pilihan ini belum memiliki rekaman demo.");
    let response: Response;
    try {
      response = await fetch(ref, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("Rekaman belum termuat. Periksa koneksi, lalu coba lagi.");
    }
    if (!response.ok) throw new Error("Rekaman belum termuat. Periksa koneksi, lalu coba lagi.");
    try {
      return validateTrace(level, await response.json());
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error("Rekaman ini belum bisa dibaca. Muat ulang, atau coba pilihan lain.");
    }
  }
  completePlayback(trace: ReplayTrace) {
    this.progress = recordResult(this.progress, trace.levelId, trace.optionId, trace.result);
    const persisted = saveProgress(this.progress, storage());
    volatileProgress = persisted ? null : this.progress;
    return { progress: this.progress, persisted };
  }
}

/** Swap this factory when the server-backed provider is introduced. */
export function createGameDataProvider(): GameDataProvider {
  return new DemoDataProvider();
}
