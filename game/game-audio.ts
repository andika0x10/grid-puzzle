import type { GameAudio } from "./audio";
import { matchSoundCues } from "./audio-cues";
import type { LevelDefinition } from "./schema";
import type { SimulationController } from "./simulation";

export function connectGameAudio(controller: SimulationController, level: LevelDefinition, audio: Pick<GameAudio, "setPlaying" | "playCues" | "reset">): () => void {
  let run = controller.getSnapshot().run;
  let startedRun = -1;
  let resultRun = -1;
  let phase = controller.getSnapshot().phase;
  const update = () => {
    const state = controller.getSnapshot();
    if (state.run !== run || (state.phase === "ready" && phase !== "ready")) {
      audio.reset();
      run = state.run;
    }
    audio.setPlaying(state.phase === "playing");
    if (state.phase === "playing" && startedRun !== run) {
      startedRun = run;
      audio.playCues(["start"]);
    } else if ((state.phase === "paused" && phase === "playing") || (state.phase === "playing" && phase === "paused")) audio.playCues(["click"]);
    phase = state.phase;
  };
  const unsubscribe = controller.subscribe(update);
  const unsubscribePlayback = controller.subscribePlayback((batch) => {
    if (batch.run === resultRun) return;
    const cues = matchSoundCues(level, batch.previous, batch.frames);
    if (batch.frames.some((frame) => frame.phase === "finished")) resultRun = batch.run;
    audio.playCues(cues);
  });
  update();
  return () => {
    unsubscribe();
    unsubscribePlayback();
    audio.setPlaying(false);
    audio.reset();
  };
}
