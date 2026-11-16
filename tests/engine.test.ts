import { describe, it, expect } from "vitest";
import fs from "node:fs";
import catalog from "../content/catalog.json";
import { levelSchema, validateTrace, sectionSchema } from "../game/schema";
import { ReplayController, stateAt, applyEvents } from "../game/replay";
import { emptyProgress, isLevelUnlocked, readProgress, recordResult, saveProgress, STORAGE_KEY } from "../game/progress";
const levels = catalog.levels.map((l) => levelSchema.parse(l)),
  sections = catalog.sections.map((s) => sectionSchema.parse(s));
const traces = levels.flatMap((level) =>
  level.options.map((o) => ({
    level,
    trace: validateTrace(level, JSON.parse(fs.readFileSync(`public${level.traceRefs[o.id]}`, "utf8"))),
  }))
);
describe("replay data and deterministic playback", () => {
  it("validates all 50 demo traces and resolves every level", () => {
    expect(traces).toHaveLength(50);
    for (const l of levels) expect(traces.some((t) => t.level.id === l.id && t.trace.result.passed)).toBe(true);
  });
  for (const { level, trace } of traces)
    it(`${level.id}/${trace.optionId}: seeking, manual steps and every speed agree`, () => {
      const end = stateAt(trace, trace.steps.length);
      expect(end.metrics).toEqual(trace.result.metrics);
      const manual = trace.steps.reduce((s, step) => applyEvents(s, step.events), trace.initial);
      expect(manual).toEqual(end);
      for (const speed of [0.5, 1, 2, 4]) {
        const c = new ReplayController(trace.initial);
        c.load(trace);
        c.setSpeed(speed);
        let guard = 0;
        while (c.getSnapshot().phase === "playing" && guard++ < 20000) c.tick(100);
        expect(c.getSnapshot().frame).toEqual(end);
        expect(c.getSnapshot().phase).toBe("finished");
        c.seek(0);
        expect(c.getSnapshot().frame).toEqual(trace.initial);
        c.seek(trace.steps.length);
        expect(c.getSnapshot().frame).toEqual(end);
      }
    });
  it("pauses without consuming steps and preserves the outcome", () => {
    const t = traces[0].trace,
      c = new ReplayController(t.initial);
    c.load(t);
    c.tick(100);
    c.pause();
    const snapshot = c.getSnapshot();
    c.tick(10000);
    expect(c.getSnapshot()).toBe(snapshot);
    c.seek(99999);
    expect(c.getSnapshot().cursor).toBe(t.steps.length);
    c.step(-1);
    expect(c.getSnapshot().phase).toBe("paused");
  });
  it("protects confirmation/loading from duplicate actions", () => {
    const t = traces[0].trace,
      c = new ReplayController(t.initial);
    c.choose("bfs");
    c.choose("dfs");
    expect(c.getSnapshot().pending).toBe("bfs");
    c.cancel();
    expect(c.getSnapshot().phase).toBe("ready");
    c.choose("bfs");
    c.loading();
    c.choose("dfs");
    expect(c.getSnapshot().pending).toBe("bfs");
    c.fail("offline");
    expect(c.getSnapshot().phase).toBe("error");
    c.choose("dfs");
    expect(c.getSnapshot().phase).toBe("confirming");
  });
  it("rejects mismatched traces, invalid coordinates and unknown metrics", () => {
    const { level, trace } = traces[0];
    expect(() => validateTrace(level, { ...trace, levelId: "wrong" })).toThrow();
    expect(() =>
      validateTrace(level, {
        ...trace,
        steps: [{ events: [{ kind: "cell", x: 99, y: 0, state: {} }] }],
      })
    ).toThrow();
    expect(() =>
      validateTrace(level, {
        ...trace,
        steps: [{ events: [{ kind: "metric", id: "unknown", value: 1 }] }],
      })
    ).toThrow();
  });
  it("rejects invalid level shapes and missing recordings", () => {
    expect(() => levelSchema.parse({ ...levels[0], board: { ...levels[0].board, terrain: [] } })).toThrow();
    expect(() => levelSchema.parse({ ...levels[0], options: Array(5).fill(levels[0].options[0]) })).toThrow();
    expect(() => levelSchema.parse({ ...levels[0], traceRefs: {} })).toThrow();
  });
});
describe("demo progression", () => {
  it("unlocks levels and sections from the content, never from a hardcoded count", () => {
    let p = emptyProgress();
    expect(isLevelUnlocked(levels[0].id, sections, p)).toBe(true);
    expect(isLevelUnlocked(levels[1].id, sections, p)).toBe(false);
    expect(isLevelUnlocked("clustering-1", sections, p)).toBe(false);
    for (const id of sections[0].levelIds) {
      const t = traces.find((t) => t.level.id === id && t.trace.result.passed)!.trace;
      p = recordResult(p, id, t.optionId, t.result);
    }
    expect(isLevelUnlocked("clustering-1", sections, p)).toBe(true);
    expect(isLevelUnlocked("clustering-2", sections, p)).toBe(false);
  });
  it("never counts replay as a new attempt or loses a passing result", () => {
    const t = traces.find((t) => t.trace.result.passed)!.trace;
    const p = recordResult(emptyProgress(), t.levelId, t.optionId, t.result);
    expect(recordResult(p, t.levelId, t.optionId, t.result)).toBe(p);
    expect(p.levels[t.levelId].firstTry).toBe(true);
    const failed = { ...t.result, passed: false, tier: "failed" as const };
    const next = recordResult(p, t.levelId, "other", failed);
    expect(next.levels[t.levelId].passed).toBe(true);
  });
  it("recovers from corrupt or blocked storage", () => {
    expect(readProgress({ getItem: () => "{bad" })).toEqual(emptyProgress());
    expect(
      readProgress({
        getItem: () => {
          throw Error();
        },
      })
    ).toEqual(emptyProgress());
    expect(
      saveProgress(emptyProgress(), {
        setItem: () => {
          throw Error();
        },
      })
    ).toBe(false);
    let stored = "";
    expect(
      saveProgress(emptyProgress(), {
        setItem: (key, value) => {
          expect(key).toBe(STORAGE_KEY);
          stored = value;
        },
      })
    ).toBe(true);
    expect(readProgress({ getItem: () => stored })).toEqual(emptyProgress());
  });
});
