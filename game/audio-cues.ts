import type { MatchFrame } from "./engine";
import type { LevelDefinition } from "./schema";
export type SoundCue = "click" | "start" | "step" | "pickup" | "checkpoint" | "deposit" | "claim" | "danger" | "eliminated" | "win" | "lose" | "draw" | "neutral";
export function matchSoundCues(_level: LevelDefinition, previous: MatchFrame, frames: readonly MatchFrame[]): SoundCue[] {
  const cues = new Set<SoundCue>();
  for (const frame of frames) {
    for (const event of frame.modeState.events) {
      if (event.kind === "step" && frame.bots.find((b) => b.id === event.botId)?.player) cues.add("step");
      if (event.kind === "collect") cues.add("pickup");
      if (event.kind === "dock") cues.add("deposit");
      if (["claim", "catch", "build"].includes(event.kind)) cues.add("claim");
      if (event.kind === "toggle") cues.add("checkpoint");
      if (["collapse", "bomb", "explosion"].includes(event.kind)) cues.add("danger");
      if (["barrier", "teleport", "distract"].includes(event.kind)) cues.add("checkpoint");
      if (event.kind === "eliminated") cues.add("eliminated");
    }
    if (frame.phase === "finished" && previous.phase !== "finished") {
      const player = frame.bots.find((b) => b.player)!;
      cues.add(!frame.winners.length ? "neutral" : frame.winners.length > 1 ? "draw" : frame.winners.includes(player.id) ? "win" : "lose");
    }
    previous = frame;
  }
  return [...cues];
}
