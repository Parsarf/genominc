// Screenshot the molecular canvas when each form has resolved, at each quality level. node tools/forms.cjs <url> <outDir>
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  fs.mkdirSync(process.argv[3], { recursive: true });
  const b = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(process.argv[2]); await p.waitForTimeout(1000);
  await p.evaluate(() => { window.__genominc.scheduler._measure = () => {}; document.querySelector("#mol").scrollIntoView({ block: "center" }); });
  for (const level of [2, 0]) {
    await p.evaluate((l) => window.__genominc.scheduler._set(l, performance.now()), level);
    // wait until each form resolves
    for (const name of ["Analyser", "Capsule", "Animal health"]) {
      await p.waitForFunction((n) => document.getElementById("molK").textContent === "Resolved" && document.getElementById("molV").textContent === n, name, { timeout: 40000 });
      await p.waitForTimeout(300);
      await (await p.$("#mol")).screenshot({ path: `${process.argv[3]}/L${level}-${name.replace(" ", "_")}.png` });
    }
  }
  await b.close();
})();
