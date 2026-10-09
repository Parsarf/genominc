/*
 * Specimen plate: three line drawings (analyser, capsule, paw) that trace themselves in.
 *
 * All motion is CSS (stroke-dashoffset transitions, one progress animation per tab), so there is no
 * canvas and no requestAnimationFrame loop. JS only:
 *  - switches the active figure and keeps tab semantics (roving tabindex, arrow keys),
 *  - advances to the next figure when the active tab's progress animation ends,
 *  - pauses that progress while the plate is off screen, hovered or focused,
 *  - maps the pointer to two CSS variables for a small parallax.
 */

export function createPlate(root, { reduced, fine }) {
  const tabs = [...root.querySelectorAll(".plate-tab")];
  const figs = new Map([...root.querySelectorAll(".fig")].map((g) => [g.dataset.fig, g]));
  const nameEl = document.getElementById("plateName");
  const figEl = document.getElementById("plateFig");
  const linkEl = document.getElementById("plateLink");
  const descEl = document.getElementById("plateDesc");
  const panel = document.getElementById("platePanel");
  const style = root.style;
  let current = 0;
  let auto = !reduced;
  let seen = false;

  // Index every drawable so strokes trace in sequence (CSS reads --i for the delay).
  for (const g of figs.values()) g.querySelectorAll(".d").forEach((el, i) => el.style.setProperty("--i", i));

  root.classList.add("js");
  for (const g of figs.values()) g.classList.remove("on");

  function show(i, { user = false } = {}) {
    if (user) { auto = false; root.classList.remove("auto"); }
    current = (i + tabs.length) % tabs.length;
    const t = tabs[current];
    tabs.forEach((b, k) => {
      const on = k === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle("is-on", on);
    });
    figs.forEach((g, key) => g.classList.toggle("on", key === t.dataset.fig));
    root.dataset.fig = t.dataset.fig;
    panel.setAttribute("aria-labelledby", t.id);
    descEl.textContent = t.dataset.desc;
    root.classList.add("swap");
    setTimeout(() => {
      figEl.textContent = "Fig. " + t.dataset.n;
      nameEl.textContent = t.dataset.name;
      linkEl.dataset.category = t.dataset.fig;
      linkEl.href = "?category=" + t.dataset.fig + "#contact";
      root.classList.remove("swap");
    }, 160);
    return t;
  }

  tabs.forEach((b, i) => b.addEventListener("click", () => show(i, { user: true })));
  root.querySelector(".plate-tabs").addEventListener("keydown", (e) => {
    const k = e.key;
    const next = k === "ArrowRight" ? current + 1 : k === "ArrowLeft" ? current - 1 : k === "Home" ? 0 : k === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    show(next, { user: true }).focus();
  });

  // Autoplay: the CSS progress bar on the active tab is the timer.
  if (auto) {
    root.classList.add("auto");
    root.addEventListener("animationend", (e) => {
      if (auto && e.animationName === "plate-progress") show(current + 1);
    });
  }

  const pause = (on) => root.classList.toggle("hold", on);
  root.addEventListener("pointerenter", () => pause(true));
  root.addEventListener("pointerleave", () => pause(false));
  root.addEventListener("focusin", () => pause(true));
  root.addEventListener("focusout", () => pause(false));

  // Parallax (fine pointers only), coalesced to one style write per frame.
  if (fine && !reduced) {
    let px = 0, py = 0, queued = false;
    const apply = () => { queued = false; style.setProperty("--px", px.toFixed(3)); style.setProperty("--py", py.toFixed(3)); };
    root.addEventListener("pointermove", (e) => {
      const r = root.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width) * 2 - 1;
      py = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!queued) { queued = true; requestAnimationFrame(apply); }
    });
    root.addEventListener("pointerleave", () => { px = 0; py = 0; if (!queued) { queued = true; requestAnimationFrame(apply); } });
  }

  // Draw the first figure when the plate scrolls into view; run decorative loops only while visible.
  const io = new IntersectionObserver((en) => {
    const vis = en[en.length - 1].isIntersecting;
    root.classList.toggle("live", vis);
    if (vis && !seen) { seen = true; show(0); }
  }, { threshold: 0.35 });
  io.observe(root);

  return { destroy() { io.disconnect(); } };
}
