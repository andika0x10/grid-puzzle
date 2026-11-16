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
import { PARTICIPANTS_STORAGE_KEY, saveParticipants } from "../game/participants";
import { getLevel, levels } from "../game/provider";
import { themeIds, characterPortrait } from "../game/themes";
vi.mock("../components/BoardCanvas", () => ({
  default: ({ onReady }: { onReady: (v: boolean) => void }) => {
    useEffect(() => onReady(boardReady), [onReady]);
    return <div data-testid="board">Arena</div>;
  },
}));
let ports: LocalWorker[] = [];
let boardReady = true;
beforeEach(() => {
  localStorage.clear();
  ports = [];
  boardReady = true;
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function finishMatch() {
  const port = ports[ports.length - 1];
  act(() => {
    while (port.engine!.snapshot().phase !== "finished") port.postMessage({ kind: "advance", ticks: 8 });
  });
}
async function saveRoster() {
  fireEvent.click(await screen.findByRole("button", { name: "Save" }));
}
function unlockLevels() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 4, levels: Object.fromEntries(levels.map((level) => [level.id, { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 }])) })
  );
}
describe("penjelajah arena interface", () => {
  it("uses a human portrait for each world on the level selection screen", () => {
    const { container } = render(<Home />);
    for (const theme of themeIds) expect(container.querySelectorAll(`.world-character[src="${characterPortrait(theme)}"]`)).toHaveLength(7);
    expect(container.querySelector('img[src*="robot"]')).toBeNull();
  });
  it("shows seven categories and seven themes, with progression", async () => {
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 1 Tiga arah/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Perebutan gem" })).toBeTruthy();
    expect(screen.getAllByText("Luar angkasa")).toHaveLength(7);
    expect(screen.queryByRole("link", { name: /Gerbang gurun/ })).toBeNull();
  });
  it("opens the roster automatically and saves without starting a worker", async () => {
    render(<Game levelId="navigation-1" />);
    const dialog = await screen.findByRole("dialog", { name: "Pilih peserta" });
    expect(screen.getAllByRole("heading", { name: "Bidirectional BFS" })).toHaveLength(1);
    expect(ports).toHaveLength(0);
    expect(screen.getAllByText("Terobos satu cabang. Bisa menang besar kalau jalurnya tepat.")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Bidirectional BFS" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lawan Depth-First Search" }));
    expect(within(dialog).queryByRole("button", { name: "Mulai pertandingan" })).toBeNull();
    await saveRoster();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ports).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Mulai pertandingan" }));
    expect(ports[0].engine?.config.player).toBe("bidirectional");
    expect(ports[0].engine?.config.opponents).toHaveLength(3);
  });
  it("restores all participants on each level visit and after remounting, using the current level seed", async () => {
    unlockLevels();
    const { rerender, unmount } = render(<Game levelId="navigation-1" />);
    await screen.findByRole("dialog", { name: "Pilih peserta" });
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Depth-First Search" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lawan A*" }));
    await saveRoster();
    const saved = JSON.parse(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)!);
    expect(saved).toEqual({ version: 1, player: "dfs", opponents: ["weighted-astar", "greedy", "astar"] });
    rerender(<Game levelId="navigation-2" />);
    expect(await screen.findByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Gunakan Depth-First Search" }) as HTMLInputElement).checked).toBe(true);
    for (const name of ["Weighted A*", "Greedy Best-First", "A*"]) expect((screen.getByRole("checkbox", { name: `Lawan ${name}` }) as HTMLInputElement).checked).toBe(true);
    await saveRoster();
    rerender(<Game levelId="navigation-2" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mulai pertandingan" }));
    expect(ports[0].engine!.config).toEqual({ player: saved.player, opponents: saved.opponents, seed: getLevel("navigation-2")!.seed });
    rerender(<Game levelId="navigation-1" />);
    expect(await screen.findByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect(ports[0].terminated).toBe(true);
    unmount();
    render(<Game levelId="navigation-1" />);
    expect(await screen.findByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Gunakan Depth-First Search" }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)).toBe(JSON.stringify(saved));
  });
  it.each(["close", "escape", "backdrop"])("discards unsaved changes on %s", async (method) => {
    saveParticipants({ player: "dfs", opponents: ["astar", "greedy"] });
    const saved = localStorage.getItem(PARTICIPANTS_STORAGE_KEY);
    render(<Game levelId="navigation-1" />);
    const dialog = await screen.findByRole("dialog", { name: "Pilih peserta" });
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Greedy Best-First" }));
    if (method === "close") fireEvent.click(within(dialog).getByRole("button", { name: "Tutup dialog" }));
    else if (method === "escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
    else fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)).toBe(saved);
    expect(screen.getByRole("button", { name: "Amati Depth-First Search, karakter saya" })).toBeTruthy();
    expect(ports).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Peserta" }));
    expect((screen.getByRole("radio", { name: "Gunakan Depth-First Search" }) as HTMLInputElement).checked).toBe(true);
  });
  it("adjusts incompatible saved participants without overwriting them before Save", async () => {
    unlockLevels();
    saveParticipants({ player: "bidirectional", opponents: ["astar", "greedy", "dfs"] });
    const saved = localStorage.getItem(PARTICIPANTS_STORAGE_KEY);
    render(<Game levelId="navigation-3" />);
    const dialog = await screen.findByRole("dialog", { name: "Pilih peserta" });
    expect(within(dialog).getByText(/Pilihan tersimpan disesuaikan/)).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Gunakan Bidirectional BFS" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Gunakan A*" }) as HTMLInputElement).checked).toBe(true);
    expect(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)).toBe(saved);
    await saveRoster();
    fireEvent.click(screen.getByRole("button", { name: "Mulai pertandingan" }));
    expect(ports[0].engine!.config).toEqual({ player: "astar", opponents: ["greedy", "dfs", "weighted-astar"], seed: getLevel("navigation-3")!.seed });
    expect(JSON.parse(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)!).player).toBe("astar");
  });
  it("can save while the board is still loading", async () => {
    boardReady = false;
    render(<Game levelId="navigation-1" />);
    await saveRoster();
    expect(localStorage.getItem(PARTICIPANTS_STORAGE_KEY)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Mulai pertandingan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(ports).toHaveLength(0);
  });
  it("keeps failed saves in memory across levels and reports the storage failure", async () => {
    unlockLevels();
    const storage = window.localStorage;
    const blockedStorage = {
      getItem: (key: string) => storage.getItem(key),
      setItem: () => {
        throw new Error("Storage blocked");
      },
    };
    vi.spyOn(window, "localStorage", "get").mockReturnValue(blockedStorage as unknown as Storage);
    const { rerender } = render(<Game levelId="navigation-1" />);
    await screen.findByRole("dialog", { name: "Pilih peserta" });
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Depth-First Search" }));
    await saveRoster();
    expect(screen.getByRole("alert").textContent).toContain("Pilihan peserta belum tersimpan di browser");
    rerender(<Game levelId="navigation-2" />);
    expect(await screen.findByRole("dialog", { name: "Pilih peserta" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: "Gunakan Depth-First Search" }) as HTMLInputElement).checked).toBe(true);
  });
  it("returns to ready after saving during a match and leaves a cancelled match paused", async () => {
    render(<Game levelId="navigation-1" />);
    await saveRoster();
    fireEvent.click(screen.getByRole("button", { name: "Mulai pertandingan" }));
    fireEvent.click(screen.getByRole("button", { name: "Peserta" }));
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Depth-First Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Tutup dialog" }));
    expect(screen.getByRole("button", { name: "Lanjutkan pertandingan" })).toBeTruthy();
    expect(ports[0].terminated).toBe(false);
    expect(ports[0].engine!.config.player).toBe("astar");
    fireEvent.click(screen.getByRole("button", { name: "Peserta" }));
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Depth-First Search" }));
    await saveRoster();
    expect(ports[0].terminated).toBe(true);
    expect(ports).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    const play = screen.getByRole("button", { name: "Mulai pertandingan" });
    await waitFor(() => expect(document.activeElement).toBe(play));
    fireEvent.click(play);
    expect(ports[1].engine!.config.player).toBe("dfs");
    expect(ports[1].engine!.snapshot().tick).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("starts on Play, pauses, steps, and reinitializes on restart", async () => {
    render(<Game levelId="navigation-1" />);
    await saveRoster();
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
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ports).toHaveLength(0);
  });
  it("announces the winning opponent immediately and reopens only on request", async () => {
    render(<Game levelId="navigation-1" />);
    await saveRoster();
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
    await screen.findByRole("dialog", { name: "Pilih peserta" });
    fireEvent.click(screen.getByRole("radio", { name: "Gunakan Greedy Best-First" }));
    await saveRoster();
    fireEvent.click(screen.getByRole("button", { name: "Mulai pertandingan" }));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 4, levels: { "navigation-1": { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 } } }));
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 2 Gerbang gurun/ })).toBeTruthy();
  });
});
