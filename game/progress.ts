import { z } from "zod";
import { resultSchema, type AttemptResult, type SectionDefinition } from "./schema";

export const STORAGE_KEY = "gridlab.demo.progress.v1";
const progressSchema = z.object({
  version: z.literal(1),
  levels: z.record(
    z.string(),
    z.object({
      attempts: z.number().int().nonnegative(),
      passed: z.boolean(),
      firstTry: z.boolean(),
      results: z.record(z.string(), resultSchema),
    })
  ),
});
export type DemoProgress = z.infer<typeof progressSchema>;
export const emptyProgress = (): DemoProgress => ({ version: 1, levels: {} });
export function readProgress(storage: Pick<Storage, "getItem"> | null): DemoProgress {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? progressSchema.parse(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}
export function saveProgress(progress: DemoProgress, storage: Pick<Storage, "setItem"> | null): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(progress));
    return !!storage;
  } catch {
    return false;
  }
}
export function recordResult(progress: DemoProgress, levelId: string, optionId: string, result: AttemptResult): DemoProgress {
  const old = progress.levels[levelId] ?? {
    attempts: 0,
    passed: false,
    firstTry: false,
    results: {},
  };
  if (old.results[optionId]) return progress;
  return {
    version: 1,
    levels: {
      ...progress.levels,
      [levelId]: {
        attempts: old.attempts + 1,
        passed: old.passed || result.passed,
        firstTry: old.firstTry || (old.attempts === 0 && result.passed),
        results: { ...old.results, [optionId]: result },
      },
    },
  };
}
export function isLevelUnlocked(id: string, sections: SectionDefinition[], progress: DemoProgress): boolean {
  const sectionIndex = sections.findIndex((s) => s.levelIds.includes(id));
  if (sectionIndex < 0) return false;
  for (const section of sections.slice(0, sectionIndex)) if (!section.levelIds.every((levelId) => progress.levels[levelId]?.passed)) return false;
  const section = sections[sectionIndex];
  return section.levelIds.slice(0, section.levelIds.indexOf(id)).every((levelId) => progress.levels[levelId]?.passed);
}
