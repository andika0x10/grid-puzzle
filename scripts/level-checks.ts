import { adjacent, cellOf } from "../game/modes";
import { isWalkable, terrainCost, type LevelDefinition, type Point } from "../game/schema";
import { extraTokens } from "../game/extra-modes";
export function layoutFingerprint(l: LevelDefinition) {
  let rows = Array.from({ length: l.board.height }, (_, y) => l.board.terrain.slice(y * l.board.width, (y + 1) * l.board.width).map((t) => (isWalkable(t) ? "." : "#")));
  while (rows.length && rows[0].every((c) => c === "#")) rows.shift();
  while (rows.length && rows.at(-1)!.every((c) => c === "#")) rows.pop();
  while (rows.length && rows.every((r) => r[0] === "#")) rows = rows.map((r) => r.slice(1));
  while (rows.length && rows.every((r) => r.at(-1) === "#")) rows = rows.map((r) => r.slice(0, -1));
  const versions: string[] = [];
  for (let i = 0; i < 4; i++) {
    versions.push(rows.map((r) => r.join("")).join("\n"), rows.map((r) => [...r].reverse().join("")).join("\n"));
    rows = rows[0].map((_, x) => rows.map((r) => r[x]).reverse());
  }
  return versions.sort()[0];
}
export function layoutSimilarity(a: LevelDefinition, b: LevelDefinition) {
  const raster = (l: LevelDefinition) => {
    const t = allOpenTerrain(l),
      size = 24;
    return Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) =>
        Number(
          isWalkable(
            t[
              (1 + Math.min(l.board.height - 3, Math.floor((y / size) * (l.board.height - 2)))) * l.board.width +
                1 +
                Math.min(l.board.width - 3, Math.floor((x / size) * (l.board.width - 2)))
            ]
          )
        )
      )
    );
  };
  const r = raster(a).flat();
  let rows = raster(b),
    best = 0;
  for (let turn = 0; turn < 4; turn++) {
    for (const candidate of [rows.flat(), rows.map((v) => [...v].reverse()).flat()]) best = Math.max(best, candidate.reduce((n, c, i) => n + Number(c === r[i]), 0) / r.length);
    rows = rows[0].map((_, x) => rows.map((v) => v[x]).reverse());
  }
  return best;
}
export function allOpenTerrain(l: LevelDefinition) {
  const t = [...l.board.terrain];
  if (l.mode === "bridge") for (const span of l.bridge.spans) for (const p of span.cells) t[cellOf(p, l.board.width)] = "path";
  if (l.mode === "circuit") for (const s of l.circuit.switches) for (const p of s.gates) t[cellOf(p, l.board.width)] = "path";
  if (l.mode === "bomb") for (const p of l.bomb.destructible) t[cellOf(p, l.board.width)] = "path";
  return t;
}
export function reachableCells(l: LevelDefinition) {
  const t = allOpenTerrain(l),
    start = cellOf(l.board.spawn, l.board.width),
    seen = new Set([start]),
    q = [start];
  for (let h = 0; h < q.length; h++)
    for (const c of adjacent(q[h], l.board.width, l.board.height))
      if (!seen.has(c) && isWalkable(t[c])) {
        seen.add(c);
        q.push(c);
      }
  return seen;
}
export function objectivePoints(l: LevelDefinition): Point[] {
  const points = [...(l.board.goal ? [l.board.goal] : []), ...(l.board.spawns ?? []), ...extraTokens(l)];
  switch (l.mode) {
    case "hunt":
      points.push(...l.hunt.targets.flatMap((t) => t.route));
      break;
    case "circuit":
      points.push(...l.circuit.switches, ...l.circuit.contracts);
      break;
    case "energy":
      points.push(...l.energy.chargers, ...l.energy.beacons);
      break;
    case "bridge":
      points.push(...l.bridge.supplies, ...l.bridge.markers, ...l.bridge.spans.flatMap((s) => s.banks));
      break;
    case "crates":
      points.push(...l.crates.boxes, ...l.crates.docks);
  }
  return points;
}
export function weightedDistances(l: LevelDefinition, start: number) {
  const terrain = allOpenTerrain(l),
    dist = Array<number>(terrain.length).fill(Infinity),
    pending = new Set<number>([start]);
  dist[start] = 0;
  while (pending.size) {
    let best = -1;
    for (const c of pending) if (best < 0 || dist[c] < dist[best]) best = c;
    pending.delete(best);
    for (const next of adjacent(best, l.board.width, l.board.height))
      if (isWalkable(terrain[next]) && dist[best] + terrainCost(terrain[next]) < dist[next]) {
        dist[next] = dist[best] + terrainCost(terrain[next]);
        pending.add(next);
      }
  }
  return dist;
}
export function circuitReachable(l: LevelDefinition) {
  if (l.mode !== "circuit") return true;
  const w = l.board.width,
    n = l.board.terrain.length,
    queue = [l.circuit.initialMask * n + cellOf(l.board.spawn, w)],
    seen = new Set(queue),
    gates = new Map(l.circuit.switches.flatMap((s, i) => s.gates.map((p) => [cellOf(p, w), i] as const)));
  for (let h = 0; h < queue.length; h++) {
    const key = queue[h],
      mask = Math.floor(key / n),
      cell = key % n;
    const next = adjacent(cell, w, l.board.height).flatMap((c) => {
      const gate = gates.get(c);
      return (gate !== undefined ? !!(mask & (1 << gate)) : isWalkable(l.board.terrain[c])) ? [mask * n + c] : [];
    });
    l.circuit.switches.forEach((s, i) => {
      if (cellOf(s, w) === cell) next.push((mask ^ (1 << i)) * n + cell);
    });
    for (const key of next)
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
  }
  return l.circuit.contracts.every((c) => seen.has(c.mask * n + cellOf(c, w)));
}
