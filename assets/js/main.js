import { initForm } from "./form.js";

// Guard against double initialisation (bfcache restores, accidental double includes).
if (!window.__genominc) {
  window.__genominc = true;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scroll = { y: window.scrollY || 0 };

  /* ---------- navigation ---------- */
  const nav = document.getElementById("nav");
  const burger = document.getElementById("burger");
  const links = document.getElementById("navLinks");
  let stuck = false;
  const onScroll = () => {
    scroll.y = window.scrollY;
    const s = scroll.y > 8;
    if (s !== stuck) { stuck = s; nav.classList.toggle("is-stuck", s); }
  };
  onScroll();
  addEventListener("scroll", onScroll, { passive: true });

  const mobileNav = matchMedia("(max-width: 860px)");
  const setMenu = (open) => {
    links.dataset.open = String(open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  burger.addEventListener("click", () => setMenu(links.dataset.open !== "true"));
  links.addEventListener("click", (e) => { if (e.target.closest("a") && mobileNav.matches) setMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && links.dataset.open === "true") { setMenu(false); burger.focus(); }
  });
  mobileNav.addEventListener("change", () => setMenu(false));

  /* current-section marker */
  if ("IntersectionObserver" in window) {
    const map = new Map();
    document.querySelectorAll('.nav-links a[href^="#"]:not(.nav-cta)').forEach((a) => {
      const sec = document.querySelector(a.getAttribute("href"));
      if (sec) map.set(sec, a);
    });
    const spy = new IntersectionObserver((en) => {
      for (const e of en) {
        const a = map.get(e.target);
        if (a) e.isIntersecting ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current");
      }
    }, { rootMargin: "-45% 0px -50% 0px" });
    map.forEach((_, sec) => spy.observe(sec));
  }

  const yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  initForm({ reduced });

  // The brand motif is a still frame. Optional artwork must never block navigation or enquiries.
  const helix = document.getElementById("helix");
  if (helix) import("./helix.js").then(({ createHelix }) => {
    window.__genominc = { helix: createHelix(helix, null, { reduced: true, scroll }) };
  }).catch(() => { /* Core page remains fully usable without the decorative canvas. */ });
}
