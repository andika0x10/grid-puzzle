import type { SoundCue } from "./audio-cues";

export const AUDIO_STORAGE_KEY = "grid-puzzle.audio.v1";
type Store = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function readAudioMuted(storage: Store | null = browserStorage()): boolean {
  try {
    const saved = JSON.parse(storage?.getItem(AUDIO_STORAGE_KEY) ?? "null");
    return saved?.version === 1 && saved.muted === true;
  } catch {
    return false;
  }
}
export function saveAudioMuted(muted: boolean, storage: Store | null = browserStorage()): void {
  try {
    storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ version: 1, muted }));
  } catch {
    /* The provider keeps the preference in memory. */
  }
}

type Note = readonly [midi: number, offset: number, duration: number];
const effects: Record<SoundCue, { notes: readonly Note[]; priority: number; type?: OscillatorType }> = {
  click: { notes: [[79, 0, 0.035]], priority: 0, type: "triangle" },
  step: { notes: [[43, 0, 0.035]], priority: 1, type: "triangle" },
  claim: {
    notes: [
      [67, 0, 0.055],
      [72, 0.045, 0.08],
    ],
    priority: 2,
  },
  pickup: {
    notes: [
      [83, 0, 0.065],
      [95, 0.06, 0.12],
    ],
    priority: 3,
  },
  danger: {
    notes: [
      [66, 0, 0.1],
      [60, 0.12, 0.14],
    ],
    priority: 4,
  },
  start: {
    notes: [
      [60, 0, 0.09],
      [64, 0.1, 0.09],
      [67, 0.2, 0.16],
    ],
    priority: 5,
  },
  checkpoint: {
    notes: [
      [72, 0, 0.08],
      [76, 0.08, 0.08],
      [79, 0.16, 0.16],
    ],
    priority: 6,
  },
  deposit: {
    notes: [
      [67, 0, 0.08],
      [72, 0.08, 0.08],
      [79, 0.16, 0.2],
    ],
    priority: 6,
  },
  eliminated: {
    notes: [
      [60, 0, 0.12],
      [55, 0.1, 0.12],
      [48, 0.2, 0.2],
    ],
    priority: 7,
    type: "triangle",
  },
  win: {
    notes: [
      [72, 0, 0.12],
      [76, 0.12, 0.12],
      [79, 0.24, 0.12],
      [84, 0.4, 0.4],
    ],
    priority: 10,
  },
  lose: {
    notes: [
      [67, 0, 0.18],
      [64, 0.18, 0.18],
      [60, 0.36, 0.35],
    ],
    priority: 10,
    type: "triangle",
  },
  draw: {
    notes: [
      [72, 0, 0.14],
      [76, 0.16, 0.14],
      [72, 0.32, 0.3],
    ],
    priority: 10,
    type: "triangle",
  },
  neutral: {
    notes: [
      [64, 0, 0.18],
      [60, 0.22, 0.3],
    ],
    priority: 10,
    type: "triangle",
  },
};

// Eight bars, 100 BPM. An original C–Am–F–G melody, shared by all worlds.
const melody = [
  [72, null, 76, 79, 76, null, 74, 72],
  [69, null, 72, 76, 79, 76, 72, null],
  [69, 72, 77, null, 76, 72, 69, null],
  [71, null, 74, 79, 77, 74, 71, null],
  [76, 79, 84, null, 83, 79, 76, 74],
  [72, null, 76, 81, 79, 76, 72, null],
  [77, null, 76, 72, 69, 72, 76, 77],
  [79, null, 77, 74, 71, null, 74, 71],
].flat();
const roots = [48, 45, 41, 43, 48, 45, 41, 43];
const eighth = 60 / 100 / 2;
type Voice = { oscillator: OscillatorNode; envelope: GainNode; music: boolean };

/** Browser-only synthesizer. Construction is safe during server rendering. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private effectsBus: GainNode | null = null;
  private voices = new Set<Voice>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private playing = false;
  private visible = true;
  private muted = false;
  private musicStep = 0;
  private nextNote = 0;
  private lastCue = new Map<SoundCue, number>();
  private effectPriority = -1;
  private effectUntil = 0;

  constructor(
    private createContext: () => AudioContext | null = () => {
      if (typeof window === "undefined") return null;
      const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      return Audio ? new Audio() : null;
    }
  ) {}

  async unlock(): Promise<boolean> {
    if (this.muted || !this.visible) return false;
    try {
      if (!this.context) {
        const context = this.createContext();
        if (!context) return false;
        this.context = context;
        this.master = context.createGain();
        this.musicBus = context.createGain();
        this.effectsBus = context.createGain();
        this.master.gain.value = 0.8;
        this.musicBus.gain.value = 0.28;
        this.effectsBus.gain.value = 0.65;
        this.musicBus.connect(this.master);
        this.effectsBus.connect(this.master);
        this.master.connect(context.destination);
        context.onstatechange = () => {
          if (context !== this.context) return;
          if (context.state === "running") this.syncMusic();
          else {
            this.stopMusic();
            this.stopVoices(false);
          }
        };
      }
      const context = this.context;
      await context.resume();
      if (context !== this.context || this.muted || !this.visible) return false;
      this.syncMusic();
      return context.state === "running";
    } catch {
      // Audio failure must never interrupt a match; another gesture may retry.
      return false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      this.master?.gain.setTargetAtTime(muted ? 0 : 0.8, this.context!.currentTime, 0.01);
    } catch {
      /* Audio may be unavailable. */
    }
    if (muted) {
      this.stopMusic();
      this.stopVoices(false);
    } else this.syncMusic();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.stopMusic();
      this.stopVoices(false);
      try {
        void this.context?.suspend().catch(() => {});
      } catch {
        /* Unsupported or closed context. */
      }
    }
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.syncMusic();
  }

  reset(): void {
    this.stopMusic();
    this.stopVoices(false);
    this.musicStep = 0;
    this.lastCue.clear();
    this.effectUntil = 0;
    this.effectPriority = -1;
  }

  playCues(cues: readonly SoundCue[]): void {
    const context = this.context;
    if (!context || context.state !== "running" || this.muted || !this.visible) return;
    const cue = [...new Set(cues)].sort((a, b) => effects[b].priority - effects[a].priority)[0];
    if (!cue) return;
    const now = context.currentTime;
    const effect = effects[cue];
    const interval = cue === "step" ? 0.15 : cue === "click" ? 0.07 : 0.12;
    if (now - (this.lastCue.get(cue) ?? -Infinity) < interval || (now < this.effectUntil && effect.priority < this.effectPriority)) return;
    try {
      if (effect.priority >= 7) this.stopVoices(false);
      this.lastCue.set(cue, now);
      this.effectPriority = effect.priority;
      this.effectUntil = now + Math.max(...effect.notes.map(([, offset, duration]) => offset + duration));
      for (const [midi, offset, duration] of effect.notes) this.note(midi, now + offset, duration, effect.type ?? "square", cue === "step" ? 0.045 : 0.12, false);
    } catch {
      /* A device/context failure is silent to gameplay. */
    }
  }

  private note(midi: number, at: number, duration: number, type: OscillatorType, volume: number, music: boolean): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(envelope);
    envelope.connect((music ? this.musicBus : this.effectsBus)!);
    const voice = { oscillator, envelope, music };
    this.voices.add(voice);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      this.voices.delete(voice);
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private syncMusic(): void {
    if (!this.playing || this.muted || !this.visible || this.context?.state !== "running") {
      this.stopMusic();
      return;
    }
    if (this.timer !== null) return;
    this.nextNote = this.context.currentTime + 0.03;
    this.timer = setInterval(() => this.scheduleMusic(), 50);
    this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const context = this.context;
    if (!context || context.state !== "running") {
      this.stopMusic();
      return;
    }
    try {
      // Skip missed beats after a busy frame instead of bursting overdue notes.
      if (this.nextNote < context.currentTime) this.nextNote = context.currentTime + 0.015;
      while (this.nextNote < context.currentTime + 0.15) {
        const step = this.musicStep % melody.length;
        const root = roots[Math.floor(step / 8)];
        const midi = melody[step];
        if (midi !== null) this.note(midi, this.nextNote, eighth * 0.8, "square", 0.07, true);
        if (step % 2 === 0) this.note(root, this.nextNote, eighth * 1.65, "triangle", 0.19, true);
        this.note(root + [12, 19, 24, 19][step % 4], this.nextNote, eighth * 0.55, "triangle", 0.065, true);
        this.nextNote += eighth;
        this.musicStep++;
      }
    } catch {
      this.stopMusic();
    }
  }

  private stopMusic(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.stopVoices(true);
  }

  private stopVoices(music: boolean): void {
    for (const voice of this.voices) {
      if (voice.music !== music) continue;
      try {
        const now = this.context!.currentTime;
        voice.envelope.gain.cancelScheduledValues(now);
        voice.envelope.gain.setTargetAtTime(0, now, 0.005);
        voice.oscillator.stop(now + 0.025);
      } catch {
        /* Already stopped or closed. */
      }
      this.voices.delete(voice);
    }
  }

  dispose(): void {
    this.playing = false;
    this.reset();
    const context = this.context;
    this.context = null;
    this.master = this.musicBus = this.effectsBus = null;
    if (context) {
      context.onstatechange = null;
      try {
        void context.close().catch(() => {});
      } catch {
        /* Already closed. */
      }
    }
  }
}
