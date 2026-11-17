import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIO_STORAGE_KEY, GameAudio, readAudioMuted, saveAudioMuted } from "../game/audio";
import { matchSoundCues, type SoundCue } from "../game/audio-cues";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { connectGameAudio } from "../game/game-audio";
import { levels } from "../game/provider";
import { SimulationController } from "../game/simulation";
import { fixture, LocalWorker } from "./fixtures";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function audioDevice() {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const oscillators: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; frequency: { value: number } }[] = [];
  const device = {
    currentTime: 0,
    state: "suspended",
    destination: {},
    onstatechange: null as (() => void) | null,
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createOscillator: vi.fn(() => {
      const node = { frequency: { value: 0 }, type: "sine", connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      oscillators.push(node);
      return node;
    }),
    resume: vi.fn(async () => {
      device.state = "running";
      device.onstatechange?.();
    }),
    suspend: vi.fn(async () => {
      device.state = "suspended";
      device.onstatechange?.();
    }),
    close: vi.fn(async () => {
      device.state = "closed";
    }),
  };
  const factory = vi.fn(() => device as unknown as AudioContext);
  return { device, factory, oscillators };
}

describe("browser audio synthesizer", () => {
  it("initializes after a gesture, keeps one music scheduler, and leaves result effects audible after pause", async () => {
    vi.useFakeTimers();
    const { device, factory, oscillators } = audioDevice();
    const audio = new GameAudio(factory);
    audio.setPlaying(true);
    expect(factory).not.toHaveBeenCalled();
    expect(await audio.unlock()).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    audio.setPlaying(true);
    await audio.unlock();
    expect(factory).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    device.currentTime = 0.3;
    vi.advanceTimersByTime(50);
    expect(oscillators.length).toBeGreaterThan(3);
    audio.setPlaying(false);
    expect(vi.getTimerCount()).toBe(0);
    const before = oscillators.length;
    audio.playCues(["win"]);
    expect(oscillators).toHaveLength(before + 4);
    audio.dispose();
    expect(device.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels scheduled notes on mute and hidden tabs, and can resume or remount cleanly", async () => {
    vi.useFakeTimers();
    const { device, factory, oscillators } = audioDevice();
    const audio = new GameAudio(factory);
    await audio.unlock();
    audio.setPlaying(true);
    audio.playCues(["win"]);
    audio.setMuted(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.at(-1)?.[0] === 0.025)).toBe(true);
    const count = oscillators.length;
    audio.playCues(["pickup"]);
    expect(oscillators).toHaveLength(count);
    audio.setMuted(false);
    expect(vi.getTimerCount()).toBe(1);
    audio.setVisible(false);
    expect(device.suspend).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    audio.setVisible(true);
    audio.setPlaying(false);
    await audio.unlock();
    expect(vi.getTimerCount()).toBe(0);
    audio.setPlaying(true);
    expect(vi.getTimerCount()).toBe(1);
    audio.dispose();
    await audio.unlock();
    expect(factory).toHaveBeenCalledTimes(2);
    audio.dispose();
  });

  it("limits footsteps to 150ms and gives the result exclusive priority", async () => {
    const { device, factory, oscillators } = audioDevice();
    const audio = new GameAudio(factory);
    await audio.unlock();
    audio.playCues(["step", "step"]);
    device.currentTime = 0.1;
    audio.playCues(["step"]);
    expect(oscillators).toHaveLength(1);
    device.currentTime = 0.16;
    audio.playCues(["step"]);
    expect(oscillators).toHaveLength(2);
    audio.playCues(["step", "pickup", "win"]);
    expect(oscillators).toHaveLength(6);
    device.currentTime = 0.4;
    audio.playCues(["pickup", "step"]);
    expect(oscillators).toHaveLength(6);
    audio.dispose();
  });

  it("handles unsupported audio, constructor errors and rejected resume without interrupting gameplay", async () => {
    for (const factory of [
      () => null,
      () => {
        throw new Error("device unavailable");
      },
    ]) {
      const audio = new GameAudio(factory);
      expect(await audio.unlock()).toBe(false);
      expect(() => {
        audio.setPlaying(true);
        audio.playCues(["start"]);
        audio.dispose();
      }).not.toThrow();
    }
    const { device, factory } = audioDevice();
    device.resume.mockRejectedValueOnce(new Error("gesture required"));
    const audio = new GameAudio(factory);
    expect(await audio.unlock()).toBe(false);
    expect(await audio.unlock()).toBe(true);
    audio.dispose();
  });

  it("stops scheduling if the audio device fails while producing music", async () => {
    vi.useFakeTimers();
    const { device, factory } = audioDevice();
    const audio = new GameAudio(factory);
    await audio.unlock();
    device.createOscillator.mockImplementation(() => {
      throw new Error("device disconnected");
    });
    expect(() => audio.setPlaying(true)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    audio.dispose();
  });
});

describe("audio preferences", () => {
  it("defaults to enabled and safely reads corrupt or unavailable storage", () => {
    for (const value of [null, "broken", "null", '{"version":2,"muted":true}', '{"version":1,"muted":"true"}']) {
      expect(readAudioMuted({ getItem: () => value, setItem: () => {} })).toBe(false);
    }
    expect(
      readAudioMuted({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      })
    ).toBe(false);
    expect(() =>
      saveAudioMuted(true, {
        getItem: () => null,
        setItem: () => {
          throw new Error("blocked");
        },
      })
    ).not.toThrow();
    expect(readAudioMuted(null)).toBe(false);
  });
  it("persists only the audio preference", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
    };
    saveAudioMuted(true, storage);
    expect(readAudioMuted(storage)).toBe(true);
    saveAudioMuted(false, storage);
    expect(readAudioMuted(storage)).toBe(false);
    expect([...data.keys()]).toEqual([AUDIO_STORAGE_KEY]);
  });
});

describe("match audio cues", () => {
  it.each(["race", "gems", "cargo", "territory", "keys", "outposts", "survival"] as const)("maps important %s events", (mode) => {
    const level = levels.find((item) => item.mode === mode)!;
    const previous = previewFrame(level, defaultConfig(level.seed));
    const next = structuredClone(previous);
    let expected: SoundCue[] = [];
    if (mode === "race") {
      next.bots[0].checkpoints.push(0);
      expected = ["checkpoint"];
    }
    if (mode === "gems") {
      next.gems[0].taken = true;
      expected = ["pickup"];
    }
    if (mode === "cargo") {
      next.modeState.parcels[0].state = "carried";
      expected = ["pickup"];
    }
    if (mode === "territory") {
      next.modeState.territory[0] = "bot-0";
      expected = ["claim"];
    }
    if (mode === "keys") {
      next.bots[0].keys.push("red");
      expected = ["pickup"];
    }
    if (mode === "outposts") {
      next.modeState.posts[0].owner = "bot-0";
      expected = ["claim"];
    }
    if (mode === "survival") {
      next.tick = level.waves[0].tick;
      next.bots[0].eliminatedTick = next.tick;
      expected = ["danger", "eliminated"];
    }
    expect(matchSoundCues(level, previous, [next]).sort()).toEqual(expected.sort());
  });

  it("preserves intermediate events in a batch and only follows the player's footsteps", () => {
    const level = levels.find((item) => item.mode === "cargo")!;
    const previous = previewFrame(level, defaultConfig(level.seed));
    const picked = structuredClone(previous);
    picked.modeState.parcels[0].state = "carried";
    picked.bots[1].x++;
    expect(matchSoundCues(level, previous, [picked])).toEqual(["pickup"]);
    const delivered = structuredClone(picked);
    delivered.modeState.parcels[0].state = "delivered";
    delivered.bots[0].x++;
    expect(matchSoundCues(level, previous, [picked, delivered]).sort()).toEqual(["deposit", "pickup", "step"]);
  });

  it.each([
    [["bot-0"], "win"],
    [["bot-1"], "lose"],
    [["bot-0", "bot-1"], "draw"],
    [[], "neutral"],
  ] as [string[], SoundCue][])("maps winners %j to %s", (winners, cue) => {
    const level = fixture();
    const previous = previewFrame(level, defaultConfig(1));
    const next = { ...previous, phase: "finished" as const, winners };
    expect(matchSoundCues(level, previous, [next, next])).toEqual([cue]);
  });
});

describe("live playback audio integration", () => {
  function setup() {
    const level = fixture();
    const port = new LocalWorker();
    const controller = new SimulationController(level, () => port);
    const audio = { setPlaying: vi.fn(), playCues: vi.fn<(cues: readonly SoundCue[]) => void>(), reset: vi.fn() };
    const disconnect = connectGameAudio(controller, level, audio);
    const heard = () => audio.playCues.mock.calls.flatMap(([cues]) => cues);
    return { port, controller, audio, disconnect, heard };
  }

  it("emits all live batch ticks and stays silent for manual steps, history, and late paused responses", () => {
    const { port, controller, audio, disconnect } = setup();
    const playback = vi.fn();
    const unsubscribe = controller.subscribePlayback(playback);
    controller.play();
    controller.setSpeed(4);
    controller.tick(100);
    expect(playback).toHaveBeenCalledOnce();
    expect(playback.mock.calls[0][0].frames.map((frame: { tick: number }) => frame.tick)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    controller.pause();
    audio.playCues.mockClear();
    controller.step(1);
    controller.seek(0);
    expect(audio.playCues).not.toHaveBeenCalled();
    controller.play();
    controller.tick(100);
    expect(playback).toHaveBeenCalledOnce();
    controller.tick(100);
    port.deferred = true;
    controller.tick(100);
    controller.pause();
    const count = playback.mock.calls.length;
    port.flush();
    expect(playback).toHaveBeenCalledTimes(count);
    unsubscribe();
    disconnect();
    controller.dispose();
  });

  it("announces results once per run, re-arms on restart, and releases playback on unmount", () => {
    const { controller, audio, disconnect, heard } = setup();
    const finish = () => {
      while (controller.getSnapshot().phase !== "finished") controller.tick(100);
    };
    controller.play();
    finish();
    expect(heard().filter((cue) => ["win", "lose", "draw", "neutral"].includes(cue))).toHaveLength(1);
    controller.seek(0);
    controller.play();
    finish();
    expect(heard().filter((cue) => ["win", "lose", "draw", "neutral"].includes(cue))).toHaveLength(1);
    controller.start();
    finish();
    expect(heard().filter((cue) => ["win", "lose", "draw", "neutral"].includes(cue))).toHaveLength(2);
    disconnect();
    expect(audio.setPlaying).toHaveBeenLastCalledWith(false);
    audio.playCues.mockClear();
    controller.start();
    finish();
    expect(audio.playCues).not.toHaveBeenCalled();
    controller.dispose();
  });
});
