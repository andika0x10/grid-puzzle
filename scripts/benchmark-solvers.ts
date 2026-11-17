import fs from "node:fs/promises";
import { MatchEngine } from "../game/engine";
import { levels } from "../game/provider";
import type { AlgorithmId } from "../game/algorithms";
const seeds = Number(process.argv.find((a) => a.startsWith("--seeds="))?.split("=")[1] ?? 5);
if (!Number.isInteger(seeds) || seeds < 1 || seeds > 20) throw Error("Use --seeds=1..20");
interface Row {
  level: string;
  mode: string;
  algorithm: AlgorithmId;
  seed: number;
  tick: number;
  won: boolean;
  solo: boolean;
  score: number;
  finishTick: number | null;
  eliminatedTick: number | null;
  computeOps: number;
  searchTicks: number;
  moveTicks: number;
  idleTicks: number;
  uniqueCells: number;
  firstMove: number | null;
}
const algorithms: AlgorithmId[] = ["dijkstra", "dstar-lite", "random", "mcts"],
  rows: Row[] = [];
const started = performance.now();
for (const algorithm of algorithms) {
  for (const l of levels)
    for (let sample = 0; sample < seeds; sample++) {
      const seed = l.seed + sample * 104729,
        e = new MatchEngine(l, { player: algorithm, opponents: ["astar", "greedy"], seed });
      let f = e.snapshot(),
        firstMove: number | null = null;
      const visited = new Set<number>();
      while (f.phase !== "finished") {
        const previous = f;
        f = e.step();
        const b = f.bots[0];
        if (b.computeOps - previous.bots[0].computeOps > 64) throw Error(`Budget overflow ${l.id}`);
        visited.add(b.y * l.board.width + b.x);
        if (firstMove === null && (b.x !== l.board.spawn.x || b.y !== l.board.spawn.y)) firstMove = f.tick;
      }
      const b = f.bots[0];
      rows.push({
        level: l.id,
        mode: l.mode,
        algorithm,
        seed,
        tick: f.tick,
        won: f.winners.includes(b.id),
        solo: f.winners.length === 1 && f.winners[0] === b.id,
        score: b.score,
        finishTick: b.finishTick,
        eliminatedTick: b.eliminatedTick,
        computeOps: b.computeOps,
        searchTicks: b.searchTicks,
        moveTicks: b.moveTicks,
        idleTicks: f.tick - b.searchTicks - b.moveTicks,
        uniqueCells: visited.size,
        firstMove,
      });
    }
  console.log(`Benchmarked ${algorithm}: ${49 * seeds} matches`);
}
const summary = algorithms.flatMap((algorithm) =>
  [...new Set(levels.map((l) => l.mode))].map((mode) => {
    const rs = rows.filter((r) => r.algorithm === algorithm && r.mode === mode),
      average = (key: "score" | "searchTicks" | "moveTicks" | "uniqueCells") => Math.round((rs.reduce((n, r) => n + r[key], 0) / rs.length) * 100) / 100;
    return {
      algorithm,
      mode,
      matches: rs.length,
      wins: rs.filter((r) => r.won).length,
      soloWins: rs.filter((r) => r.solo).length,
      neverMoved: rs.filter((r) => r.firstMove === null).length,
      score: average("score"),
      searchTicks: average("searchTicks"),
      moveTicks: average("moveTicks"),
      uniqueCells: average("uniqueCells"),
    };
  })
);
await fs.mkdir("artifacts/solver-review", { recursive: true });
const columns = Object.keys(rows[0]);
await fs.writeFile("artifacts/solver-review/matches.csv", [columns.join(","), ...rows.map((r) => columns.map((k) => r[k as keyof typeof r] ?? "").join(","))].join("\n"));
await fs.writeFile(
  "artifacts/solver-review/summary.json",
  JSON.stringify({ seeds, matches: rows.length, seconds: (performance.now() - started) / 1000, opponents: ["astar", "greedy"], summary }, null, 2)
);
console.table(summary);
