import type { CSSProperties } from "react";
import type { LevelDefinition } from "../game/schema";
import type { MatchFrame } from "../game/engine";
import { sharedObjectFrames, type SharedObjectFrame } from "../game/assets";
import { feverMultiplier } from "../game/classic";

function SpriteIcon({ name }: { name: SharedObjectFrame }) {
  const i = sharedObjectFrames.indexOf(name);
  return (
    <span
      aria-hidden="true"
      className="rule-icon"
      style={
        {
          backgroundImage: "url(/assets/game/shared/atlas.png)",
          backgroundSize: `192px ${Math.ceil(sharedObjectFrames.length / 8) * 24}px`,
          backgroundPosition: `${-(i % 8) * 24}px ${-Math.floor(i / 8) * 24}px`,
        } as CSSProperties
      }
    />
  );
}
export default function RuleRibbon({ level, frame }: { level: LevelDefinition; frame: MatchFrame }) {
  if (level.rulesVersion < 2 || (level.mode !== "race" && level.mode !== "gems")) return null;
  const player = frame.bots.find((b) => b.player)!,
    seconds = (tick: number) => `${Math.max(0, Math.ceil((tick - frame.tick) / 20))} dtk`;
  const nextGate = level.changes.find((c) => c.tick > frame.tick),
    active = feverMultiplier(level, frame.tick) === 2;
  const nextWave = Math.min(...level.board.gems.filter((g) => (g.spawnTick ?? 0) > frame.tick).map((g) => g.spawnTick!));
  const fever = level.fever.find((f) => f.endTick > frame.tick);
  return (
    <div className="rule-ribbon" aria-label="Aturan dan jadwal arena">
      {level.mode === "race" ? (
        <>
          <span>
            <SpriteIcon name="checkpoint-idle" />
            <strong>
              {player.checkpoints.length}/{level.board.checkpoints.length} pos
            </strong>
            <small>Urutan bebas</small>
          </span>
          <span>
            <SpriteIcon name="gate-open" />
            {nextGate ? `Gerbang berubah ${seconds(nextGate.tick)}` : "Jalur akhir"}
          </span>
        </>
      ) : (
        <>
          <span className="gem-values">
            <SpriteIcon name="gem-0" />1 <SpriteIcon name="gem-blue" />3 <SpriteIcon name="gem-red" />5 <small>poin</small>
          </span>
          <span>
            <SpriteIcon name="gem-dormant" />
            {Number.isFinite(nextWave) ? `Gelombang ${seconds(nextWave)}` : "Gelombang terakhir"}
          </span>
          <span className={active ? "fever-active" : ""}>
            <SpriteIcon name="gem-fever" />
            {active ? `Gem ganda ×2 · ${seconds(fever!.endTick)}` : fever ? `Bonus ×2 · ${seconds(fever.startTick)}` : "Bonus selesai"}
          </span>
        </>
      )}
    </div>
  );
}
