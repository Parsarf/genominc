/*
 * About-section particle field. Particles drift as a "sample field", then
 * gather into the outline of an analyser, a capsule and a paw in turn.
 *
 * Particle targets are sampled from real line-art outlines, so the resolved
 * shape is the drawing itself. Compared with the original implementation:
 *  - one shared clock advanced by capped dt; paused time is simply not counted
 *  - structure-of-arrays Float32Arrays, no per-particle objects, no per-frame allocation
 *  - outline sampling and bond building are deferred to idle time, cached per
 *    quality level, and never repeated on resize (targets are size-independent)
 *  - dots, bonds and the microscope shapes are each drawn as a handful of batched paths
 *  - particle count and canvas resolution follow the scheduler's quality level
 */

const TAU = 6.283185307179586;
const NMAX = 1600;                        // particles at the highest quality
const COUNT = [560, 960, NMAX];           // particles per quality level
const DPR_CAP = [1, 1.5, 2];
const CYCLE = 9.0, HOLD_IN = 2.4, HOLD = 3.6, HOLD_OUT = 1.6;
const FORM_NAMES = ["Analyser", "Capsule", "Animal health"];

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (v) => v * v * (3 - 2 * v);
const sg = (v, a, b) => cl01((v - a) / (b - a));

function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 60));

/* ---------- outlines, in -0.5..0.5 space ---------- */
function drawers(c) {
  const rr = (x, y, w, h, r) => {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath(); c.stroke();
  };
  const dt = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  const ring = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke(); };
  const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  const el = (x, y, rx, ry, rot) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, TAU); c.stroke(); };
  return [
    () => { // analyser
      rr(-0.30, -0.38, 0.60, 0.74, 0.055);
      rr(-0.20, -0.28, 0.40, 0.30, 0.028);
      ring(-0.04, -0.13, 0.088); dt(-0.04, -0.13, 0.018); ring(0.12, -0.13, 0.030);
      rr(-0.20, 0.06, 0.26, 0.14, 0.02); ring(0.14, 0.13, 0.045);
      line(-0.30, 0.28, 0.30, 0.28); line(-0.22, 0.36, -0.10, 0.36); line(-0.09, -0.38, 0.09, -0.38);
      dt(0, -0.46, 0.016); dt(0, -0.52, 0.012);
    },
    () => { // capsule
      rr(-0.145, -0.34, 0.29, 0.68, 0.145);
      line(-0.145, 0, 0.145, 0); ring(0, 0.175, 0.10);
      [[-0.05, 0.10], [0.045, 0.13], [-0.02, 0.20], [0.06, 0.24], [-0.07, 0.26], [0.01, 0.30]].forEach((g) => dt(g[0], g[1], 0.017));
      line(-0.06, -0.24, -0.06, -0.10); line(0.06, -0.28, 0.06, -0.10);
    },
    () => { // paw
      el(0, 0.15, 0.185, 0.145);
      el(-0.235, -0.045, 0.070, 0.098, -0.38); el(-0.085, -0.185, 0.072, 0.104, -0.13);
      el(0.085, -0.185, 0.072, 0.104, 0.13); el(0.235, -0.045, 0.070, 0.098, 0.38);
      dt(0, 0.15, 0.020);
    },
  ];
}

/* Sample each outline into exactly NMAX points, ordered by angle. */
function sampleOutlines() {
  const S = 400;
  const oc = document.createElement("canvas");
  oc.width = S; oc.height = S;
  const c = oc.getContext("2d", { willReadFrequently: true });
  const draws = drawers(c);
  const out = [];
  for (let f = 0; f < draws.length; f++) {
    c.clearRect(0, 0, S, S);
    c.save(); c.translate(S / 2, S / 2); c.scale(S, S);
    c.lineWidth = 0.016; c.lineJoin = "round"; c.lineCap = "round";
    c.strokeStyle = "#000"; c.fillStyle = "#000";
    draws[f](); c.restore();
    const d = c.getImageData(0, 0, S, S).data;
    const raw = [];
    for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) if (d[(y * S + x) * 4 + 3] > 110) raw.push(x / S - 0.5, y / S - 0.5);
    const n = raw.length / 2, rnd = rng(20260812 + f);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    for (let i = n - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0, t = order[i]; order[i] = order[j]; order[j] = t; }
    const pts = [];
    for (let k = 0; k < NMAX; k++) {
      const o = order[k % n];
      let x = raw[o * 2], y = raw[o * 2 + 1];
      if (n < NMAX) { x += (rnd() - 0.5) * 0.012; y += (rnd() - 0.5) * 0.012; }
      pts.push([x, y, Math.atan2(y, x)]);
    }
    pts.sort((a, b) => a[2] - b[2]);
    const arr = new Float32Array(NMAX * 2);
    for (let k = 0; k < NMAX; k++) { arr[k * 2] = pts[k][0]; arr[k * 2 + 1] = pts[k][1]; }
    out.push(arr);
  }
  return out;
}

/* Two nearest neighbours within radius R for each point (grid + linked lists, no allocations in the inner loop). */
function buildBonds(t, K, R) {
  const cell = R, G = Math.ceil(1.3 / cell) + 3;
  const head = new Int32Array(G * G).fill(-1), next = new Int32Array(K);
  const px = new Float32Array(K), py = new Float32Array(K);
  const stride = NMAX / K;
  for (let i = 0; i < K; i++) {
    const src = Math.floor(i * stride);
    px[i] = t[src * 2]; py[i] = t[src * 2 + 1];
    const gx = ((px[i] + 0.65) / cell) | 0, gy = ((py[i] + 0.65) / cell) | 0;
    const k = gy * G + gx; next[i] = head[k]; head[k] = i;
  }
  const out = [], R2 = R * R;
  for (let a = 0; a < K; a++) {
    const gx = ((px[a] + 0.65) / cell) | 0, gy = ((py[a] + 0.65) / cell) | 0;
    let b1 = -1, b2 = -1, d1 = R2, d2 = R2;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      for (let b = head[(gy + oy) * G + gx + ox]; b !== -1; b = next[b]) {
        if (b === a) continue;
        const dx = px[b] - px[a], dy = py[b] - py[a], dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = b; } else if (dd < d2) { d2 = dd; b2 = b; }
      }
    }
    if (b1 > a) out.push(a, b1);
    if (b2 > a) out.push(a, b2);
  }
  return new Uint16Array(out);
}

export function createMolecular(canvas, scheduler, { reduced, fine, captionK, captionV, onReady }) {
  const ctx = canvas.getContext("2d", { alpha: true });
  let level = 1, K = COUNT[1];
  let W = 0, H = 0, CX = 0, CY = 0, SC = 0, dprScale = 1;
  let clock = 0, readyAt = -1;
  let targets = null;                       // 3 x Float32Array(NMAX*2), unit space
  const bondCache = new Map();              // `${form}:${K}` -> Uint16Array
  let rebuildTimer = 0, ro = null, io = null;
  let lastK = "", lastV = "";
  const stats = { sampleMs: 0, bondMs: 0 };

  /* ---- particle state: structure of arrays, allocated once ---- */
  const rnd = rng(7717);
  const UX = new Float32Array(NMAX), UY = new Float32Array(NMAX);
  const PH = new Float32Array(NMAX), SP = new Float32Array(NMAX), AM = new Float32Array(NMAX);
  const RD = new Float32Array(NMAX), RF = new Float32Array(NMAX), ZZ = new Float32Array(NMAX);
  const CYN = new Uint8Array(NMAX), SPC = new Uint8Array(NMAX);
  const ROT = new Float32Array(NMAX), SPIN = new Float32Array(NMAX);
  const X = new Float32Array(NMAX), Y = new Float32Array(NMAX);
  for (let i = 0; i < NMAX; i++) {
    const ang = rnd() * TAU, rad = Math.sqrt(rnd()) * 0.62, kind = rnd();
    UX[i] = Math.cos(ang) * rad * 1.5; UY[i] = Math.sin(ang) * rad * 1.5;
    PH[i] = rnd() * TAU; SP[i] = 0.16 + rnd() * 0.42; AM[i] = 0.010 + rnd() * 0.030;
    const z = 0.35 + rnd() * 0.65, r = 0.9 + rnd() * 1.5;
    ZZ[i] = z; RD[i] = r * (0.55 + z * 0.65); RF[i] = 1.35 + z * 0.55;
    CYN[i] = rnd() < 0.34 ? 1 : 0;
    SPC[i] = kind < 0.10 ? 1 : kind < 0.17 ? 2 : kind < 0.23 ? 3 : 0;
    ROT[i] = rnd() * TAU; SPIN[i] = (rnd() - 0.5) * 0.5;
  }
  // dispersed + target positions in canvas px for the current size / particle count
  const DX = new Float32Array(NMAX), DY = new Float32Array(NMAX);
  const TX = [new Float32Array(NMAX), new Float32Array(NMAX), new Float32Array(NMAX)];
  const TY = [new Float32Array(NMAX), new Float32Array(NMAX), new Float32Array(NMAX)];
  // microscope shapes grouped by (colour, species, depth band) once per K; lists of particle indices
  let groups = [];

  function layoutParticles() {
    const stride = NMAX / K;
    for (let i = 0; i < K; i++) {
      DX[i] = CX + UX[i] * W * 0.40; DY[i] = CY + UY[i] * H * 0.40;
    }
    if (!targets) return;
    for (let f = 0; f < 3; f++) {
      const t = targets[f];
      for (let i = 0; i < K; i++) {
        const s = Math.floor(i * stride);
        TX[f][i] = CX + t[s * 2] * SC; TY[f][i] = CY + t[s * 2 + 1] * SC;
      }
    }
  }

  function regroup() {
    const g = [];
    for (let col = 0; col < 2; col++) for (let sp = 1; sp <= 3; sp++) for (let band = 0; band < 3; band++) g.push({ col, sp, band, idx: [] });
    for (let i = 0; i < K; i++) {
      if (!SPC[i]) continue;
      const band = ZZ[i] < 0.57 ? 0 : ZZ[i] < 0.79 ? 1 : 2;
      g[CYN[i] * 9 + (SPC[i] - 1) * 3 + band].idx.push(i);
    }
    groups = g.filter((x) => x.idx.length).map((x) => ({ ...x, idx: Uint16Array.from(x.idx) }));
  }

  function ensureBonds(form) {
    const key = form + ":" + K;
    if (bondCache.has(key) || !targets) return;
    const t0 = performance.now();
    const R = Math.min(0.06, 0.028 * Math.sqrt(1900 / K));
    bondCache.set(key, buildBonds(targets[form], K, R));
    stats.bondMs += performance.now() - t0;
  }

  /* All of the expensive, size-independent work happens here, off the frame path. */
  function prepare() {
    idle(() => {
      const t0 = performance.now();
      targets = sampleOutlines();
      stats.sampleMs = performance.now() - t0;
      layoutParticles();
      readyAt = clock;
      let f = 0;
      const step = () => { if (f < 3) { ensureBonds(f++); idle(step); } else { onReady && onReady(stats); if (reduced) drawFrame(0, true); } };
      idle(step);
      if (reduced) drawFrame(0, true);
    });
  }

  function rebuild(w, h) {
    W = w; H = h;
    if (W < 1 || H < 1) return;
    dprScale = Math.min(window.devicePixelRatio || 1, DPR_CAP[level]);
    const pw = Math.round(W * dprScale), ph = Math.round(H * dprScale);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
    CX = W / 2; CY = H * 0.455; SC = Math.min(W, H) * 0.78;
    K = COUNT[level];
    layoutParticles(); regroup();
    if (targets) for (let f = 0; f < 3; f++) idle(() => ensureBonds(f));
    drawFrame(0, reduced);
  }

  /* ---- pointer lens (fine pointers only) ---- */
  let lx = -9999, ly = -9999, lxT = -9999, lyT = -9999;
  const LENS = 104, PUSH = 13;
  const ac = new AbortController();
  if (fine && !reduced) {
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      lxT = e.clientX - r.left; lyT = e.clientY - r.top;
    }, { passive: true, signal: ac.signal });
    canvas.addEventListener("pointerleave", () => { lxT = -9999; lyT = -9999; }, { signal: ac.signal });
  }

  const HC = [], HS = [];
  for (let v = 0; v < 6; v++) { HC.push(Math.cos((v / 6) * TAU)); HS.push(Math.sin((v / 6) * TAU)); }

  /* ---- one frame ---- */
  function drawFrame(dt, forceStatic) {
    if (!W || !ctx) return;
    const T = clock;
    let idx = 0, form = 0;
    if (forceStatic) { form = targets ? 1 : 0; }
    else if (readyAt >= 0) {
      const ct = T - readyAt, slot = ct / CYCLE;
      idx = Math.floor(slot) % 3;
      const lt = (slot - Math.floor(slot)) * CYCLE;
      form = sm(cl01(lt / HOLD_IN)) * (1 - sm(cl01((lt - (HOLD_IN + HOLD)) / HOLD_OUT)));
    }

    const k = form > 0.80 ? "Resolved" : form > 0.06 ? "Assembling" : "Sample field";
    const v = form > 0.06 ? FORM_NAMES[idx] : "dispersed";
    if (k !== lastK) { lastK = k; captionK.textContent = k; }
    if (v !== lastV) { lastV = v; captionV.textContent = v; }

    if (fine && !forceStatic) {
      const a = 1 - Math.exp(-dt * 7.6);
      lx = lx < -5000 ? lxT : lx + (lxT - lx) * a;
      ly = ly < -5000 ? lyT : ly + (lyT - ly) * a;
    }
    const lens = fine && lx > -5000;

    const inv = 1 - form, disp = inv;
    const tx = TX[idx], ty = TY[idx];
    const hasT = targets !== null && form > 0;
    const TW = 0.09;                                   // target wobble relative to dispersed wobble

    for (let i = 0; i < K; i++) {
      const sp = SP[i], ph = PH[i], am = AM[i] * SC;
      const wx = Math.sin(T * sp + ph) * am, wy = Math.cos(T * sp * 0.82 + ph * 1.3) * am;
      let x, y;
      if (hasT) { x = (DX[i] + wx) * inv + (tx[i] + wx * TW) * form; y = (DY[i] + wy) * inv + (ty[i] + wy * TW) * form; }
      else { x = DX[i] + wx; y = DY[i] + wy; }
      if (lens) {
        const px = x - lx, py = y - ly, d2 = px * px + py * py;
        if (d2 < LENS * LENS && d2 > 0.5) {
          const d = Math.sqrt(d2), kk = 1 - d / LENS;
          const push = kk * kk * PUSH * (0.45 + ZZ[i] * 0.55) / d;
          x += px * push; y += py * push;
        }
      }
      X[i] = x; Y[i] = y;
    }

    ctx.clearRect(0, 0, W, H);

    /* bonds: one path, only once the form has resolved */
    const ba = sm(sg(form, 0.84, 0.995));
    if (ba > 0.01) {
      const bl = bondCache.get(idx + ":" + K);
      if (bl) {
        const R = Math.min(0.06, 0.028 * Math.sqrt(1900 / K));
        const max2 = (R * SC * 1.55) * (R * SC * 1.55);
        ctx.beginPath();
        for (let b = 0; b < bl.length; b += 2) {
          const a = bl[b], c2 = bl[b + 1], ex = X[a] - X[c2], ey = Y[a] - Y[c2];
          if (ex * ex + ey * ey < max2) { ctx.moveTo(X[a], Y[a]); ctx.lineTo(X[c2], Y[c2]); }
        }
        ctx.globalAlpha = 0.34 * ba; ctx.strokeStyle = "rgb(0,180,231)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    /* microscope shapes: dispersed state only, batched by colour/species/depth band */
    if (disp > 0.02) {
      const sa = disp * disp, bandZ = [0.46, 0.68, 0.9];
      ctx.lineCap = "round";
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi], zc = bandZ[g.band];
        ctx.strokeStyle = g.col ? "rgb(0,180,231)" : "rgb(1,45,123)";
        ctx.globalAlpha = 0.34 * sa * zc;
        ctx.beginPath();
        for (let q = 0; q < g.idx.length; q++) {
          const i = g.idx[q], sz = ZZ[i] * (disp * 0.75 + 0.25), x = X[i], y = Y[i];
          ROT[i] += SPIN[i] * 0.96 * dt;
          if (g.sp === 1) { const r = 6.5 * sz + 3; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
          else if (g.sp === 2) {
            const c = Math.cos(ROT[i]) * 5 * sz, s = Math.sin(ROT[i]) * 5 * sz;
            ctx.moveTo(x - c, y - s); ctx.lineTo(x + c, y + s);
          } else {
            const cr = Math.cos(ROT[i]), sr = Math.sin(ROT[i]), R = 5.6 * sz + 2;
            for (let n = 0; n < 6; n++) {
              const vx = x + R * (HC[n] * cr - HS[n] * sr), vy = y + R * (HC[n] * sr + HS[n] * cr);
              n ? ctx.lineTo(vx, vy) : ctx.moveTo(vx, vy);
            }
            ctx.closePath();
          }
        }
        ctx.lineWidth = g.sp === 2 ? 2.6 * zc * (disp * 0.75 + 0.25) : 1;
        ctx.stroke();
      }
    }

    /* particles: two fills, one per brand colour */
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      for (let i = 0; i < K; i++) {
        if (CYN[i] !== pass) continue;
        const r = RD[i] + (RF[i] - RD[i]) * form;
        ctx.moveTo(X[i] + r, Y[i]); ctx.arc(X[i], Y[i], r, 0, TAU);
      }
      ctx.globalAlpha = pass ? 0.36 + form * 0.44 : 0.30 + form * 0.34;
      ctx.fillStyle = pass ? "rgb(0,180,231)" : "rgb(1,45,123)";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const task = {
    update(dt) { clock += dt; drawFrame(dt, false); },
    setQuality(l) {
      if (l === level && K === COUNT[l]) return;
      level = l;
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => rebuild(W, H), 0);
    },
  };

  // size comes from ResizeObserver; rebuilds are debounced and skipped when nothing material changed
  let rt = 0;
  ro = new ResizeObserver((en) => {
    const r = en[0].contentRect;
    if (W && Math.abs(r.width - W) < 1 && Math.abs(r.height - H) < 1) return;
    clearTimeout(rt);
    rt = setTimeout(() => rebuild(r.width, r.height), W ? 140 : 0);
  });
  ro.observe(canvas);
  prepare();

  let handle = null;
  if (!reduced) {
    handle = scheduler.add(task);
    io = new IntersectionObserver((en) => handle.setVisible(en[en.length - 1].isIntersecting), { rootMargin: "60px 0px" });
    io.observe(canvas);
  }

  return {
    stats,
    destroy() {
      clearTimeout(rt); clearTimeout(rebuildTimer);
      ac.abort(); ro.disconnect(); if (io) io.disconnect(); if (handle) handle.remove();
    },
  };
}
