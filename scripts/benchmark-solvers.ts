import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { MatchEngine } from "../game/engine";
import { levels } from "../game/provider";
import { algorithms as registry, unavailableReason, type AlgorithmId } from "../game/algorithms";
const seeds = Number(process.argv.find((a) => a.startsWith("--seeds="))?.split("=")[1] ?? 4);
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
  bombsPlaced: number;
  wallsPlaced: number;
  distractions: number;
  teleports: number;
}
const filter = process.argv.find((a) => a.startsWith("--algorithm="))?.split("=")[1];
const algorithms: AlgorithmId[] = registry.map((a) => a.id).filter((id) => !filter || id === filter),
  rows: Row[] = [];
const started = performance.now();
const sourceFiles = [
  "game/algorithms.ts",
  "game/engine.ts",
  "game/modes.ts",
  "game/extra-modes.ts",
  "game/search.ts",
  "game/decisions.ts",
  "game/planning.ts",
  "content/catalog.json",
];
const digest = async () =>
  createHash("sha256")
    .update((await Promise.all(sourceFiles.map((p) => fs.readFile(p)))).map((b) => b.toString()).join("\n"))
    .digest("hex");
const sourceHash = await digest();
for (const algorithm of algorithms) {
  for (const l of levels.filter((l) => !unavailableReason(algorithm, l)))
    for (let sample = 0; sample < seeds; sample++) {
      const seed = l.seed + sample * 104729,
        opponents: AlgorithmId[] = (["astar", "greedy", "weighted-astar"] as AlgorithmId[]).filter((id) => id !== algorithm).slice(0, 2),
        e = new MatchEngine(l, { player: algorithm, opponents, seed, seatOffset: sample % 4 });
      let f = e.snapshot(),
        start = { x: f.bots[0].x, y: f.bots[0].y },
        firstMove: number | null = null;
      const visited = new Set<number>();
      const special = { bombsPlaced: 0, wallsPlaced: 0, distractions: 0, teleports: 0 };
      while (f.phase !== "finished") {
        const previous = f;
        f = e.step();
        const b = f.bots[0];
        for (const bot of f.bots) if (bot.computeOps - previous.bots.find((p) => p.id === bot.id)!.computeOps > 64) throw Error(`Budget overflow ${l.id}/${bot.algorithm}`);
        visited.add(b.y * l.board.width + b.x);
        if (firstMove === null && (b.x !== start.x || b.y !== start.y)) firstMove = f.tick;
        for (const event of f.modeState.events.filter((e) => e.botId === b.id)) {
          if (event.kind === "bomb") special.bombsPlaced++;
          if (event.kind === "barrier") special.wallsPlaced++;
          if (event.kind === "distract") special.distractions++;
          if (event.kind === "teleport") special.teleports++;
        }
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
        ...special,
      });
    }
  console.log(`Benchmarked ${algorithm}: ${rows.filter((r) => r.algorithm === algorithm).length} matches`);
}
const summary = algorithms.flatMap((algorithm) =>
  [...new Set(levels.map((l) => l.mode))].map((mode) => {
    const rs = rows.filter((r) => r.algorithm === algorithm && r.mode === mode),
      average = (key: "score" | "searchTicks" | "moveTicks" | "uniqueCells") => (rs.length ? Math.round((rs.reduce((n, r) => n + r[key], 0) / rs.length) * 100) / 100 : null);
    return {
      algorithm,
      mode,
      matches: rs.length,
      applicable: rs.length > 0,
      wins: rs.filter((r) => r.won).length,
      soloWins: rs.filter((r) => r.solo).length,
      neverMoved: rs.filter((r) => r.firstMove === null).length,
      score: average("score"),
      searchTicks: average("searchTicks"),
      moveTicks: average("moveTicks"),
      uniqueCells: average("uniqueCells"),
      bombsPlaced: rs.reduce((n, r) => n + r.bombsPlaced, 0),
      wallsPlaced: rs.reduce((n, r) => n + r.wallsPlaced, 0),
      distractions: rs.reduce((n, r) => n + r.distractions, 0),
      teleports: rs.reduce((n, r) => n + r.teleports, 0),
    };
  })
);
await fs.mkdir("artifacts/algorithm-audit", { recursive: true });
if ((await digest()) !== sourceHash) throw Error("Sources changed during benchmark. Run again against a stable source snapshot.");
const columns = Object.keys(rows[0]);
await fs.writeFile("artifacts/algorithm-audit/matches.csv", [columns.join(","), ...rows.map((r) => columns.map((k) => r[k as keyof typeof r] ?? "").join(","))].join("\n"));
await fs.writeFile(
  "artifacts/algorithm-audit/summary.json",
  JSON.stringify(
    {
      seeds,
      sourceHash,
      matches: rows.length,
      seconds: (performance.now() - started) / 1000,
      opponents: "First two of A*, Greedy, Weighted A* excluding the evaluated algorithm",
      operationsPerTick: 64,
      seatPolicy: "Rotate 0,1,2,3 over samples; all participants use authored starts",
      summary,
    },
    null,
    2
  )
);
console.log(`Saved ${rows.length} matches and ${summary.length} category evaluations to artifacts/algorithm-audit.`);
