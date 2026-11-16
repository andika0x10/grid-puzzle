import { levels } from "../game/provider";
import { MatchEngine } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
for (const level of levels.filter((l) => l.mode === "race" || l.mode === "gems")) {
  const engine = new MatchEngine(level, defaultConfig(level.seed));
  let frame = engine.snapshot();
  while (frame.phase !== "finished") frame = engine.step();
  console.log(
    JSON.stringify({
      id: level.id,
      seconds: frame.tick / 20,
      winners: frame.bots.filter((b) => frame.winners.includes(b.id)).map((b) => b.algorithm),
      checkpoints: frame.bots.map((b) => `${b.checkpoints.length}/${b.checkpointTotal}`),
      scores: frame.bots.map((b) => b.score),
      expired: frame.gems.filter((g) => g.expired).length,
    })
  );
}
