import { Scheduler } from "./scheduler.js";
import { createHelix } from "./helix.js";
import { createMolecular } from "./molecular.js";
import { initForm } from "./form.js";

// Guard against double initialisation (bfcache restores, accidental double includes).
if (!window.__genominc) {
  window.__genominc = true;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const scroll = { y: window.scrollY || 0 };
  const root = document.documentElement;

  /* ---------- animation ---------- */
  const scheduler = new Scheduler();
  const helixEl = document.getElementById("helix");
  const molEl = document.getElementById("mol");
  const anim = {
    scheduler,
    helix: helixEl && createHelix(helixEl, scheduler, { reduced, scroll }),
    mol: molEl && createMolecular(molEl, scheduler, {
      reduced, fine,
      captionK: document.getElementById("molK"),
      captionV: document.getElementById("molV"),
    }),
  };
  window.__genominc = anim; // exposed for the performance harness and manual inspection

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

  /* ---------- scroll reveal (only when it can actually run) ---------- */
  if (!reduced && "IntersectionObserver" in window) {
    root.classList.add("reveal-on");
    const io = new IntersectionObserver((en) => {
      for (const e of en) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    document.querySelectorAll(".rv").forEach((el) => io.observe(el));
  }

  const yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  initForm({ reduced });
}
