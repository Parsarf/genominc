/*
 * One requestAnimationFrame loop for every canvas on the page.
 *
 * - A task only receives frames while it is on screen AND the document is
 *   visible. Those two signals are tracked separately; a visibilitychange can
 *   therefore never restart an animation that is scrolled out of view.
 * - The loop itself is only scheduled while at least one task is active, so
 *   there is never more than one pending frame callback and none while idle.
 * - Tasks receive a capped delta (seconds). They advance their own clocks with
 *   it, so a hidden tab, a long task or a dropped frame never makes motion jump.
 * - A small quality controller watches the real frame interval and moves a
 *   shared quality level (0 low, 1 medium, 2 high) with hysteresis.
 */

const MAX_DT = 0.05;          // never advance animation by more than 50 ms in one frame
const WINDOW = 30;            // frames per measurement window
const SEVERE_MS = 40;         // a mean this high over just SEVERE_N frames steps down immediately
const SEVERE_N = 8;
const WARMUP = 12;            // ignore frames right after (re)starting; first frames are noisy
const SLOW_MS = 20;           // window mean above this (below ~50 fps) counts as slow
const FAST_MS = 18.5;         // window mean below this counts as healthy
const SLOW_WINDOWS = 2;       // consecutive slow windows before stepping down
const FAST_WINDOWS = 8;       // consecutive healthy windows (~4 s) before stepping up
const UP_COOLDOWN_MS = 12000; // minimum time after any change before stepping up

export function initialQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const narrow = Math.min(innerWidth, innerHeight) < 700;
  const saveData = navigator.connection && navigator.connection.saveData;
  let max = narrow ? 1 : 2;
  let start = 1;
  if (!narrow && cores >= 8 && mem >= 8) start = 2;
  if (cores <= 4 && mem <= 2) start = 0;
  if (saveData) { start = 0; max = 0; }
  return { start: Math.min(start, max), max };
}

export class Scheduler {
  constructor({ quality } = {}) {
    const q = quality || initialQuality();
    this.level = q.start;
    this.ceiling = q.max;          // lowered whenever a step up proves unstable
    this.tasks = new Set();
    this.active = new Set();
    this.raf = 0;
    this.last = 0;
    this.docVisible = !document.hidden;
    this.sum = 0; this.n = 0; this.warm = 0;
    this.slow = 0; this.fast = 0;
    this.lastChange = -Infinity;
    this._tick = this._tick.bind(this);
    this._onVis = () => { this.docVisible = !document.hidden; this._sync(); };
    document.addEventListener("visibilitychange", this._onVis);
  }

  /** task: { update(dt, now), setQuality?(level) } */
  add(task) {
    task.visible = false;
    this.tasks.add(task);
    if (task.setQuality) task.setQuality(this.level);
    return {
      setVisible: (v) => this.setVisible(task, v),
      remove: () => { this.tasks.delete(task); this.active.delete(task); this._sync(); },
    };
  }

  setVisible(task, v) {
    task.visible = v;
    v ? this.active.add(task) : this.active.delete(task);
    this._sync();
  }

  _sync() {
    const run = this.docVisible && this.active.size > 0;
    if (run && !this.raf) {
      this.last = 0; this.n = 0; this.sum = 0; this.warm = WARMUP;
      this.raf = requestAnimationFrame(this._tick);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0; this.last = 0;
    }
  }

  _tick(now) {
    this.raf = requestAnimationFrame(this._tick);
    const raw = this.last ? now - this.last : 0;
    this.last = now;
    const dt = Math.min(raw / 1000, MAX_DT);
    for (const t of this.active) t.update(dt, now);
    if (raw) this._measure(raw, now);
  }

  _measure(raw, now) {
    if (this.warm > 0) { this.warm--; return; }
    this.sum += Math.min(raw, 250); this.n++;
    if (this.n === SEVERE_N && this.sum / SEVERE_N > SEVERE_MS && this.level > 0) {
      this.ceiling = Math.min(this.ceiling, this.level - 1);
      this._set(this.level - 1, now);
      this.sum = 0; this.n = 0; this.slow = 0; this.fast = 0;
      return;
    }
    if (this.n < WINDOW) return;
    const mean = this.sum / this.n;
    this.sum = 0; this.n = 0;

    if (mean > SLOW_MS) {
      this.fast = 0;
      if (++this.slow >= SLOW_WINDOWS && this.level > 0) {
        // Whatever level we were at is not sustainable on this device: never go back up to it.
        this.ceiling = Math.min(this.ceiling, this.level - 1);
        this._set(this.level - 1, now);
        this.slow = 0;
      }
    } else if (mean < FAST_MS) {
      this.slow = 0;
      if (++this.fast >= FAST_WINDOWS && this.level < this.ceiling && now - this.lastChange > UP_COOLDOWN_MS) {
        this._set(this.level + 1, now);
        this.fast = 0;
      }
    } else { this.slow = 0; this.fast = 0; }
  }

  _set(level, now) {
    this.level = level; this.lastChange = now; this.warm = WARMUP * 2;
    for (const t of this.tasks) if (t.setQuality) t.setQuality(level);
  }

  destroy() {
    document.removeEventListener("visibilitychange", this._onVis);
    cancelAnimationFrame(this.raf); this.raf = 0;
    this.tasks.clear(); this.active.clear();
  }
}
