import { MatchEngine, type MatchFrame } from "./engine";
import type { MatchConfig } from "./algorithms";
import type { LevelDefinition } from "./schema";
export type WorkerRequest = { kind: "start"; level: LevelDefinition; config: MatchConfig } | { kind: "advance"; ticks: number };
export type WorkerResponse = { kind: "started" | "frames"; frames: MatchFrame[] } | { kind: "error"; message: string };
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage: (message: WorkerResponse) => void };
let engine: MatchEngine | null = null;
scope.onmessage = ({ data }) => {
  try {
    if (data.kind === "start") {
      engine = new MatchEngine(data.level, data.config);
      scope.postMessage({ kind: "started", frames: [engine.snapshot()] });
    } else if (engine) {
      const frames: MatchFrame[] = [];
      const count = Math.max(1, Math.min(8, Math.floor(data.ticks)));
      for (let i = 0; i < count; i++) {
        const frame = engine.step();
        frames.push(frame);
        if (frame.phase === "finished") break;
      }
      scope.postMessage({ kind: "frames", frames });
    }
  } catch (error) {
    scope.postMessage({ kind: "error", message: error instanceof Error ? error.message : "Simulasi belum dapat berjalan." });
  }
};
