/*
 * POST /api/inquiry  (Vercel serverless function)
 *
 * Sends the enquiry to Genominc by email through Resend (https://resend.com).
 * It reports success ONLY when Resend accepts the message. When the destination is not
 * configured it answers 503 {ok:false,error:"not_configured"} and the page says so honestly.
 *
 * Environment variables (Vercel project settings):
 *   RESEND_API_KEY   API key from Resend
 *   INQUIRY_TO       address that receives enquiries, e.g. info@genominc.com
 *   INQUIRY_FROM     verified sender on a domain verified in Resend, e.g. "Genominc website <enquiries@genominc.com>"
 *   ALLOWED_ORIGINS  optional, comma separated extra origins (defaults to the request's own host)
 *   RESEND_API_URL   optional, test override only
 */
const MAX = { name: 120, company: 160, email: 200, phone: 40, message: 4000 };
const CATEGORIES = { diagnostics: "Diagnostic systems", supplements: "Supplements", veterinary: "Veterinary", supplier: "Becoming a supplier", other: "Something else" };

const clean = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const oneLine = (v) => v.replace(/[\r\n\u2028\u2029]+/g, " ");

function reply(res, status, body) {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.json(body);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { ok: false, error: "method_not_allowed" });
  }

  // Same-origin only: browsers always send Origin on cross-origin POSTs.
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try { host = new URL(origin).host; } catch { /* leave empty */ }
    const extra = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (host !== req.headers.host && !extra.includes(origin)) return reply(res, 403, { ok: false, error: "forbidden_origin" });
  }

  const { RESEND_API_KEY, INQUIRY_TO, INQUIRY_FROM } = process.env;
  if (!RESEND_API_KEY || !INQUIRY_TO || !INQUIRY_FROM) return reply(res, 503, { ok: false, error: "not_configured" });

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== "object") return reply(res, 400, { ok: false, error: "invalid" });

  // Honeypot: real visitors never fill this in. Acknowledge silently so bots learn nothing.
  if (typeof b.website === "string" && b.website.trim()) return reply(res, 200, { ok: true });

  const d = {
    name: clean(b.name, MAX.name), company: clean(b.company, MAX.company), email: clean(b.email, MAX.email),
    phone: clean(b.phone, MAX.phone), message: clean(b.message, MAX.message),
    category: Object.prototype.hasOwnProperty.call(CATEGORIES, b.category) ? b.category : "",
  };
  const fields = {};
  if (d.name.length < 2) fields.name = true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) fields.email = true;
  if (d.message.length < 10) fields.message = true;
  if (Object.keys(fields).length) return reply(res, 400, { ok: false, error: "invalid", fields });

  const text = [
    "New website enquiry", "",
    "Name: " + d.name, "Organisation: " + (d.company || "-"), "Email: " + d.email, "Phone: " + (d.phone || "-"),
    "Enquiry about: " + (CATEGORIES[d.category] || "-"), "", d.message,
  ].join("\n");

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: INQUIRY_FROM, to: [INQUIRY_TO], reply_to: d.email,
        subject: oneLine("Website enquiry: " + (CATEGORIES[d.category] || "General") + " - " + d.name),
        text,
      }),
    });
    if (!r.ok) return reply(res, 502, { ok: false, error: "delivery_failed" });
    return reply(res, 200, { ok: true });
  } catch {
    return reply(res, 502, { ok: false, error: "delivery_failed" });
  } finally {
    clearTimeout(timer);
  }
};
