// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import Home from "../components/Home";
import Game from "../components/Game";
import { levels, sections } from "../game/provider";
import { emptyProgress, recordResult, STORAGE_KEY } from "../game/progress";
import type { ReplayTrace } from "../game/schema";
vi.mock("../components/BoardCanvas", () => ({
  default: ({ frame }: { frame: { note: string } }) => <div data-testid="board">{frame.note}</div>,
}));
const fixture = (id: string, option = "bfs"): ReplayTrace => JSON.parse(fs.readFileSync(`public/demo/traces/${id}.${option}.json`, "utf8"));
beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(fs.readFileSync(`public${url}`, "utf8"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("interactive demo experience", () => {
  it("shows both sections and only opens the first available level", async () => {
    render(<Home />);
    expect(await screen.findByRole("link", { name: /Level 01 Kenali medan/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Jalan buntu/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Pengelompokan sumber daya" })).toBeTruthy();
    expect(screen.getAllByText("Belum terbuka").length).toBe(1);
  });
  it("opens help and closes it without changing progress", async () => {
    const user = userEvent.setup();
    render(<Home />);
    await user.click(screen.getByRole("button", { name: /Cara bermain/ }));
    expect(screen.getByRole("dialog", { name: "Ekspedisi pertamamu" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Siap bereksplorasi" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
  it("cancels confirmation before requesting a replay", async () => {
    const user = userEvent.setup();
    render(<Game levelId="navigation-1" />);
    await user.click(await screen.findByRole("button", { name: /A\. Breadth-First Search/ }));
    const dialog = screen.getByRole("dialog", { name: "Jalankan Breadth-First Search?" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("plays, pauses, seeks, persists a result and unlocks the next level", async () => {
    const user = userEvent.setup();
    render(<Game levelId="navigation-1" />);
    await user.click(await screen.findByRole("button", { name: /A\. Breadth-First Search/ }));
    await user.click(screen.getByRole("button", { name: "Jalankan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Jeda simulasi" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Jeda simulasi" }));
    await user.click(screen.getByRole("button", { name: "Langkah berikutnya" }));
    expect(screen.getByRole("slider", { name: "Langkah simulasi" }).getAttribute("aria-valuetext")).toMatch("Langkah 1");
    fireEvent.change(screen.getByRole("slider", { name: "Langkah simulasi" }), {
      target: { value: fixture("navigation-1").steps.length },
    });
    await waitFor(() => expect(screen.getByRole("link", { name: /Level berikutnya/ }).getAttribute("href")).toBe("/play/navigation-2"));
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(raw.levels["navigation-1"].passed).toBe(true);
    expect(raw.levels["navigation-1"].attempts).toBe(1);
    await user.click(screen.getByRole("button", { name: "Putar ulang" }));
    fireEvent.change(screen.getByRole("slider", { name: "Langkah simulasi" }), {
      target: { value: fixture("navigation-1").steps.length },
    });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).levels["navigation-1"].attempts).toBe(1);
  });
  it("shows a locked screen for a direct link to a later section", async () => {
    render(<Game levelId="clustering-1" />);
    expect(await screen.findByRole("heading", { name: "Ekspedisi ini belum terbuka." })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /K-means/ })).toBeNull();
  });
  it("retains failure state and retries the requested option", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("offline", { status: 503 }));
    render(<Game levelId="navigation-1" />);
    await user.click(await screen.findByRole("button", { name: /B\. Depth-First Search/ }));
    await user.click(screen.getByRole("button", { name: "Jalankan" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(screen.getByRole("dialog", { name: "Jalankan Depth-First Search?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Jalankan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Jeda simulasi" })).toBeTruthy());
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("navigation-1.dfs");
  });
  it("enables clustering after completing navigation and shows its own choices", async () => {
    let p = emptyProgress();
    for (const id of sections[0].levelIds) {
      const level = levels.find((l) => l.id === id)!;
      const t = level.options.map((o) => fixture(id, o.id)).find((t) => t.result.passed)!;
      p = recordResult(p, id, t.optionId, t.result);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    const user = userEvent.setup();
    render(<Game levelId="clustering-1" />);
    await user.click(await screen.findByRole("button", { name: /A\. K-means/ }));
    await user.click(screen.getByRole("button", { name: "Jalankan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Jeda simulasi" })).toBeTruthy());
    fireEvent.change(screen.getByRole("slider", { name: "Langkah simulasi" }), {
      target: { value: fixture("clustering-1", "kmeans").steps.length },
    });
    expect(await screen.findByRole("heading", { name: "Sangat efisien" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Level berikutnya/ }).getAttribute("href")).toBe("/play/clustering-2");
  });
});
