import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { assertParticipantLayout } from "./participant-layout.mjs";
const root = process.argv[2] ?? "http://127.0.0.1:5173",
  output = "artifacts/arena-review";
const filter = process.argv.find((a) => a.startsWith("--level="))?.split("=")[1],
  viewport = Number(process.argv.find((a) => a.startsWith("--viewport="))?.split("=")[1]);
const catalog = JSON.parse(await fs.readFile("content/catalog.json", "utf8"));
const progress = { version: 5, levels: Object.fromEntries(catalog.levels.map((l) => [l.id, { completed: true, matches: 1, wins: 0, bestMetric: null, rulesVersion: 4 }])) };
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] }),
  errors = [],
  checks = [];
async function layout(page, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: horizontal overflow`);
  await assertParticipantLayout(page, name);
  const board = await page.locator(".board-wrap").boundingBox(),
    stage = await page.locator(".arena-stage").boundingBox(),
    dock = await page.locator(".match-dock").boundingBox();
  assert.ok(board && board.height >= 100, `${name}: board hidden`);
  const ratio = await page.locator(".board-wrap").evaluate((board) => Number(getComputedStyle(board).getPropertyValue("--board-ratio"))),
    maxHeight = Math.min(480, page.viewportSize().height * 0.6);
  assert.ok(board.height <= maxHeight + 1, `${name}: board exceeds maximum viewing height`);
  assert.ok(Math.abs(board.width / board.height - ratio) < 0.01, `${name}: board aspect ratio changed`);
  assert.ok(stage && Math.abs(board.x + board.width / 2 - (stage.x + stage.width / 2)) <= 1, `${name}: board is not centered`);
  const container = await page.locator(".match-main").evaluate((main) => ({
    width: main.getBoundingClientRect().width,
    contentWidth: main.clientWidth,
    limit: matchMedia("(max-height: 500px) and (orientation: landscape)").matches ? 1100 : 900,
  }));
  assert.ok(container.width <= container.limit + 1, `${name}: game exceeds container width limit`);
  const expectedWidth = Math.min(container.contentWidth, maxHeight * ratio);
  assert.ok(Math.abs(board.width - expectedWidth) <= 1, `${name}: board does not fit height and container limits`);
  assert.ok(dock && dock.y >= 0 && dock.y + dock.height <= page.viewportSize().height + 1, `${name}: controls hidden`);
  await page.locator(".match-main").evaluate((main) => {
    main.scrollTop = main.scrollHeight;
  });
  const scrolledBoard = await page.locator(".board-wrap").boundingBox();
  assert.ok(scrolledBoard.y + scrolledBoard.height <= dock.y + 1, `${name}: board bottom cannot be reached`);
  await page.locator(".match-main").evaluate((main) => {
    main.scrollTop = 0;
  });
  const buffer = await page.locator(".board-wrap").screenshot();
  const stats = await sharp(buffer).stats();
  assert.ok(
    stats.channels.some((c) => c.stdev > 8),
    `${name}: blank board`
  );
  await fs.writeFile(`${output}/${name}.png`, buffer);
  checks.push(name);
}
try {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1440, 900],
  ].filter(([w]) => !viewport || w === viewport)) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.addInitScript((p) => {
      localStorage.setItem("grid-puzzle.progress.v5", JSON.stringify(p));
      localStorage.setItem("grid-puzzle.participants.v1", JSON.stringify({ version: 1, player: "dijkstra", opponents: ["dstar-lite", "mcts", "random"] }));
    }, progress);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const selected = catalog.levels.filter((l) => (!filter || l.id === filter) && ([390, 1440].includes(width) || l.order === 1));
    for (const level of selected) {
      await page.goto(`${root}/play/${level.id}`, { waitUntil: "networkidle" });
      await page.locator("canvas").waitFor();
      await page.getByText("Menyiapkan arena…", { exact: true }).waitFor({ state: "hidden" });
      const roster = page.getByRole("dialog", { name: "Pilih peserta" });
      await roster.waitFor();
      assert.equal(await roster.locator(".algorithm-entry").count(), 10);
      await roster.getByRole("button", { name: "Save", exact: true }).click();
      await layout(page, `${level.id}-${width}`);
      if (level.order === 1) {
        await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("1");
        await page.getByRole("button", { name: "Mulai pertandingan", exact: true }).click();
        await page.waitForFunction(() => parseFloat(document.querySelector(".arena-meta b").textContent) >= 0.3);
        await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).click();
        await layout(page, `live-${level.id}-${width}`);
        const tick = await page.locator(".board-wrap .sr-only").textContent();
        await page.waitForTimeout(150);
        assert.equal(await page.locator(".board-wrap .sr-only").textContent(), tick);
        await page.getByRole("button", { name: "Langkah berikutnya", exact: true }).click();
        await page.waitForFunction((before) => document.querySelector(".board-wrap .sr-only").textContent !== before, tick);
        await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("4");
        await page.getByRole("button", { name: "Lanjutkan pertandingan", exact: true }).click();
        const dialog = page.getByRole("dialog").filter({ has: page.getByRole("list", { name: "Hasil peserta" }) });
        await dialog.waitFor({ timeout: 35000 });
        await dialog.getByRole("link", { name: /Level berikutnya|Kembali ke daftar level/ }).waitFor();
        await page.screenshot({ path: `${output}/result-${level.id}-${width}.png` });
        await page.keyboard.press("Escape");
        await page.getByRole("combobox", { name: "Kecepatan simulasi" }).selectOption("1");
        await page.getByRole("button", { name: "Mulai ulang pertandingan", exact: true }).first().click();
        await page.getByRole("button", { name: "Jeda pertandingan", exact: true }).click();
        checks.push(`worker-pause-step-restart-${level.id}-${width}`);
      }
    }
    console.log(`Reviewed ${selected.length} boards at ${width}x${height}`);
    await context.close();
  }
  assert.deepEqual(errors, [], "Runtime browser errors");
  console.log(`Passed ${checks.length} board and worker checks across seven new modes.`);
} finally {
  await fs.writeFile(`${output}/findings.json`, JSON.stringify({ errors, checks }, null, 2));
  await browser.close();
}
