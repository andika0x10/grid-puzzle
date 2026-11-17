import { describe, expect, it } from "vitest";
import { emptyProgress, isLevelUnlocked, readProgress, recordMatch, mergeProgress, STORAGE_KEY } from "../game/progress";
import { sections } from "../game/provider";
import type { MatchResult } from "../game/engine";
const result: MatchResult = { player: "astar", won: true, draw: false, finishTick: 100, score: 0, rulesVersion: 4, metric: { kind: "time", value: 100 } };
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
describe("new campaign progress", () => {
  it.each(sections)("opens $id independently from the first level", (section) => {
    const progress = emptyProgress();
    expect(isLevelUnlocked(section.levelIds[0], sections, progress)).toBe(true);
    expect(isLevelUnlocked(section.levelIds[1], sections, progress)).toBe(false);
  });
  it("advances only the played category without requiring progress elsewhere", async () => {
    const s = store();
    await recordMatch("hunt-1", "hunt", { ...result, won: false, finishTick: null, score: 3, metric: { kind: "score", value: 3 } }, s);
    const progress = readProgress(s);
    expect(isLevelUnlocked("hunt-2", sections, progress)).toBe(true);
    expect(isLevelUnlocked("hunt-3", sections, progress)).toBe(false);
    expect(isLevelUnlocked("fog-1", sections, progress)).toBe(true);
    expect(isLevelUnlocked("fog-2", sections, progress)).toBe(false);
    expect(isLevelUnlocked("bridge-1", sections, progress)).toBe(true);
    expect(isLevelUnlocked("bridge-2", sections, progress)).toBe(false);
    expect(isLevelUnlocked("unknown-level", sections, progress)).toBe(false);
  });
  it("deletes old progress without deleting sound or participant preferences", () => {
    const s = store();
    for (const key of ["gridlab.demo.progress.v1", "grid-puzzle.progress.v1", "grid-puzzle.progress.v2", "grid-puzzle.progress.v3", "grid-puzzle.progress.v4"])
      s.data.set(key, "old");
    s.data.set("grid-puzzle.participants.v1", "participants");
    s.data.set("grid-puzzle.audio.v1", "audio");
    expect(readProgress(s)).toEqual(emptyProgress());
    expect([...s.data.keys()].sort()).toEqual(["grid-puzzle.audio.v1", "grid-puzzle.participants.v1"]);
  });
  it("starts locked and opens the next arena after any completed match", async () => {
    const s = store();
    expect(isLevelUnlocked("fog-1", sections, readProgress(s))).toBe(true);
    expect(isLevelUnlocked("fog-2", sections, readProgress(s))).toBe(false);
    await recordMatch("fog-1", "fog", { ...result, won: false, finishTick: null, metric: { kind: "time", value: 0 } }, s);
    expect(isLevelUnlocked("fog-2", sections, readProgress(s))).toBe(true);
    expect(readProgress(s).levels["fog-1"].bestMetric).toBeNull();
    expect(JSON.parse(s.data.get(STORAGE_KEY)!).version).toBe(5);
  });
  it("records completion once per call and keeps the appropriate best metric", async () => {
    const s = store();
    await recordMatch("fog-1", "fog", result, s);
    await recordMatch("fog-1", "fog", { ...result, finishTick: 150, metric: { kind: "time", value: 150 } }, s);
    expect(readProgress(s).levels["fog-1"]).toMatchObject({ matches: 2, wins: 2, bestMetric: { kind: "time", value: 100 } });
    await recordMatch("hunt-1", "hunt", { ...result, score: 5, metric: { kind: "score", value: 5 } }, s);
    await recordMatch("hunt-1", "hunt", { ...result, score: 9, metric: { kind: "score", value: 9 } }, s);
    expect(readProgress(s).levels["hunt-1"].bestMetric?.value).toBe(9);
  });
  it("merges tabs without reviving records from a different rule revision", () => {
    const a = emptyProgress(),
      b = emptyProgress();
    a.levels["fog-1"] = { completed: true, matches: 2, wins: 1, bestMetric: { kind: "time", value: 50 }, rulesVersion: 3 };
    b.levels["fog-1"] = { completed: true, matches: 1, wins: 0, bestMetric: { kind: "time", value: 200 }, rulesVersion: 4 };
    expect(mergeProgress(a, b).levels["fog-1"]).toMatchObject({ matches: 2, wins: 1, bestMetric: { value: 200 }, rulesVersion: 4 });
  });
  it("uses memory if persistence is blocked", async () => {
    const s = {
      getItem: () => {
        throw Error();
      },
      setItem: () => {
        throw Error();
      },
      removeItem: () => {
        throw Error();
      },
    };
    const saved = await recordMatch("fog-1", "fog", result, s);
    expect(saved.persisted).toBe(false);
    expect(readProgress(s).levels["fog-1"].completed).toBe(true);
  });
});
