import type { MatchFrame } from "./engine";
import type { LevelDefinition } from "./schema";

export type SoundCue = "click" | "start" | "step" | "pickup" | "checkpoint" | "deposit" | "claim" | "danger" | "eliminated" | "win" | "lose" | "draw" | "neutral";

/** Inspect every tick in a worker batch, including temporary ownership changes. */
export function matchSoundCues(level: LevelDefinition, previous: MatchFrame, frames: readonly MatchFrame[]): SoundCue[] {
  const cues = new Set<SoundCue>();
  for (const frame of frames) {
    const player = frame.bots.find((bot) => bot.player);
    const oldPlayer = previous.bots.find((bot) => bot.player);
    if (player && oldPlayer && (player.x !== oldPlayer.x || player.y !== oldPlayer.y)) cues.add("step");
    for (const bot of frame.bots) {
      const old = previous.bots.find((other) => other.id === bot.id);
      if (!old) continue;
      if (bot.keys.length > old.keys.length) cues.add("pickup");
      if (bot.checkpoints.length > old.checkpoints.length) cues.add("checkpoint");
      if (old.eliminatedTick === null && bot.eliminatedTick !== null) cues.add("eliminated");
    }
    if (frame.gems.some((gem, i) => gem.taken && !previous.gems[i]?.taken)) cues.add("pickup");
    for (const [i, parcel] of frame.modeState.parcels.entries()) {
      const old = previous.modeState.parcels[i];
      if (parcel.state === "carried" && old?.state === "available") cues.add("pickup");
      if (parcel.state === "delivered" && old?.state !== "delivered") cues.add("deposit");
    }
    if (
      frame.modeState.territory.some((owner, i) => owner !== null && owner !== previous.modeState.territory[i]) ||
      frame.modeState.posts.some((post, i) => post.owner !== null && post.owner !== previous.modeState.posts[i]?.owner)
    )
      cues.add("claim");
    if (level.mode === "survival" && level.waves.some((wave) => wave.tick > previous.tick && wave.tick <= frame.tick)) cues.add("danger");
    if (frame.phase === "finished" && previous.phase !== "finished") {
      cues.add(!frame.winners.length ? "neutral" : frame.winners.length > 1 ? "draw" : frame.winners.includes(player?.id ?? "") ? "win" : "lose");
    }
    previous = frame;
  }
  return [...cues];
}
