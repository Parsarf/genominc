/*
 * Local static server + /api/inquiry for testing. Not used in production.
 *   node tools/dev-server.cjs [port] [--fake-resend]
 * --fake-resend starts a stand-in for the Resend API and configures the env so
 * the real api/inquiry.js code path can be exercised end to end.
 * The fake records accepted messages and serves them at GET /__sent on its own port.
 */
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const port = +process.argv[2] || 8810;
const fake = process.argv.includes("--fake-resend");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml" };

if (fake) {
  const sent = [];
  http.createServer((req, res) => {
    if (req.url === "/__sent") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(sent)); }
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer test-key") { res.statusCode = 401; return res.end("{}"); }
      sent.push(JSON.parse(b)); res.setHeader("content-type", "application/json"); res.end('{"id":"test"}');
    });
  }).listen(port + 1);
  Object.assign(process.env, { RESEND_API_KEY: "test-key", INQUIRY_TO: "test@example.com", INQUIRY_FROM: "Genominc <site@example.com>", RESEND_API_URL: "http://localhost:" + (port + 1) + "/emails" });
}

const handler = require("../api/inquiry.js");
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/inquiry") {
    let b = ""; req.on("data", (c) => (b += c));
    return req.on("end", () => {
      try { req.body = b ? JSON.parse(b) : undefined; } catch { req.body = b; }
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
      handler(req, res);
    });
  }
  let p = decodeURIComponent(url.pathname);
  if (p === "/privacy" || p === "/terms") { res.statusCode = 301; res.setHeader("Location", p + "/"); return res.end(); }
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log("http://localhost:" + port + (fake ? " (fake resend on " + (port + 1) + ")" : "")));
