import { MatchEngine } from "../game/engine";
import type { WorkerPort } from "../game/simulation";
import type { WorkerRequest, WorkerResponse } from "../game/simulation.worker";
import { levelSchema, type LevelDefinition } from "../game/schema";
export function fixture(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return levelSchema.parse({
    schemaVersion: 2,
    id: "test",
    sectionId: "navigation",
    order: 1,
    title: "Test",
    mission: "Capai finis.",
    theme: "farm",
    mode: "race",
    seed: 42,
    timeLimit: 1200,
    board: { width: 5, height: 3, terrain: Array(15).fill("ground"), spawn: { x: 0, y: 1 }, goal: { x: 4, y: 1 }, gems: [], decorations: [] },
    changes: [],
    ...overrides,
  });
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
