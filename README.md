# Genominc website

Static site (no build step) plus one serverless function for the enquiry form.

```
index.html            home page
privacy/ terms/       legal pages (served at /privacy/ and /terms/)
assets/css/site.css   all styles
assets/js/            main.js (entry), scheduler.js, helix.js, plate.js, form.js  (native ES modules)
assets/fonts, img/    self-hosted Outfit + Figtree (latin), logos
api/inquiry.js        POST /api/inquiry  → emails the enquiry via Resend
vercel.json           redirects, cache and security headers (CSP: everything is same-origin)
tools/                dev server, Playwright test + performance harnesses (not deployed)
docs/                 PERFORMANCE.md and raw before/after measurements
```

## Enquiry form: required configuration

The form only reports success when `/api/inquiry` returns `{ok:true}`, which happens only after
Resend accepts the email. Set these in the Vercel project (Settings → Environment Variables):

| Variable | Example |
|---|---|
| `RESEND_API_KEY` | key from resend.com |
| `INQUIRY_TO` | `info@genominc.com` |
| `INQUIRY_FROM` | `Genominc website <enquiries@genominc.com>` (domain must be verified in Resend) |

Until they are set the function answers `503 not_configured`, and the page tells the visitor that
online enquiries are unavailable, that nothing was received, keeps what they typed, and offers an
email (pre-filled) and phone alternative. If you prefer another provider, only `api/inquiry.js` changes.
No rate limiting beyond a honeypot and same-origin check is implemented.

## Local testing

```
node tools/dev-server.cjs 8810 --fake-resend   # site + API wired to a stand-in for Resend
node tools/dev-server.cjs 8820                  # site + API with NO configuration (failure path)
NODE_PATH=<dir containing playwright> node tools/e2e.cjs http://localhost:8810 http://localhost:8820
NODE_PATH=… node tools/perf.cjs http://localhost:8820/ after 4     # frame-time harness, 4× CPU throttle
# set CHROME_BIN=<chromium executable> if Playwright's own browser build isn't installed
```

Deploy by pushing to the Vercel-connected branch; nothing needs building.
