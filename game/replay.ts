import type { BoardState, ReplayTrace, TraceEvent } from "./schema";

export function applyEvents(frame: BoardState, events: TraceEvent[]): BoardState {
  const next = {
    ...frame,
    cells: { ...frame.cells },
    entities: { ...frame.entities },
    metrics: { ...frame.metrics },
  };
  for (const e of events) {
    if (e.kind === "cell") {
      const key = `${e.x},${e.y}`;
      next.cells[key] = { ...next.cells[key], ...e.state };
    } else if (e.kind === "entity") next.entities[e.id] = { x: e.x, y: e.y, facing: e.facing };
    else if (e.kind === "path") next.path = e.points;
    else if (e.kind === "centroids") next.centroids = e.points;
    else if (e.kind === "metric") next.metrics[e.id] = e.value;
    else next.note = e.text;
  }
  return next;
}
export function stateAt(trace: ReplayTrace, cursor: number): BoardState {
  const end = Math.max(0, Math.min(trace.steps.length, Math.floor(cursor)));
  return trace.steps.slice(0, end).reduce((state, step) => applyEvents(state, step.events), trace.initial);
}
export type Phase = "ready" | "confirming" | "loading" | "playing" | "paused" | "finished" | "error";
export interface ReplayState {
  phase: Phase;
  trace: ReplayTrace | null;
  frame: BoardState;
  cursor: number;
  speed: number;
  pending: string | null;
  error: string | null;
}
export class ReplayController {
  private state: ReplayState;
  private listeners = new Set<() => void>();
  private elapsed = 0;
  constructor(initial: BoardState) {
    this.state = {
      phase: "ready",
      trace: null,
      frame: initial,
      cursor: 0,
      speed: 1,
      pending: null,
      error: null,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<ReplayState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
  }
  choose(id: string) {
    if (!["playing", "loading", "confirming"].includes(this.state.phase)) this.update({ pending: id, phase: "confirming", error: null });
  }
  cancel() {
    if (this.state.phase === "confirming")
      this.update({
        pending: null,
        phase: this.state.trace ? (this.state.cursor === this.state.trace.steps.length ? "finished" : "paused") : "ready",
      });
  }
  loading() {
    if (this.state.phase === "confirming") this.update({ phase: "loading" });
  }
  load(trace: ReplayTrace) {
    this.elapsed = 0;
    this.update({
      trace,
      frame: trace.initial,
      cursor: 0,
      phase: "playing",
      pending: null,
      error: null,
    });
  }
  fail(message: string) {
    this.update({ phase: "error", error: message });
  }
  play() {
    if (!this.state.trace || ["loading", "confirming"].includes(this.state.phase)) return;
    if (this.state.cursor === this.state.trace.steps.length) this.seek(0);
    this.update({ phase: "playing" });
  }
  pause() {
    if (this.state.phase === "playing") this.update({ phase: "paused" });
  }
  setSpeed(speed: number) {
    if ([0.5, 1, 2, 4].includes(speed)) this.update({ speed });
  }
  seek(cursor: number) {
    const { trace } = this.state;
    if (!trace || ["loading", "confirming"].includes(this.state.phase)) return;
    this.elapsed = 0;
    const clamped = Math.max(0, Math.min(trace.steps.length, Math.floor(cursor)));
    this.update({
      cursor: clamped,
      frame: stateAt(trace, clamped),
      phase: clamped === trace.steps.length ? "finished" : "paused",
    });
  }
  step(delta: number) {
    this.seek(this.state.cursor + delta);
  }
  tick(ms: number) {
    if (this.state.phase !== "playing" || !this.state.trace) return;
    this.elapsed += Math.max(0, Math.min(ms, 100)) * this.state.speed;
    let { cursor, frame } = this.state;
    while (this.elapsed >= 260 && cursor < this.state.trace.steps.length) {
      this.elapsed -= 260;
      frame = applyEvents(frame, this.state.trace.steps[cursor].events);
      cursor++;
    }
    if (cursor !== this.state.cursor)
      this.update({
        cursor,
        frame,
        phase: cursor === this.state.trace.steps.length ? "finished" : "playing",
      });
  }
}
