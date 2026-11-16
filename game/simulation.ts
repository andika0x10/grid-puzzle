import { defaultConfig, type MatchConfig } from "./algorithms";
import { matchResult, previewFrame, TICK_MS, type MatchFrame, type MatchResult } from "./engine";
import type { LevelDefinition } from "./schema";
import type { WorkerRequest, WorkerResponse } from "./simulation.worker";
export interface WorkerPort {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export type SimulationPhase = "ready" | "starting" | "playing" | "paused" | "finished" | "error";
export interface SimulationState {
  phase: SimulationPhase;
  frame: MatchFrame;
  cursor: number;
  head: number;
  speed: number;
  config: MatchConfig;
  error: string | null;
  result: MatchResult | null;
  run: number;
}
export class SimulationController {
  private state: SimulationState;
  private listeners = new Set<() => void>();
  private worker: WorkerPort | null = null;
  private history: MatchFrame[] = [];
  private elapsed = 0;
  private busy = false;
  private stepping = false;
  constructor(
    private level: LevelDefinition,
    private factory: () => WorkerPort = () => new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerPort
  ) {
    const config = defaultConfig(level.seed);
    this.state = { phase: "ready", frame: previewFrame(level, config), cursor: 0, head: 0, speed: 1, config, error: null, result: null, run: 0 };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<SimulationState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }
  configure(config: MatchConfig) {
    this.stopWorker();
    this.history = [];
    this.stepping = false;
    this.update({ phase: "ready", config, frame: previewFrame(this.level, config), cursor: 0, head: 0, result: null, error: null });
  }
  start(config = this.state.config) {
    this.stopWorker();
    this.history = [];
    this.elapsed = 0;
    this.stepping = false;
    this.update({ phase: "starting", config, frame: previewFrame(this.level, config), cursor: 0, head: 0, result: null, error: null, run: this.state.run + 1 });
    try {
      const worker = this.factory();
      this.worker = worker;
      this.busy = true;
      worker.onerror = () => {
        if (worker === this.worker) this.fail("Simulasi terhenti. Coba mulai ulang pertandingan.");
      };
      worker.onmessage = ({ data }) => {
        if (worker !== this.worker) return;
        this.busy = false;
        if (data.kind === "error") {
          this.fail(data.message);
          return;
        }
        const wasAtHead = this.state.cursor === this.state.head;
        this.history.push(...data.frames);
        const head = this.history.length - 1,
          last = this.history[head];
        if (data.kind === "started") {
          this.update({ phase: this.state.phase === "paused" ? "paused" : "playing", frame: last, cursor: 0, head });
          return;
        }
        const result = last.phase === "finished" ? matchResult(last) : this.state.result;
        if ((this.state.phase === "playing" && wasAtHead) || this.stepping) {
          this.update({ frame: last, cursor: head, head, phase: last.phase === "finished" ? "finished" : this.stepping ? "paused" : "playing", result });
        } else this.update({ head, result });
        this.stepping = false;
      };
      worker.postMessage({ kind: "start", level: this.level, config });
    } catch {
      this.fail("Browser belum dapat menjalankan simulasi. Muat ulang lalu coba lagi.");
    }
  }
  private fail(message: string) {
    this.stopWorker();
    this.update({ phase: "error", error: message });
  }
  play() {
    if (["ready", "finished", "error"].includes(this.state.phase)) this.start();
    else if (this.state.phase === "paused") {
      this.elapsed = 0;
      this.update({ phase: "playing" });
    }
  }
  pause() {
    if (this.state.phase === "playing" || this.state.phase === "starting") {
      this.elapsed = 0;
      this.update({ phase: "paused" });
    }
  }
  setSpeed(speed: number) {
    if ([0.5, 1, 2, 4].includes(speed)) this.update({ speed });
  }
  seek(cursor: number) {
    if (!this.history.length) return;
    const clamped = Math.max(0, Math.min(this.state.head, Math.floor(cursor)));
    this.elapsed = 0;
    this.update({ cursor: clamped, frame: this.history[clamped], phase: this.history[clamped].phase === "finished" ? "finished" : "paused" });
  }
  step(delta: number) {
    if (!this.history.length || this.state.phase === "starting") return;
    this.pause();
    if (delta < 0 || this.state.cursor < this.state.head) this.seek(this.state.cursor + delta);
    else if (!this.busy && this.history[this.state.head].phase !== "finished") {
      this.stepping = true;
      this.busy = true;
      this.worker?.postMessage({ kind: "advance", ticks: 1 });
    }
  }
  tick(ms: number) {
    if (this.state.phase !== "playing" || this.busy) return;
    this.elapsed += Math.max(0, Math.min(ms, 100)) * this.state.speed;
    const count = Math.min(8, Math.floor(this.elapsed / TICK_MS));
    if (!count) return;
    this.elapsed -= count * TICK_MS;
    if (this.state.cursor < this.state.head) {
      const cursor = Math.min(this.state.head, this.state.cursor + count),
        frame = this.history[cursor];
      this.update({ cursor, frame, phase: frame.phase === "finished" ? "finished" : "playing" });
    } else {
      this.busy = true;
      this.worker?.postMessage({ kind: "advance", ticks: count });
    }
  }
  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.elapsed = 0;
  }
  dispose() {
    this.stopWorker();
  }
}
