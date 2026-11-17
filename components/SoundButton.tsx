"use client";
import Icon from "./Icon";
import { useSound } from "./SoundProvider";

export default function SoundButton() {
  const { muted, toggleMuted } = useSound();
  const label = muted ? "Nyalakan suara" : "Matikan suara";
  return (
    <button type="button" className="icon-button sound-button" onClick={toggleMuted} aria-label={label} title={label} aria-pressed={muted} data-sound-toggle>
      <Icon name={muted ? "sound-off" : "sound-on"} />
    </button>
  );
}
