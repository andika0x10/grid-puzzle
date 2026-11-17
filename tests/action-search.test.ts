import { describe, it, expect } from "vitest";
import { getLevel } from "../game/provider";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { ModeDomain } from "../game/planning";
import { createDomainSearch } from "../game/search";
import { cellOf } from "../game/modes";
const run = (s: ReturnType<typeof createDomainSearch>) => {
  while (!s.done && s.operations < 500000) s.advance(64);
  expect(s.done).toBe(true);
  return s.actions?.reduce((n, a) => n + a.duration, 0) ?? null;
};
describe("incremental action graphs", () => {
  it("D* Lite agrees with Dijkstra on resource, switch and push objectives", () => {
    for (const mode of ["energy", "circuit", "crates", "bridge"] as const)
      for (const order of [1, 3, 7]) {
        const l = getLevel(`${mode}-${order}`)!,
          w = previewFrame(l, defaultConfig(1));
        if (mode === "energy") w.bots[0].energy = order === 3 ? 12 : 24;
        const d = new ModeDomain(l, w, w.bots[0]);
        expect(run(createDomainSearch(d, "dstar-lite", l.board.width)), `${mode}-${order}`).toBe(run(createDomainSearch(d, "dijkstra", l.board.width)));
      }
  });
  it("discovers newly available charging edges after an empty station refills", () => {
    const l = getLevel("energy-1")!,
      w = previewFrame(l, defaultConfig(1));
    if (l.mode !== "energy" || w.modeState.mode !== "energy") throw Error();
    const p = l.energy.chargers[0],
      cell = cellOf(p, l.board.width);
    Object.assign(w.bots[0], p);
    w.bots[0].energy = 8;
    for (const c of w.modeState.chargers) c.stock = 0;
    const d = new ModeDomain(l, w, w.bots[0]),
      search = createDomainSearch(d, "dstar-lite", l.board.width);
    expect(run(search)).toBeNull();
    const changed = structuredClone(w);
    if (changed.modeState.mode !== "energy") throw Error();
    changed.modeState.chargers[0].stock = 4;
    const next = new ModeDomain(l, changed, changed.bots[0]);
    search.updateDomain!(next, new Set([cell]));
    expect(run(search)).toBe(run(createDomainSearch(next, "dijkstra", l.board.width)));
    expect(search.actions?.some((a) => a.kind === "charge")).toBe(true);
  });
  it("can escape an occupied gate whose closing is deferred", () => {
    const l = getLevel("circuit-3")!,
      w = previewFrame(l, defaultConfig(1));
    if (l.mode !== "circuit") throw Error();
    const p = l.circuit.switches[0].gates[0];
    Object.assign(w.bots[0], p);
    w.terrain[cellOf(p, l.board.width)] = "path";
    const d = new ModeDomain(l, w, w.bots[0]);
    const search = createDomainSearch(d, "dstar-lite", l.board.width);
    expect(run(search)).toBe(run(createDomainSearch(d, "dijkstra", l.board.width)));
    expect(search.actions?.[0].kind).toBe("move");
  });
});
