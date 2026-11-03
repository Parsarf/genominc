/*
 * Hero strand: two dotted strands crossing (the logo motif) that unwind into a
 * single straight line as the reader scrolls past the hero.
 *
 * Cost control, compared with drawing every dot individually:
 *  - dots are grouped into a few depth buckets and filled in one path each
 *  - colour is set once per strand, opacity per bucket (no per-dot strings)
 *  - the soft left/right fade is a CSS mask on the canvas, not per-dot alpha
 *  - the backing store is sized to the quality level, not always devicePixelRatio
 *  - sizes come from ResizeObserver entries, never from layout reads in the frame
 */

const NAVY = [1, 45, 123];
const CYAN = [0, 180, 231];
const TAU = Math.PI * 2;
const NB = 8;                       // depth buckets per strand
const DPR_CAP = [1, 1.25, 1.5];     // canvas resolution per quality level

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createHelix(canvas, scheduler, { reduced, scroll }) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let W = 0, H = 0, scale = 1, level = 1;
  let T = 0;                        // animation clock (seconds), advanced by capped dt only
  let cols = 0, spacing = 0;
  let xs = new Float32Array(0), sin = new Float32Array(0), bucket = new Uint8Array(0);
  let rt = 0;
  const handle = { current: null };

  function resize(w, h) {
    W = w; H = h;
    const want = Math.min(window.devicePixelRatio || 1, DPR_CAP[level]);
    if (W < 1 || H < 1) return;
    const pw = Math.round(W * want), ph = Math.round(H * want);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    scale = pw / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const max = Math.ceil(W / 3) + 2;
    if (xs.length < max) { xs = new Float32Array(max); sin = new Float32Array(max); bucket = new Uint8Array(max); }
    draw();
  }

  function layout(waves, e, spin) {
    // columns advance with e (tightening), so recompute the column positions each draw
    const base = W < 640 ? 17 : 21;
    spacing = base + (4 - base) * e;
    cols = 0;
    for (let x = 0; x <= W + spacing; x += spacing) {
      const a = (x / W) * TAU * waves + spin;
      xs[cols] = x;
      sin[cols] = Math.sin(a);
      const depth = (Math.cos(a) + 1) / 2;
      bucket[cols] = Math.min(NB - 1, (depth * NB) | 0);
      cols++;
    }
  }

  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);

    const y = scroll.y;
    const u = reduced ? 0 : clamp01(y / (H * 0.55));
    const e = u * u * (3 - 2 * u);
    const spin = T * 0.18 + (reduced ? 0 : y * 0.0009);

    const band = reduced ? Math.min(110, H * 0.8) : Math.min(190, H * 0.3);
    const cy = reduced ? H * 0.5 : (H - band * 0.5) + (band * 0.5 - 1) * e;
    const amp = band * 0.34 * Math.pow(1 - e, 1.7);
    const waves = (W < 640 ? 1.6 : 2.6) * (1 - e * 0.4);
    layout(waves, e, spin);

    const inv = 1 - e;
    const aR = NAVY[0] + (CYAN[0] - NAVY[0]) * e, aG = NAVY[1] + (CYAN[1] - NAVY[1]) * e, aB = NAVY[2] + (CYAN[2] - NAVY[2]) * e;
    const colA = "rgb(" + (aR | 0) + "," + (aG | 0) + "," + (aB | 0) + ")";
    const colB = "rgb(0,180,231)";

    for (let strand = 0; strand < 2; strand++) {
      ctx.fillStyle = strand ? colB : colA;
      const sign = strand ? -1 : 1;
      for (let b = 0; b < NB; b++) {
        const d = (b + 0.5) / NB;                       // bucket centre depth, 0 behind .. 1 front
        const fade = 0.10 + d * 0.30;
        const alpha = strand
          ? (0.56 - fade * 0.5) * inv + 0.34 * e
          : fade * inv + 0.34 * e;
        const r = (1.6 + d * 3.1) * inv + 1.7 * e;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (let i = 0; i < cols; i++) {
          if (bucket[i] !== b) continue;
          const px = xs[i], py = cy + sign * sin[i] * amp;
          ctx.moveTo(px + r, py);
          ctx.arc(px, py, r, 0, TAU);
        }
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }

  const task = {
    update(dt) { T += dt; draw(); },
    setQuality(l) {
      if (l === level) return;
      level = l;
      clearTimeout(rt);
      rt = setTimeout(() => resize(W, H), 0);
    },
  };

  let ro = null, io = null;
  if (reduced) {
    // Intentional static presentation: one still frame of the crossed strands, redrawn only on resize.
    ro = new ResizeObserver((en) => {
      const r = en[0].contentRect;
      clearTimeout(rt);
      rt = setTimeout(() => resize(r.width, r.height), 120);
    });
    ro.observe(canvas);
  } else {
    handle.current = scheduler.add(task);
    ro = new ResizeObserver((en) => {
      const r = en[0].contentRect;
      if (Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1 && W) return;
      clearTimeout(rt);
      rt = setTimeout(() => resize(r.width, r.height), 120);
    });
    ro.observe(canvas);
    io = new IntersectionObserver((en) => {
      handle.current.setVisible(en[en.length - 1].isIntersecting);
    }, { rootMargin: "40px 0px" });
    io.observe(canvas);
  }

  return {
    redraw() { if (W) draw(); },
    destroy() {
      clearTimeout(rt);
      if (ro) ro.disconnect();
      if (io) io.disconnect();
      if (handle.current) handle.current.remove();
    },
  };
}
