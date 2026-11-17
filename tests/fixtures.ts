import { MatchEngine } from "../game/engine";
import type { WorkerPort } from "../game/simulation";
import type { WorkerRequest, WorkerResponse } from "../game/simulation.worker";
import { getLevel } from "../game/provider";
import { levelSchema, type LevelDefinition } from "../game/schema";
export function fixture(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  const base = structuredClone(getLevel(`${overrides.mode ?? "fog"}-1`)!);
  if (!overrides.mode) {
    base.id = "test";
    base.title = "Test";
    base.board = {
      width: 7,
      height: 5,
      terrain: Array.from({ length: 35 }, (_, c) => (c % 7 === 0 || c % 7 === 6 || c < 7 || c >= 28 ? "wall" : "ground")),
      spawn: { x: 1, y: 2 },
      goal: { x: 5, y: 2 },
      decorations: [],
    };
  }
  return levelSchema.parse({ ...base, ...overrides });
}
export class LocalWorker implements WorkerPort {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  engine: MatchEngine | null = null;
  messages: WorkerRequest[] = [];
  terminated = false;
  deferred = false;
  pending: WorkerResponse[] = [];
  postMessage(message: WorkerRequest) {
    this.messages.push(message);
    let response: WorkerResponse;
    if (message.kind === "start") {
      this.engine = new MatchEngine(message.level, message.config);
      response = { kind: "started", frames: [this.engine.snapshot()] };
    } else {
      const frames = [];
      for (let i = 0; i < Math.min(8, message.ticks); i++) {
        const f = this.engine!.step();
        frames.push(f);
        if (f.phase === "finished") break;
      }
      response = { kind: "frames", frames };
    }
    if (this.deferred) this.pending.push(response);
    else this.deliver(response);
  }
  deliver(response: WorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }
  flush() {
    for (const response of this.pending.splice(0)) this.deliver(response);
  }
  terminate() {
    this.terminated = true;
  }
}
