/*
 * Animation performance harness (Playwright + Chromium DevTools protocol).
 *
 *   NODE_PATH=<dir with playwright> node tools/perf.cjs <url> <label> [cpuRate]
 *
 * Runs the same scenarios against any build so before/after numbers are comparable.
 * Expects the page to expose canvases #helix (page background) and #plate (About section, SVG specimen plate).
 * Output: JSON to stdout. Frame times come from a harness-owned rAF probe; main-thread
 * cost comes from CDP Performance.getMetrics; long tasks from PerformanceObserver.
 */
const { chromium } = require("playwright");

const url = process.argv[2];
const label = process.argv[3] || "run";
const cpu = parseFloat(process.argv[4] || "1");

const INIT = `
(() => {
  window.__rafCalls = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { if (!window.__probing) window.__rafCalls++; return raf(cb); };
  window.__long = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(e.duration); })
        .observe({ entryTypes: ["longtask"] }); } catch (e) {}
  window.__probe = (ms) => new Promise(res => {
    const d = []; let last = 0; const t0 = performance.now();
    window.__rafCalls = 0; window.__long = [];
    function tick(t) {
      if (last) d.push(t - last);
      last = t;
      if (performance.now() - t0 < ms) raf(tick); else res({ d, rafCalls: window.__rafCalls, long: window.__long.slice() });
    }
    raf(tick);
  });
})();
`;

function stats(d) {
  if (!d.length) return null;
  const s = [...d].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const sum = d.reduce((a, b) => a + b, 0);
  return {
    frames: d.length,
    meanMs: +(sum / d.length).toFixed(2),
    p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2),
    maxMs: +s[s.length - 1].toFixed(1),
    over20ms: d.filter((x) => x > 20).length,           // dropped at 60Hz (> 1.2 frames)
    over33ms: d.filter((x) => x > 33.4).length,         // at least one full frame lost
    over50ms: d.filter((x) => x > 50).length,           // visible stall
  };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

  // Block remote fonts/images so network timing never pollutes frame data.
  await page.route(/fonts\.(googleapis|gstatic)\.com|images\.unsplash\.com/, (r) => r.abort());
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const out = { label, url, cpuThrottle: cpu, scenarios: {} };
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

  async function scenario(name, ms, action) {
    const m0 = await metric();
    const run = page.evaluate((t) => window.__probe(t), ms);
    if (action) await action();
    const r = await run;
    const m1 = await metric();
    const wall = (m1.Timestamp - m0.Timestamp);
    out.scenarios[name] = {
      ...stats(r.d),
      rafCallsPerSec: +(r.rafCalls / (ms / 1000)).toFixed(1),
      longTasks: r.long.length,
      longTaskTotalMs: +r.long.reduce((a, b) => a + b, 0).toFixed(0),
      mainThreadBusyPct: +(((m1.TaskDuration - m0.TaskDuration) / wall) * 100).toFixed(1),
      scriptPct: +(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100).toFixed(1),
    };
  }
  const scrollToEl = (sel, off = 0) => page.evaluate(([s, o]) => {
    const el = document.querySelector(s); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - o, behavior: "instant" });
  }, [sel, off]);

  // 1. page-background strand with hero in view
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(600);
  await scenario("hero_idle_6s", 6000);

  // 2. specimen plate centred in view
  await scrollToEl("#plate", 120);
  await page.waitForTimeout(800);
  await scenario("plate_idle_10s", 10000);

  // 3. full-page scroll top -> bottom -> top, 4s each way, stepped wheel input
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(500);
  const scrollRun = (dir) => async () => {
    const H = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const y = dir > 0 ? (H * i) / steps : H - (H * i) / steps;
      await page.evaluate((v) => scrollTo({ top: v, behavior: "instant" }), y);
      await page.waitForTimeout(33);
    }
  };
  await scenario("scroll_down_full_page", 4500, scrollRun(1));
  await scenario("scroll_up_full_page", 4500, scrollRun(-1));

  // 4. repeated entry/exit of the plate section (observer churn)
  await scenario("repeat_section_entry_x8", 6000, async () => {
    for (let i = 0; i < 8; i++) {
      await scrollToEl("#plate", 120); await page.waitForTimeout(300);
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" })); await page.waitForTimeout(300);
    }
  });

  // 5. tab hide/show (emulated visibility) while the plate section is on screen
  await scrollToEl("#plate", 120);
  await page.waitForTimeout(500);
  const hide = (h) => page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, h);
  await hide(true);
  await scenario("tab_hidden_3s_rafCallsShouldBeZero", 3000);
  await hide(false);
  await scenario("tab_shown_again_4s", 4000);
  // hide/show 6 times quickly then check loops did not multiply
  for (let i = 0; i < 6; i++) { await hide(true); await page.waitForTimeout(120); await hide(false); await page.waitForTimeout(120); }
  await scenario("after_6_hide_show_cycles_4s", 4000);

  // 6. offscreen: scroll to a section with neither canvas visible (footer)
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.waitForTimeout(500);
  await scenario("footer_both_offscreen_3s", 3000);

  // 7. resize storm while the specimen plate is visible
  await scrollToEl("#plate", 120);
  await scenario("resize_storm_5s", 5000, async () => {
    const sizes = [[1440, 900], [1100, 800], [820, 1100], [600, 900], [390, 844], [820, 1100], [1440, 900]];
    for (const [w, h] of sizes) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); }
  });

  // 8. orientation to phone size, plate idle
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await scrollToEl("#plate", 80);
  await page.waitForTimeout(600);
  await scenario("phone_390_plate_idle_6s", 6000);

  // init cost: reload and read longest tasks during load
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2500);
  out.loadLongTasksMs = await page.evaluate(() => window.__long.map((x) => +x.toFixed(0)));
  out.loadTiming = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { domContentLoadedMs: +n.domContentLoadedEventEnd.toFixed(0), loadMs: +n.loadEventEnd.toFixed(0) };
  });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
