import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { assertParticipantLayout } from "./participant-layout.mjs";

const root = process.argv[2] ?? "http://127.0.0.1:5173",
  output = "artifacts/participant-review";
const catalog = JSON.parse(await fs.readFile("content/catalog.json", "utf8"));
const progress = { version: 4, levels: Object.fromEntries(catalog.levels.map((l) => [l.id, { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 }])) };
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const errors = [],
  checks = [];
await fs.mkdir(output, { recursive: true });
const modes = ["navigation-1", "gems-1", "cargo-7", "territory-1", "survival-1", "keys-1", "outposts-1"];
const sizes = [
  [320, 568],
  [390, 844],
  [620, 800],
  [900, 700],
  [1440, 900],
  [844, 390],
];
async function check(page, name, stress = false) {
  const entries = await assertParticipantLayout(page, name);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: page overflows`);
  const board = await page.locator(".board-wrap").boundingBox(),
    dock = await page.locator(".match-dock").boundingBox();
  assert.ok(board.height >= 100 && board.y + board.height <= dock.y + 1, `${name}: board hidden by participant strip`);
  checks.push({ name, stress, participants: entries.length });
  if (!stress) await page.locator(".participant-strip").screenshot({ path: `${output}/${name}.png` });
}
async function run(page, id, label, count = 4) {
  await page.goto(`${root}/play/${id}`, { waitUntil: "networkidle" });
  await page.locator("canvas").waitFor();
  await page.getByText("Menyiapkan arena…", { exact: true }).waitFor({ state: "hidden" });
  const roster = page.getByRole("dialog", { name: "Pilih peserta" });
  await roster.waitFor();
  for (const checkbox of await roster.getByRole("checkbox").all()) if (await checkbox.isChecked()) await checkbox.uncheck();
  for (const name of ["Weighted A*", "A*", "Random Walk"].slice(0, count - 1)) await roster.getByRole("checkbox", { name: `Lawan ${name}`, exact: true }).check();
  await roster.getByRole("button", { name: "Save", exact: true }).click();
  await check(page, `${label}-ready`);
  await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("4");
  await page.getByRole("button", { name: "Mulai pertandingan", exact: true }).click();
  await page.waitForFunction(() => parseFloat(document.querySelector(".arena-meta b").textContent) >= 0.2);
  await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).click();
  await check(page, `${label}-live`);
  // Explicit synthetic stress values exercise text wrapping; these frames are
  // separate from screenshots of actual gameplay above.
  await page.locator(".participant-value").evaluateAll((values, id) => {
    const value = id.startsWith("cargo")
      ? "999 barang"
      : id.startsWith("survival")
        ? "60.00 dtk bertahan"
        : id.startsWith("navigation") || id.startsWith("keys")
          ? "Belum finis"
          : "999 poin";
    for (const el of values) el.textContent = value;
  }, id);
  await check(page, `${label}-stress`, true);
}
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.addInitScript(
      ({ progress }) => {
        localStorage.setItem("grid-puzzle.progress.v4", JSON.stringify(progress));
        localStorage.setItem("grid-puzzle.participants.v1", JSON.stringify({ version: 1, player: "greedy", opponents: ["weighted-astar", "astar", "random"] }));
      },
      { progress }
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    for (const id of modes) await run(page, id, `${id}-${width}`);
    for (const count of [2, 3]) await run(page, "cargo-7", `cargo-${count}-participants-${width}`, count);
    // Dijkstra is the widest catalog abbreviation; use actual roster controls.
    await page.goto(`${root}/play/cargo-7`, { waitUntil: "networkidle" });
    const roster = page.getByRole("dialog", { name: "Pilih peserta" });
    await roster.waitFor();
    for (const checkbox of await roster.getByRole("checkbox").all()) if (await checkbox.isChecked()) await checkbox.uncheck();
    await roster.getByRole("radio", { name: "Gunakan Dijkstra", exact: true }).check();
    for (const name of ["D* Lite", "Monte Carlo Tree Search", "Breadth-First Search"]) await roster.getByRole("checkbox", { name: `Lawan ${name}`, exact: true }).check();
    await roster.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Menyiapkan arena…", { exact: true }).waitFor({ state: "hidden" });
    await check(page, `long-names-${width}`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${checks.length} participant layout checks: 7 modes, 6 viewports, 2–4 bots, cargo inventory, long names and stress values.`);
} finally {
  await fs.writeFile(`${output}/findings.json`, JSON.stringify({ errors, checks }, null, 2));
  await browser.close();
}
