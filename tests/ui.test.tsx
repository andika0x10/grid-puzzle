// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import Home from "../components/Home";
import Game from "../components/Game";
import ResultDialog from "../components/ResultDialog";
import { previewFrame } from "../game/engine";
import { defaultConfig } from "../game/algorithms";
import { fixture, LocalWorker } from "./fixtures";
import { STORAGE_KEY } from "../game/progress";
import { themeIds, characterPortrait } from "../game/themes";
vi.mock("../components/BoardCanvas", () => ({
  default: ({ onReady }: { onReady: (v: boolean) => void }) => {
    useEffect(() => onReady(true), [onReady]);
    return <div data-testid="board">Arena</div>;
  },
}));
let ports: LocalWorker[] = [];
beforeEach(() => {
  localStorage.clear();
  ports = [];
  vi.stubGlobal(
    "Worker",
    class extends LocalWorker {
      constructor() {
        super();
        ports.push(this);
      }
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function finishMatch() {
  const port = ports[ports.length - 1];
  act(() => {
    while (port.engine!.snapshot().phase !== "finished") port.postMessage({ kind: "advance", ticks: 8 });
  });
}
describe("penjelajah arena interface", () => {
  it("uses a human portrait for each world on the level selection screen", () => {
    const { container } = render(<Home />);
    for (const theme of themeIds) expect(container.querySelectorAll(`.world-character[src="${characterPortrait(theme)}"]`)).toHaveLength(2);
    expect(container.querySelector('img[src*="robot"]')).toBeNull();
  });
  it("shows two categories and seven themes, with progression", async () => {
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 1 Langkah pertama/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Perebutan gem" })).toBeTruthy();
    expect(screen.getAllByText("Luar angkasa")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Belokan gurun/ })).toBeNull();
  });
  it("opens full algorithm names and descriptions without starting a worker", async () => {
    render(<Game levelId="navigation-1" />);
    await screen.findByRole("button", { name: "Peserta" });
    fireEvent.click(screen.getByRole("button", { name: "Peserta" }));
    expect(screen.getByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Bidirectional BFS" })).toHaveLength(1);
    expect(ports).toHaveLength(0);
    expect(screen.getAllByText("Terobos satu cabang. Bisa menang besar kalau jalurnya tepat.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Bidirectional BFS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lawan Depth-First Search" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Pilih peserta" })).getByRole("button", { name: "Mulai pertandingan" }));
    expect(ports[0].engine?.config.player).toBe("bidirectional");
    expect(ports[0].engine?.config.opponents).toHaveLength(3);
  });
  it("starts on Play, pauses, steps, and reinitializes on restart", async () => {
    render(<Game levelId="navigation-1" />);
    const play = await screen.findByRole("button", { name: "Mulai pertandingan" });
    await waitFor(() => expect((play as HTMLButtonElement).disabled).toBe(false));
    expect(ports).toHaveLength(0);
    fireEvent.click(play);
    expect(ports).toHaveLength(1);
    expect(ports[0].engine?.snapshot().tick).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Jeda pertandingan" }));
    fireEvent.click(screen.getByRole("button", { name: "Langkah berikutnya" }));
    expect(ports[0].engine?.snapshot().tick).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Mulai ulang pertandingan" }));
    expect(ports[0].terminated).toBe(true);
    expect(ports).toHaveLength(2);
    expect(ports[1].engine?.snapshot().tick).toBe(0);
  });
  it("keeps direct links to future levels locked", async () => {
    render(<Game levelId="gems-1" />);
    expect(await screen.findByRole("heading", { name: "Arena ini belum terbuka." })).toBeTruthy();
    expect(ports).toHaveLength(0);
  });
  it("announces the winning opponent immediately and reopens only on request", async () => {
    render(<Game levelId="navigation-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mulai pertandingan" }));
    finishMatch();
    const dialog = await screen.findByRole("dialog", { name: "Greedy Best-First menang!" });
    expect(within(dialog).getByText("Bot lawan memenangkan pertandingan.")).toBeTruthy();
    expect(within(dialog).getByText("Bot kamu menggunakan A*.")).toBeTruthy();
    expect(within(dialog).getAllByText("Belum finis")).toHaveLength(2);
    expect(await within(dialog).findByRole("link", { name: "Level berikutnya" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tutup dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Langkah sebelumnya" }));
    fireEvent.click(screen.getByRole("button", { name: "Langkah berikutnya" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lihat hasil" }));
    expect(screen.getByRole("dialog", { name: "Greedy Best-First menang!" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).levels["navigation-1"].matches).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Ganti algoritma" }));
    expect(screen.getByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Gunakan A*" }) as HTMLInputElement).checked).toBe(true);
  });
  it("uses the selected player algorithm and preserves it on replay", async () => {
    render(<Game levelId="navigation-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Peserta" }));
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Greedy Best-First" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mulai pertandingan" }));
    const config = ports[0].engine!.config;
    expect(config.player).toBe("greedy");
    finishMatch();
    const dialog = await screen.findByRole("dialog", { name: "Greedy Best-First menang!" });
    expect(within(dialog).getByText("Bot kamu memenangkan pertandingan!")).toBeTruthy();
    await within(dialog).findByRole("link", { name: "Level berikutnya" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Main lagi" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ports[0].terminated).toBe(true);
    expect(ports[1].engine!.config).toEqual(config);
    finishMatch();
    const replayDialog = await screen.findByRole("dialog", { name: "Greedy Best-First menang!" });
    await within(replayDialog).findByRole("link", { name: "Level berikutnya" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).levels["navigation-1"].matches).toBe(2);
    fireEvent.keyDown(window, { code: "Space" });
    expect(ports).toHaveLength(2);
    fireEvent(replayDialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["race", "gems"] as const)("renders ties, no winner and the save gate in %s results", (mode) => {
    const frame = previewFrame(fixture(), defaultConfig(1));
    frame.phase = "finished";
    frame.winners = ["bot-0", "bot-1"];
    const props = { frame, mode, onClose: vi.fn(), onReplay: vi.fn(), onSettings: vi.fn(), nextHref: "/play/navigation-2", saved: false };
    const { rerender } = render(<ResultDialog {...props} />);
    expect(screen.getByRole("dialog", { name: "Hasil seri" })).toBeTruthy();
    expect(screen.getByText(/A\* dan Weighted A\* berbagi kemenangan/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Menyimpan progres…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("link", { name: "Level berikutnya" })).toBeNull();
    rerender(<ResultDialog {...props} frame={{ ...frame, winners: [] }} saved />);
    expect(screen.getByRole("dialog", { name: "Belum ada pemenang" })).toBeTruthy();
    expect(screen.getByText(mode === "race" ? "Tidak ada bot yang mencapai finis." : "Belum ada gem yang berhasil direbut.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Level berikutnya" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tutup dialog" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("reads migrated progress and unlocks the next navigation level", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, levels: { "navigation-1": { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 } } }));
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 2 Belokan gurun/ })).toBeTruthy();
  });
});
