// node tools/shots.cjs <baseUrl> <outDir>   — full-page + hero screenshots at desktop/tablet/phone, plus console errors.
const { chromium } = require("playwright");
const fs = require("fs");
const base = process.argv[2], out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const sizes = { desktop: [1440, 900], laptop: [1180, 800], tablet: [820, 1180], phone: [390, 844], small: [360, 740] };
(async () => {
  const b = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
  for (const [n, [w, h]] of Object.entries(sizes)) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 900 });
    const p = await ctx.newPage();
    const errs = [];
    p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.type() + ": " + m.text()); });
    p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    p.on("requestfailed", (r) => errs.push("requestfailed: " + r.url()));
    await p.goto(base, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    await p.screenshot({ path: `${out}/${n}-hero.png` });
    // scroll through so reveal + canvases settle, then full page
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < H; y += h * 0.7) { await p.evaluate((v) => scrollTo(0, v), y); await p.waitForTimeout(250); }
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}/${n}-full.png`, fullPage: true });
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    console.log(n, "overflowX:", over, "errors:", JSON.stringify(errs));
    await ctx.close();
  }
  await b.close();
})();
