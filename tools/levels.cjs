// Frame cost of the molecular field at each fixed quality level (adaptive controller frozen).
//   node tools/levels.cjs <url> <cpuRate>
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.route(/fonts\.|unsplash/, (r) => r.abort());
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: +process.argv[3] || 1 });
  await p.goto(process.argv[2]); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = window.__genominc.scheduler; s._measure = () => {}; document.querySelector("#mol").scrollIntoView({ block: "center" }); });
  for (const level of [0, 1, 2]) {
    await p.evaluate((l) => window.__genominc.scheduler._set(l, performance.now()), level);
    await p.waitForTimeout(1500);
    const m = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const m0 = await m();
    const d = await p.evaluate(() => new Promise((res) => { const a = []; let l = 0; const t0 = performance.now();
      (function f(t) { if (l) a.push(t - l); l = t; performance.now() - t0 < 5000 ? requestAnimationFrame(f) : res(a); })(performance.now()); }));
    const m1 = await m();
    const s = [...d].sort((x, y) => x - y);
    console.log(`level ${level}: canvas ${await p.evaluate(() => { const c = document.querySelector("#mol"); return c.width + "x" + c.height; })}`,
      `mean ${(d.reduce((x, y) => x + y) / d.length).toFixed(1)}ms p95 ${s[Math.floor(s.length * .95)].toFixed(1)} max ${s[s.length - 1].toFixed(0)}`,
      `busy ${(((m1.TaskDuration - m0.TaskDuration) / (m1.Timestamp - m0.Timestamp)) * 100).toFixed(0)}% script ${(((m1.ScriptDuration - m0.ScriptDuration) / (m1.Timestamp - m0.Timestamp)) * 100).toFixed(1)}%`);
  }
  await b.close();
})();
