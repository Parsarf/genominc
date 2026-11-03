/*
 * Enquiry form.
 *  - client-side validation with accessible, per-field errors
 *  - POST to /api/inquiry; "sent" is shown only when the server confirms {ok:true}
 *  - on any failure the entered values stay in the form and an email/phone fallback is offered
 *  - ?category=… (from product links) pre-selects the enquiry type
 */

const ENDPOINT = "/api/inquiry";
const EMAIL = "info@genominc.com";
const PHONE_DISPLAY = "+971 7 207 8763";
const PHONE_TEL = "+97172078763";
const TIMEOUT_MS = 15000;

const CATEGORY_LABELS = {
  diagnostics: "Diagnostic systems", supplements: "Supplements", veterinary: "Veterinary",
  supplier: "Becoming a supplier", other: "Something else",
};

const rules = {
  name: (v) => v.trim().length >= 2 || "Enter your name.",
  email: (v) => {
    if (!v.trim()) return "Enter an email address so we can reply.";
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || "That email address does not look right.";
  },
  message: (v) => v.trim().length >= 10 || "Tell us a little about what you need (at least 10 characters).",
};

export function initForm({ reduced }) {
  const form = document.getElementById("form");
  if (!form) return;
  const status = document.getElementById("status");
  const send = document.getElementById("send");
  const sendLabel = document.getElementById("sendLabel");
  const category = document.getElementById("category");
  const heading = form.closest(".form-card").querySelector("h3");
  heading.tabIndex = -1;
  const LABEL = sendLabel.textContent;

  /* ---------- category from product links ---------- */
  const applyCategory = (c) => {
    if (c && CATEGORY_LABELS[c] && category.value !== c) category.value = c;
  };
  applyCategory(new URLSearchParams(location.search).get("category"));

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-category]");
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    applyCategory(a.dataset.category);
    history.replaceState(null, "", a.getAttribute("href"));
    document.getElementById("contact").scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  });

  /* ---------- validation ---------- */
  const errEl = (id) => document.getElementById(id + "-err");
  function setError(id, msg) {
    const input = document.getElementById(id), el = errEl(id);
    const hint = id === "message" ? " message-hint" : "";
    if (msg) {
      el.textContent = msg; el.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", (id + "-err" + hint).trim());
    } else {
      el.hidden = true; el.textContent = "";
      input.removeAttribute("aria-invalid");
      if (hint) input.setAttribute("aria-describedby", "message-hint"); else input.removeAttribute("aria-describedby");
    }
  }
  const check = (id) => {
    const r = rules[id](document.getElementById(id).value);
    setError(id, r === true ? "" : r);
    return r === true;
  };
  Object.keys(rules).forEach((id) => {
    const input = document.getElementById(id);
    input.addEventListener("blur", () => check(id));
    input.addEventListener("input", () => { if (input.getAttribute("aria-invalid")) check(id); });
  });

  /* ---------- status ---------- */
  function show(kind, html) {
    status.className = "status " + kind;
    status.setAttribute("role", kind === "bad" ? "alert" : "status");
    status.innerHTML = html;
    status.hidden = false;
  }
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function mailtoHref(data) {
    const lines = ["Name: " + data.name];
    if (data.company) lines.push("Organisation: " + data.company);
    lines.push("Email: " + data.email);
    if (data.phone) lines.push("Phone: " + data.phone);
    if (data.category) lines.push("Enquiry about: " + (CATEGORY_LABELS[data.category] || data.category));
    lines.push("", data.message);
    let body = lines.join("\n");
    if (body.length > 1500) body = body.slice(0, 1500) + "\n[message shortened]";
    const subject = "Enquiry" + (data.category ? " – " + (CATEGORY_LABELS[data.category] || "") : "") + (data.company ? " – " + data.company : "");
    return "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  function showFailure(reason, data) {
    const lead = reason === "not_configured"
      ? "Online enquiries are not available right now."
      : reason === "invalid"
        ? "The server could not accept some of the details you entered."
        : reason === "rate_limited"
          ? "Too many enquiries. Please wait 15 minutes before trying again."
          : "Your enquiry could not be confirmed.";
    const receipt = ["not_configured", "invalid", "rate_limited"].includes(reason)
      ? "This enquiry has not been sent."
      : "We could not confirm delivery. You can retry safely, or contact us directly.";
    show("bad",
      "<strong>" + lead + "</strong>" +
      "<p>" + receipt + " Everything you typed is still in the form. You can email it to us instead, or call " +
      "<a href=\"tel:" + PHONE_TEL + "\">" + PHONE_DISPLAY + "</a>.</p>" +
      "<a class=\"btn btn-secondary\" href=\"" + esc(mailtoHref(data)) + "\">Email this enquiry to " + EMAIL + "</a>");
    status.focus();
  }

  /* ---------- submit ---------- */
  let inFlight = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (inFlight) return;

    let first = null;
    for (const id of Object.keys(rules)) if (!check(id) && !first) first = document.getElementById(id);
    if (first) {
      show("bad", "<strong>Please check the highlighted fields.</strong>");
      first.focus();
      return;
    }
    status.hidden = true;

    const fd = new FormData(form);
    const data = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v).trim()]));

    inFlight = true;
    send.disabled = true; form.setAttribute("aria-busy", "true");
    sendLabel.textContent = "Sending…";
    status.className = "status"; status.setAttribute("role", "status");
    status.textContent = "Sending your enquiry…"; status.hidden = false;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON response */ }
      if (res.ok && body && body.ok === true) {
        form.reset();
        show("ok", "<strong>Enquiry sent.</strong><p>We have received your message and will reply by email or phone.</p>");
        status.focus();
      } else {
        showFailure(body && body.error, data);
      }
    } catch {
      showFailure("network", data);
    } finally {
      clearTimeout(timer);
      inFlight = false; send.disabled = false; form.removeAttribute("aria-busy");
      sendLabel.textContent = LABEL;
    }
  });
}
