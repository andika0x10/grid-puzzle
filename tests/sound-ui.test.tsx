// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import SoundProvider from "../components/SoundProvider";
import SoundButton from "../components/SoundButton";
import { AUDIO_STORAGE_KEY, GameAudio } from "../game/audio";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sound controls", () => {
  it("persists mute after reload and keeps it while route content changes", () => {
    const view = (route: string) => (
      <SoundProvider>
        <SoundButton />
        <main key={route}>{route}</main>
      </SoundProvider>
    );
    const { rerender, unmount } = render(view("home"));
    fireEvent.click(screen.getByRole("button", { name: "Matikan suara" }));
    expect(screen.getByRole("button", { name: "Nyalakan suara" }).getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY)!)).toEqual({ version: 1, muted: true });
    rerender(view("arena"));
    expect(screen.getByRole("button", { name: "Nyalakan suara" })).toBeTruthy();
    unmount();
    render(view("home"));
    fireEvent.click(screen.getByRole("button", { name: "Nyalakan suara" }));
    expect(screen.getByRole("button", { name: "Matikan suara" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps mute in memory when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { rerender } = render(
      <SoundProvider>
        <SoundButton />
        <p>Home</p>
      </SoundProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Matikan suara" }));
    rerender(
      <SoundProvider>
        <SoundButton />
        <p>Arena</p>
      </SoundProvider>
    );
    expect(screen.getByRole("button", { name: "Nyalakan suara" })).toBeTruthy();
  });

  it("activates on interactions, skips disabled controls and suspends on hidden tabs", async () => {
    const unlock = vi.spyOn(GameAudio.prototype, "unlock").mockResolvedValue(true);
    const play = vi.spyOn(GameAudio.prototype, "playCues");
    const visible = vi.spyOn(GameAudio.prototype, "setVisible");
    const dispose = vi.spyOn(GameAudio.prototype, "dispose");
    const { unmount } = render(
      <SoundProvider>
        <SoundButton />
        <button>Mulai</button>
        <button disabled>Terkunci</button>
      </SoundProvider>
    );
    expect(unlock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mulai" }));
    });
    expect(play).toHaveBeenCalledWith(["click"]);
    play.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Terkunci" }));
    });
    expect(play).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
    expect(unlock).toHaveBeenCalled();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(visible).toHaveBeenLastCalledWith(false);
    unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("synchronizes mute changes from another tab", () => {
    render(
      <SoundProvider>
        <SoundButton />
      </SoundProvider>
    );
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ version: 1, muted: true }));
    fireEvent(window, new StorageEvent("storage", { key: AUDIO_STORAGE_KEY }));
    expect(screen.getByRole("button", { name: "Nyalakan suara" })).toBeTruthy();
  });
});
