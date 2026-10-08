// node tools/e2e.cjs <configuredBase (fake resend)> <unconfiguredBase>
const { chromium } = require("playwright");
const [OK, NOCFG] = [process.argv[2], process.argv[3]];
let fails = 0;
const t = (name, cond, extra) => { console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + (extra || ""))); if (!cond) fails++; };
const fill = async (p) => {
  await p.fill("#name", "Test Person"); await p.fill("#company", "Test Clinic"); await p.fill("#email", "test@example.org");
  await p.fill("#phone", "+971 50 000 0000"); await p.fill("#message", "Need 10 boxes of rapid test kits, delivery to RAK.");
};
(async () => {
  const b = await chromium.launch(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {});
  const mk = async (w = 1280, h = 900) => { const c = await b.newContext({ viewport: { width: w, height: h } }); return c.newPage(); };

  // 1 validation
  let p = await mk(); let posts = 0; p.on("request", (r) => r.method() === "POST" && posts++);
  await p.goto(OK + "/"); await p.click("#send");
  t("empty submit shows 3 errors", (await p.locator(".err:not([hidden])").count()) === 3);
  t("first invalid field focused", await p.evaluate(() => document.activeElement.id) === "name");
  t("aria-invalid + describedby set", await p.getAttribute("#email", "aria-invalid") === "true" && (await p.getAttribute("#email", "aria-describedby")) === "email-err");
  t("no network request when invalid", posts === 0);
  await p.fill("#email", "nope"); await p.fill("#name", "A"); await p.fill("#message", "short"); await p.click("#send");
  t("bad email message", (await p.textContent("#email-err")).includes("does not look right"));

  // 2 success against configured (fake) service
  await p.fill("#name", "Test Person"); await p.fill("#email", "test@example.org"); await p.fill("#message", "Need 10 boxes of rapid test kits, delivery to RAK.");
  await p.selectOption("#category", "diagnostics"); await p.fill("#company", "Test Clinic");
  const respP = p.waitForResponse((r) => r.url().endsWith("/api/inquiry"));
  await p.click("#send");
  const resp = await respP;
  t("API 200 ok", resp.status() === 200 && (await resp.json()).ok === true);
  await p.waitForSelector("#status.ok");
  t("success shown after confirmation", (await p.textContent("#status")).includes("Enquiry sent"));
  t("form cleared after success", (await p.inputValue("#name")) === "");
  const sentRes = await (await fetch(new URL(OK).protocol + "//localhost:" + (new URL(OK).port * 1 + 1) + "/__sent")).json();
  const m = sentRes[sentRes.length - 1] || {};
  t("provider received message with reply_to + category", m.reply_to === "test@example.org" && /Diagnostic systems/.test(m.text) && /rapid test kits/.test(m.text) && m.to[0] === "test@example.com", JSON.stringify(m));

  // 3 pending state visible + button disabled
  p = await mk();
  await p.route("**/api/inquiry", async (r) => { await new Promise((x) => setTimeout(x, 800)); r.continue(); });
  await p.goto(OK + "/"); await fill(p); await p.click("#send");
  t("button disabled + label while pending", (await p.isDisabled("#send")) && (await p.textContent("#sendLabel")).includes("Sending"));
  await p.waitForSelector("#status.ok"); t("button restored", !(await p.isDisabled("#send")));

  // 4 unconfigured destination => honest failure, data preserved
  p = await mk(); await p.goto(NOCFG + "/"); await fill(p); await p.selectOption("#category", "veterinary"); await p.click("#send");
  await p.waitForSelector("#status.bad");
  const txt = await p.textContent("#status");
  t("unconfigured: says not available + not received", /not available/.test(txt) && /has not received/.test(txt));
  t("unconfigured: NO success text anywhere", !/Enquiry sent|have received your message/.test(await p.textContent("body")));
  t("values preserved", (await p.inputValue("#name")) === "Test Person" && (await p.inputValue("#message")).includes("rapid test") && (await p.inputValue("#category")) === "veterinary");
  const href = await p.getAttribute("#status a.btn", "href");
  t("mailto fallback carries enquiry", href.startsWith("mailto:info@genominc.com") && decodeURIComponent(href).includes("rapid test kits") && decodeURIComponent(href).includes("Veterinary"), href);
  t("phone fallback present", (await p.locator('#status a[href="tel:+97172078763"]').count()) === 1);
  t("status is an alert & focused", (await p.getAttribute("#status", "role")) === "alert" && (await p.evaluate(() => document.activeElement.id)) === "status");

  // 5 network failure
  p = await mk(); await p.route("**/api/inquiry", (r) => r.abort()); await p.goto(OK + "/"); await fill(p); await p.click("#send");
  await p.waitForSelector("#status.bad"); t("network failure handled, values kept", (await p.inputValue("#email")) === "test@example.org");

  // 6 category prefill
  p = await mk(); await p.goto(OK + "/"); await p.click('.index a[data-category="supplements"]');
  await p.waitForTimeout(700);
  t("hero category link prefills select", (await p.inputValue("#category")) === "supplements");
  t("url carries category, focus moved to form", p.url().includes("category=supplements") && (await p.evaluate(() => document.activeElement.tagName)) === "H3");
  await p.click('.division a[data-category="veterinary"]'); await p.waitForTimeout(500);
  t("division link prefills", (await p.inputValue("#category")) === "veterinary");
  p = await mk(); await p.goto(OK + "/?category=diagnostics#contact"); t("deep link ?category= prefills", (await p.inputValue("#category")) === "diagnostics");
  await p.goto(OK + "/?category=bogus"); t("unknown category ignored", (await p.inputValue("#category")) === "");

  // 7 legal + links
  p = await mk();
  for (const u of ["/privacy/", "/terms/", "/privacy"]) { const r = await p.goto(OK + u); t("GET " + u + " 200", r.status() === 200); }
  await p.goto(OK + "/"); 
  t("footer legal links point to pages", (await p.locator('footer a[href="/privacy/"]').count()) === 1 && (await p.locator('footer a[href="/terms/"]').count()) === 1);
  t("no WhatsApp link, no map iframe, no placeholder text", (await p.locator('a[href*="wa.me"], iframe').count()) === 0 && !/Partner logo/.test(await p.content()));
  const hrefs = await p.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  t("tel/mailto present", hrefs.includes("tel:+97172078763") && hrefs.includes("mailto:info@genominc.com"));
  const ids = await p.$$eval("a[href^='#']", (as) => as.map((a) => a.getAttribute("href").slice(1)).filter(Boolean));
  const missing = []; for (const id of new Set(ids)) if (!(await p.$("#" + id))) missing.push(id);
  t("all in-page anchors resolve", missing.length === 0, missing.join());

  // 8 mobile menu
  p = await mk(390, 844); await p.goto(OK + "/");
  t("menu closed initially", (await p.isHidden("#navLinks")));
  await p.click("#burger"); t("menu opens", await p.isVisible("#navLinks") && (await p.getAttribute("#burger", "aria-expanded")) === "true");
  await p.keyboard.press("Escape"); t("Escape closes + returns focus", (await p.isHidden("#navLinks")) && (await p.evaluate(() => document.activeElement.id)) === "burger");
  await p.click("#burger"); await p.click('#navLinks a[href="#about"]'); t("link click closes menu", await p.isHidden("#navLinks"));
  t("primary CTA in first viewport on phone", await p.evaluate(() => { const r = document.querySelector(".hero-actions .btn-primary").getBoundingClientRect(); return r.bottom < innerHeight; }));
  const small = await p.$$eval("a,button,input,select,textarea", (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 40) && !e.closest(".hp") && !e.classList.contains("skip-link") && !(e.tagName === "A" && e.closest("p")); }).map((e) => e.outerHTML.slice(0, 70)));
  t("touch targets >= 40px tall (phone)", small.length === 0, small.join(" | "));

  // 9 API direct
  const post = (base, body, headers = {}) => fetch(base + "/api/inquiry", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  t("API GET -> 405", (await fetch(OK + "/api/inquiry")).status === 405);
  t("API invalid -> 400", (await post(OK, { name: "x" })).status === 400);
  t("API foreign origin -> 403", (await post(OK, { name: "Test", email: "a@b.co", message: "long enough text" }, { origin: "https://evil.example" })).status === 403);
  const before = (await (await fetch("http://localhost:" + (+new URL(OK).port + 1) + "/__sent")).json()).length;
  t("API honeypot -> 200 but nothing sent", (await post(OK, { name: "Bot", email: "a@b.co", message: "long enough text", website: "http://spam" })).status === 200 &&
    (await (await fetch("http://localhost:" + (+new URL(OK).port + 1) + "/__sent")).json()).length === before);
  t("API unconfigured -> 503", (await post(NOCFG, { name: "Test", email: "a@b.co", message: "long enough text" })).status === 503);
  const inj = await post(OK, { name: "Eve\r\nBcc: x@y.z", email: "a@b.co", message: "long enough text here" });
  const last = (await (await fetch("http://localhost:" + (+new URL(OK).port + 1) + "/__sent")).json()).pop();
  t("subject has no CR/LF", inj.status === 200 && !/[\r\n]/.test(last.subject), last && last.subject);

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  await b.close(); process.exit(fails ? 1 : 0);
})();
