"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AUDIO_STORAGE_KEY, GameAudio, readAudioMuted, saveAudioMuted } from "../game/audio";

const SoundContext = createContext<{ audio: GameAudio | null; muted: boolean; toggleMuted: () => void }>({ audio: null, muted: false, toggleMuted: () => {} });
export function useSound() {
  return useContext(SoundContext);
}

export default function SoundProvider({ children }: { children: ReactNode }) {
  const [audio] = useState(() => new GameAudio());
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const applyMuted = () => {
      const next = readAudioMuted();
      audio.setMuted(next);
      setMuted(next);
    };
    applyMuted();
    const activate = () => {
      void audio.unlock();
    };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("button,a[href]") : null;
      const audible = target && !target.matches(":disabled,[aria-disabled=true],[data-sound-toggle]");
      void audio.unlock().then((ready) => {
        if (ready && audible) audio.playCues(["click"]);
      });
    };
    const change = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.matches('select,input[type="checkbox"],input[type="radio"]')) {
        void audio.unlock().then((ready) => {
          if (ready) audio.playCues(["click"]);
        });
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) activate();
    };
    const visibility = () => audio.setVisible(!document.hidden);
    const storage = (event: StorageEvent) => {
      if (event.key === AUDIO_STORAGE_KEY || event.key === null) applyMuted();
    };
    visibility();
    document.addEventListener("pointerup", activate, true);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storage);
    return () => {
      document.removeEventListener("pointerup", activate, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storage);
      audio.dispose();
    };
  }, [audio]);
  function toggleMuted() {
    const next = !muted;
    audio.setMuted(next);
    setMuted(next);
    saveAudioMuted(next);
    if (!next)
      void audio.unlock().then((ready) => {
        if (ready) audio.playCues(["click"]);
      });
  }
  return <SoundContext.Provider value={{ audio, muted, toggleMuted }}>{children}</SoundContext.Provider>;
}
