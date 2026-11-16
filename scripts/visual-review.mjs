// Real Chromium/WebGL review. Start the app, then: npm run test:visual -- http://127.0.0.1:5173
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const root = process.argv[2] ?? "http://127.0.0.1:5173";
const output = "artifacts/layout-revision";
await fs.mkdir(output, { recursive: true });
const catalog = JSON.parse(await fs.readFile("content/catalog.json", "utf8"));
const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const errors = [],
  findings = [];
const capture = (page, name) => page.screenshot({ path: `${output}/${name}.png` });

async function waitForBoard(page) {
  await page.locator("canvas").waitFor();
  await page.getByText("Menyiapkan medan…", { exact: true }).waitFor({ state: "hidden" });
}
async function checkLayout(page, width, screen) {
  const result = await page.evaluate(() => {
    const main = document.querySelector("main").getBoundingClientRect();
    const dock = document.querySelector(".lesson-dock")?.getBoundingClientRect();
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      main: main.toJSON(),
      dock: dock?.toJSON(),
    };
  });
  assert.ok(result.documentWidth <= width, `${screen}/${width}: page overflows horizontally`);
  assert.ok(Math.abs(result.main.x - (width - result.main.width) / 2) < 2, `${screen}/${width}: content is not centered`);
  if (result.dock) assert.ok(result.main.bottom <= result.dock.top + 1, `${screen}/${width}: playback overlaps the content`);
  findings.push({ width, screen, ...result });
}
async function checkChoices(page) {
  const choices = page.locator(".choice");
  assert.equal(await choices.count(), 5);
  for (const choice of await choices.all()) {
    await choice.scrollIntoViewIfNeeded();
    const box = await choice.boundingBox();
    const dock = await page.locator(".lesson-dock").boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= dock.y + 1, "Answer cannot be scrolled clear of the playback controls");
  }
}
async function finish(page, id, screenshots) {
  const level = catalog.levels.find((l) => l.id === id);
  let option;
  for (const candidate of level.options) {
    const trace = JSON.parse(await fs.readFile(`public${level.traceRefs[candidate.id]}`, "utf8"));
    if (trace.result.passed) {
      option = candidate;
      break;
    }
  }
  const index = level.options.findIndex((o) => o.id === option.id);
  await page.locator(".choice").nth(index).click();
  const dialog = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize();
  assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= viewport.width, "Confirmation is clipped");
  if (screenshots) await capture(page, `confirm-${screenshots}`);
  await page.getByRole("button", { name: "Jalankan", exact: true }).click();
  await page.getByRole("button", { name: "Jeda simulasi" }).click();
  await page.getByRole("slider", { name: "Langkah simulasi" }).press("End");
  await page.getByRole("link", { name: "Level berikutnya", exact: true }).waitFor();
  if (screenshots) {
    await page.locator(".dock-result").waitFor();
    await page.locator(".game").evaluate((el) => {
      el.scrollTop = 0;
    });
    await capture(page, `result-${screenshots}`);
  }
}

try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    page.on("pageerror", (e) => errors.push({ width, message: e.message }));
    await page.goto(root, { waitUntil: "networkidle" });
    await page.getByRole("link", { name: /Level 01 Kenali medan/ }).waitFor();
    await checkLayout(page, width, "home");
    await capture(page, `home-${width}`);
    await page.getByRole("link", { name: /Level 01 Kenali medan/ }).click();
    await waitForBoard(page);
    await checkLayout(page, width, "game");
    await capture(page, `game-${width}`);
    await checkChoices(page);
    await page.locator(".choices-heading").scrollIntoViewIfNeeded();
    await capture(page, `choices-${width}`);
    if ([1440, 390, 320].includes(width)) {
      await finish(page, "navigation-1", String(width));
      await checkLayout(page, width, "result");
      await page.goto(root, { waitUntil: "networkidle" });
      await page.getByRole("link", { name: /Level 02 Jalan buntu/ }).waitFor();
      await capture(page, `progress-${width}`);
      for (const id of catalog.sections[0].levelIds.slice(1)) {
        await page.goto(`${root}/play/${id}`, { waitUntil: "networkidle" });
        await waitForBoard(page);
        await finish(page, id);
      }
      await page.getByRole("link", { name: "Level berikutnya", exact: true }).click();
      await waitForBoard(page);
      await checkLayout(page, width, "desert");
      await capture(page, `desert-${width}`);
      await finish(page, "clustering-1", `desert-${width}`);
      await page.locator(".game").evaluate((el) => {
        el.scrollTop = 0;
      });
      await capture(page, `desert-groups-${width}`);
    }
    await page.close();
  }
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(`Chromium review passed: ${findings.length} layout checks, 5 viewport sizes, both biomes, confirmation, replay, saved progress, and section unlock.`);
} finally {
  await fs.writeFile(`${output}/findings.json`, JSON.stringify({ errors, findings }, null, 2));
  await browser.close();
}
