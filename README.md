# Genominc website

Static site (no build step) plus one serverless function for the enquiry form.

```
index.html            home page
privacy/ terms/       legal pages (served at /privacy/ and /terms/)
assets/css/site.css   all styles
assets/js/            main.js (entry), helix.js (static motif), form.js (native ES modules)
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
The endpoint also uses a honeypot and same-origin check, with best-effort limits of five valid
attempts per email address and 100 total per 15 minutes within each warm serverless instance.
These counters are not shared between instances or retained after restarts. Configure a hosting
firewall rate limit on `POST /api/inquiry` for deployment-wide abuse protection.
Identical email payloads use a stable Resend idempotency key to suppress duplicate delivery
within the provider's 24-hour window. Ambiguous network failures preserve the enquiry and allow retry.

## Local testing

```
node --test tools/api-test.cjs               # offline API checks, no email or network
node tools/dev-server.cjs 8810 --fake-resend   # site + API wired to a stand-in for Resend
node tools/dev-server.cjs 8820                  # site + API with NO configuration (failure path)
NODE_PATH=<dir containing playwright> node tools/e2e.cjs http://localhost:8810 http://localhost:8820
NODE_PATH=… node tools/perf.cjs http://localhost:8820/ after 4     # historical animation harness; see docs/PERFORMANCE.md
# set CHROME_BIN=<chromium executable> if Playwright's own browser build isn't installed
```

Deploy by pushing to the Vercel-connected branch; nothing needs building.

## Design refinement

The homepage keeps the existing navy, blue, cyan and white palette. Product categories appear
in one main section; the illustrated product carousel and repeated hero category list have
been removed. The remaining helix is static and loaded after the form and navigation.
Manufacturer logos, credentials and original photography still need verified company assets;
no placeholder endorsements or new business claims have been added.
