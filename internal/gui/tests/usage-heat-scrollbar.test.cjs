// Run with Node's test runner and Playwright on the module path; see README.md.
// The Requests tab's heatmap card scrolls sideways inside itself on a narrow
// window. Its box set `scrollbar-width: thin` and, in Chromium (so WebView2),
// that drops every ::-webkit-scrollbar rule, so the card drew Windows' classic
// bar, arrows and all, while every other box in magpie showed the app's 10px
// rounded thumb (the trap `.segs.regions` hit, see strip-scrollbar.test.cjs).
// The card's box must therefore name no scrollbar-width at all: the app's own
// ::-webkit-scrollbar rules have to reach it. Chromium only, as the trap is
// its own; the page is faked, no backend.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");

const assets = path.resolve(__dirname, "../assets");

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
today.setHours(0, 0, 0, 0);
const from = new Date(today);
from.setDate(from.getDate() - ((today.getDay() + 6) % 7) - 7 * 52);
const SPAN = Math.round((today - from) / 864e5) + 1;
const DAYS = [];
for (let i = 0; i < SPAN; i++) {
  const d = new Date(from);
  d.setDate(d.getDate() + i);
  const calls = (i % 13) + 1;
  DAYS.push({ date: iso(d), calls, tokens: calls * 1e5, cost: calls * 0.5 });
}
const ROW = { t: new Date().toISOString(), agent: "claude", agentName: "Claude Code", icon: "claudecode-color", provider: "anthropic", providerName: "Claude", model: "claude-sonnet-5", req: "sonnet", in: 2, out: 600, cache_write: 900, cache_read: 390000, ms: 2380, status: 200, cost: 0.087, priced: true };
const share = (id, name) => ({ id, name, icon: "generic", calls: 1, errors: 0, input: 2, output: 600, cache_write: 900, cache_read: 390000, cost: 0.087 });
const PAGE = {
  period: "30d", rows: [ROW], offset: 0, total: 1, calls: 1, errors: 0, input: 2, output: 600, cache_write: 900, cache_read: 390000, reasoning: 0, cost: 0.087, unpriced: 0,
  bucket: "day", series: [], by: { provider: [share("anthropic", "Claude")], agent: [share("claude", "Claude Code")], model: [share("claude-sonnet-5", "claude-sonnet-5")] },
  agents: [{ id: "claude", name: "Claude Code", icon: "claudecode-color" }], providers: [{ id: "anthropic", name: "Claude", icon: "generic" }],
};

function server() {
  return async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"en",theme:"dark",web:false};` });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: { lang: "en", theme: "dark" } });
    if (url.pathname === "/api/usage/requests") return json(PAGE);
    if (url.pathname === "/api/usage/heatmap") return json({ from: iso(from), to: iso(today), days: DAYS });
    if (url.pathname === "/api/usage/quotas") return json([]);
    if (url.pathname === "/api/usage") return json({ calls: 1, errors: 0, input: 1, output: 1, cache_read: 0, cache_write: 0, reasoning: 0, unpriced: 0, cost: 1, bucket: "day", series: [], agents: [], models: [], path: "~/.config/magpie/usage.jsonl" });
    if (url.pathname === "/api/sessions") return json({ sessions: [], dirs: [] });
    if (url.pathname === "/api/groups") return json({ groups: [], models: [] });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    try { await route.fulfill({ body: await fs.readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "" }); }
  };
}

// the bar a box draws: as tall as the app's ::-webkit-scrollbar rule says,
// not as tall as the engine's own classic bar, and drawn in the app's thumb
const barOf = (p, sel) => p.evaluate((sel) => {
  const e = document.querySelector(sel);
  const cs = getComputedStyle(e);
  return {
    scrolls: e.scrollWidth > e.clientWidth + 1,
    height: e.offsetHeight - e.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth),
    thumb: getComputedStyle(e, "::-webkit-scrollbar-thumb").backgroundColor,
    thumbRadius: getComputedStyle(e, "::-webkit-scrollbar-thumb").borderRadius,
    button: getComputedStyle(e, "::-webkit-scrollbar-button").display,
    scrollbarWidth: cs.scrollbarWidth,
  };
}, sel);

test("the heatmap card's sideways bar is the app's own thumb, not Windows' classic bar", async (t) => {
  // headless Chromium hides scrollbars unless asked not to
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  t.after(() => browser.close());
  const page = await (await browser.newContext({ viewport: { width: 700, height: 820 }, reducedMotion: "reduce" })).newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", server());
  await page.goto("http://magpie.test/");
  await page.locator('[data-view="usage"]').first().click();
  await page.locator(":is(#usageTab .opt, .nav-s):visible").nth(1).click();
  await page.locator("#ledHeat .heat-grid i").first().waitFor();

  const heat = await barOf(page, "#ledHeatScroll");
  assert(heat.scrolls, "a card narrower than 53 weeks scrolls sideways in itself");
  // the behavior, first: a ::-webkit-scrollbar rule put on the card's box takes
  // effect there, as it does on a page. Naming a scrollbar-width on the box,
  // Chromium drops every such rule and the bar keeps the engine's own height
  // (its classic bar, arrows and all) — which is what the card showed.
  await page.addStyleTag({ content: "#ledHeatScroll::-webkit-scrollbar { height: 14px; }" });
  await page.waitForTimeout(120);
  const probed = await barOf(page, "#ledHeatScroll");
  assert.equal(probed.height, 14, "the app's ::-webkit-scrollbar rules reach the card's bar, as they reach a page's");
  // the cause: no scrollbar-width on the box, unlike the shipped rule
  assert.equal(heat.scrollbarWidth, "auto", "the heatmap's box names no scrollbar-width");
  // the app's bars are the box's: a page's thumb, from the same rule, once the
  // pointer that clicked the tab is off it (a hovered thumb takes --muted)
  await page.mouse.move(0, 0);
  await page.waitForTimeout(80);
  const view = await barOf(page, "#view-usage");
  assert.equal(heat.thumb, view.thumb, `the card's thumb is drawn as a page's: ${heat.thumb} vs ${view.thumb}`);
  assert.equal(heat.height, 10, "the card's bar is the app's 10px one");
  assert.equal(heat.thumbRadius, "10px", "the card's thumb is the app's rounded one");
  assert.equal(heat.button, "none", "the card draws no arrow buttons");
  assert.notEqual(heat.thumb, "rgba(0, 0, 0, 0)", "the card's thumb is drawn in no colour");
  assert.deepEqual(errors, []);
});
