import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
const root = process.argv[2] ?? "http://127.0.0.1:5173",
  output = "artifacts/arena-review";
await fs.mkdir(output, { recursive: true });
const catalog = JSON.parse(await fs.readFile("content/catalog.json", "utf8"));
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const errors = [],
  checks = [],
  replayRequests = [];
function observe(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/demo\/traces\//.test(r.url())) replayRequests.push(r.url());
  });
}
async function ready(page) {
  await page.locator("canvas").waitFor();
  await page.getByText("Menyiapkan arena…", { exact: true }).waitFor({ state: "hidden" });
}
async function layout(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    board: document.querySelector(".board-wrap")?.getBoundingClientRect().toJSON(),
    dock: document.querySelector(".match-dock")?.getBoundingClientRect().toJSON(),
    header: document.querySelector(".match-header")?.getBoundingClientRect().toJSON(),
    dialog: document.querySelector("dialog[open]")?.getBoundingClientRect().toJSON(),
  }));
  assert.ok(data.documentWidth <= data.width, `${name}: horizontal overflow`);
  if (data.dialog) {
    assert.ok(data.dialog.top >= 0 && data.dialog.bottom <= data.height, `${name}: dialog outside viewport`);
    assert.ok(data.dialog.left >= 0 && data.dialog.right <= data.width, `${name}: dialog wider than viewport`);
    assert.ok(await page.locator("dialog[open]").evaluate((el) => el.scrollWidth <= el.clientWidth), `${name}: dialog horizontal overflow`);
  }
  if (data.board && !data.dialog) {
    assert.ok(data.board.top >= data.header.bottom - 1, `${name}: board above viewport`);
    assert.ok(data.board.bottom <= data.dock.top + 1, `${name}: board obscured by controls`);
    assert.ok(data.board.height >= 100, `${name}: board too short`);
    const { data: pixels, info } = await sharp(await page.locator(".board-wrap").screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let colored = 0;
    for (let i = 0; i < pixels.length; i += info.channels)
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 25) colored++;
    assert.ok(colored / (info.width * info.height) > 0.03, `${name}: blank WebGL board`);
  }
  checks.push({ name, ...data });
  await page.screenshot({ path: `${output}/${name}.png` });
}
const complete = { version: 3, levels: Object.fromEntries(catalog.levels.map((l) => [l.id, { completed: true, matches: 1, wins: 0, bestTicks: null, bestGems: 0 }])) };
async function resultPopup(page) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("list", { name: "Hasil peserta" }) });
  await dialog.waitFor({ timeout: 25000 });
  const rows = await dialog.locator(".result-standings").evaluate((el) => ({
    height: el.clientHeight,
    firstTwo: [...el.children].slice(0, 2).reduce((sum, row) => sum + row.getBoundingClientRect().height, 0),
  }));
  assert.ok(rows.height >= rows.firstTwo - 1, "Popup must leave room for at least two complete results");
  assert.equal(
    await dialog
      .getByRole("list", { name: "Hasil peserta" })
      .getByText(/^Bot kamu(?: · Pemenang)?$/)
      .count(),
    1,
    "Player identity missing from results"
  );
  await dialog.getByRole("link", { name: /Level berikutnya|Kembali ke daftar level/ }).waitFor();
  return dialog;
}
try {
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [390, 844],
    [412, 915],
    [844, 390],
    [768, 1024],
    [1440, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    const page = await context.newPage();
    observe(page);
    let workers = 0;
    page.on("worker", (worker) => {
      if (worker.url().includes("simulation.worker")) workers++;
    });
    await page.goto(root, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Level 1 Langkah pertama/ }).waitFor();
    await layout(page, `home-${width}`);
    await page.getByRole("link", { name: /Level 1 Langkah pertama/ }).click();
    await ready(page);
    assert.equal(workers, 0, "Worker started before Play");
    await layout(page, `ready-${width}`);
    {
      await page.getByRole("button", { name: "Peserta", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Pilih peserta" });
      assert.equal(await dialog.locator(".algorithm-entry").count(), 5);
      await dialog.getByRole("radio", { name: "Gunakan Bidirectional BFS" }).check();
      await dialog.getByRole("checkbox", { name: "Lawan Depth-First Search" }).check();
      await dialog.getByRole("button", { name: "Mulai pertandingan", exact: true }).click();
    }
    await page.waitForFunction(() => parseFloat(document.querySelector(".arena-meta b").textContent) >= 0.3);
    await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).click();
    assert.equal(workers, 1);
    await layout(page, `live-${width}`);
    const paused = await page.locator(".arena-meta b").textContent();
    await page.waitForTimeout(180);
    assert.equal(await page.locator(".arena-meta b").textContent(), paused, "Pause advanced the display");
    const tick = await page.locator(".board-wrap .sr-only").textContent();
    await page.getByRole("button", { name: "Langkah berikutnya" }).click();
    await page.waitForFunction((before) => document.querySelector(".board-wrap .sr-only").textContent !== before, tick);
    await page.getByRole("button", { name: "Mulai ulang pertandingan", exact: true }).click();
    await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).waitFor();
    assert.equal(workers, 2);
    await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).click();
    await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("4");
    await page.getByRole("button", { name: "Lanjutkan pertandingan", exact: true }).click();
    const dialog = await resultPopup(page);
    await layout(page, `result-${width}`);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Lihat hasil" }).click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Ganti algoritma" }).click();
    assert.ok(await page.getByRole("radio", { name: "Gunakan Bidirectional BFS" }).isChecked());
    await page.keyboard.press("Escape");
    await page.evaluate((p) => localStorage.setItem("grid-puzzle.progress.v3", JSON.stringify(p)), complete);
    if ([390, 1440].includes(width)) {
      for (const level of catalog.levels) {
        await page.goto(`${root}/play/${level.id}`, { waitUntil: "networkidle" });
        await ready(page);
        await layout(page, `${level.id}-${width}`);
        await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("4");
        await page.getByRole("button", { name: "Mulai pertandingan", exact: true }).click();
        await resultPopup(page);
        await layout(page, `result-${level.id}-${width}`);
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, [], "Runtime browser errors");
  assert.deepEqual(replayRequests, [], "Static replay requested");
  console.log(`Chromium passed: ${checks.length} layouts, 7 viewports, all 14 live levels, 7 themes, four explorers, Pause/step/restart, and no static replays.`);
} finally {
  await fs.writeFile(`${output}/findings.json`, JSON.stringify({ errors, replayRequests, checks }, null, 2));
  await browser.close();
}
