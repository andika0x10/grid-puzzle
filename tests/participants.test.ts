import { describe, expect, it } from "vitest";
import { defaultConfig } from "../game/algorithms";
import { MatchEngine } from "../game/engine";
import { PARTICIPANTS_STORAGE_KEY, readParticipants, resolveParticipants, saveParticipants, type ParticipantPreferences } from "../game/participants";
import { fixture } from "./fixtures";

describe("participant preferences", () => {
  it("persists the roster without the level seed or progress", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const config = { ...defaultConfig(123), player: "dfs" as const };
    expect(saveParticipants(config, store).persisted).toBe(true);
    expect(JSON.parse(data.get(PARTICIPANTS_STORAGE_KEY)!)).toEqual({ version: 1, player: "dfs", opponents: ["weighted-astar", "greedy"] });
    expect(data.size).toBe(1);
    expect(readParticipants(store)).toEqual({ player: "dfs", opponents: ["weighted-astar", "greedy"] });
    expect(resolveParticipants(fixture({ seed: 456 }), readParticipants(store)).config.seed).toBe(456);
  });
  it.each([
    null,
    "{bad",
    JSON.stringify({ version: 2, player: "astar", opponents: ["greedy"] }),
    JSON.stringify({ version: 1, player: "unknown", opponents: ["greedy"] }),
    JSON.stringify({ version: 1, player: "astar", opponents: [] }),
    JSON.stringify({ version: 1, player: "astar", opponents: ["greedy", "greedy"] }),
    JSON.stringify({ version: 1, player: "astar", opponents: ["astar"] }),
    JSON.stringify({ version: 1, player: "astar", opponents: ["weighted-astar", "greedy", "dfs", "bidirectional"] }),
  ])("uses defaults for missing or invalid preferences: %s", (raw) => {
    expect(readParticipants({ getItem: () => raw, setItem: () => {} })).toEqual({ player: "astar", opponents: ["weighted-astar", "greedy"] });
  });
  it("keeps preferences in memory when storage access and writes fail", () => {
    const store = {
      getItem: () => {
        throw new Error("Blocked");
      },
      setItem: () => {
        throw new Error("Blocked");
      },
    };
    expect(readParticipants(store)).toEqual({ player: "astar", opponents: ["weighted-astar", "greedy"] });
    const preferences: ParticipantPreferences = { player: "greedy", opponents: ["dfs", "bidirectional"] };
    expect(saveParticipants(preferences, store).persisted).toBe(false);
    expect(readParticipants(store)).toEqual(preferences);
    expect(readParticipants({ getItem: () => null, setItem: () => {} }).player).toBe("astar");
    expect(saveParticipants(preferences, null).persisted).toBe(false);
    expect(readParticipants(null)).toEqual(preferences);
  });
  it.each([false, true])("replaces unsupported participants for slow terrain (scheduled: %s)", (scheduled) => {
    const base = fixture();
    const level = fixture(
      scheduled
        ? { changes: [{ tick: 5, x: 2, y: 1, terrain: "slow" }] }
        : { board: { ...base.board, terrain: base.board.terrain.map((terrain, i) => (i === 7 ? "slow" : terrain)) } }
    );
    for (const preferences of [
      { player: "bidirectional", opponents: ["astar", "greedy", "dfs"] },
      { player: "greedy", opponents: ["bidirectional"] },
    ] satisfies ParticipantPreferences[]) {
      const { config, adjusted } = resolveParticipants(level, preferences);
      expect(adjusted).toBe(true);
      expect(config.opponents).toHaveLength(preferences.opponents.length);
      expect([config.player, ...config.opponents]).not.toContain("bidirectional");
      expect(() => new MatchEngine(level, config)).not.toThrow();
    }
    expect(resolveParticipants(level, { player: "dfs", opponents: ["astar", "greedy"] }).adjusted).toBe(false);
  });
});
