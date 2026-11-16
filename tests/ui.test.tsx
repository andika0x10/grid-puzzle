// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import Home from "../components/Home";
import Game from "../components/Game";
import { LocalWorker } from "./fixtures";
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
  it("reads migrated progress and unlocks the next navigation level", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, levels: { "navigation-1": { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 } } }));
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 2 Belokan gurun/ })).toBeTruthy();
  });
});
