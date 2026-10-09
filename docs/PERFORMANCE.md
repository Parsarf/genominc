# Animation performance: method, findings, results

## Method
`tools/perf.cjs` drives headless Chromium (Playwright 1.64 API, Chromium build 1243 headless shell, macOS arm64,
viewport 1440×900 @2× DPR) with CDP CPU throttling (1×, 4×, 6×). It runs identical scenarios against the old and
new builds, measures frame intervals with its own rAF probe, long tasks with `PerformanceObserver`, and main-thread
busy time via `Performance.getMetrics`. Raw JSON for every run is in `docs/perf/`. "Before" is commit `8ef9f2f`.

## What profiling found in the original
1. **Duplicate and misdirected animation loops.** Every `visibilitychange` called `start()` for the hero strand and
   `mplay()` for the molecular field regardless of whether they were on screen. After one hide/show, rAF callbacks
   rose from 60/s to **120/s**, and with both canvases scrolled away the page still ran **60 rAF/s**.
2. **Cost scales with canvas pixels, not JavaScript.** Script time was only 2–6 % of the frame at 1×. At fixed quality
   levels in the new code (`tools/levels.cjs`) the molecular field costs 15 % / 28 % / 54 % main-thread time at
   490² / 735² / 980² px at 1× CPU, and at 4× throttle only the smallest canvas holds 60 fps. The original always used
   up to 2× DPR and 1,900 particles with no way to back off, so weak CPUs produced 47–71 ms frames.
3. **Per-frame waste:** per-dot `beginPath/arc/fill` plus `rgba()` string building (≈400 fills/frame in the hero strand),
   ~12 trig calls and object property access per particle, `save/translate/rotate/restore` for every microscope shape,
   a `getBoundingClientRect()` on every scroll event, and `textContent` writes to two captions on every frame.
4. **Timing bugs:** the molecular cycle was driven by absolute `performance.now()`, so it jumped after a pause;
   particle rotation advanced a fixed `0.016` per frame (twice as fast on 120 Hz).
5. **Start-up and resize work on the main thread:** outline sampling + bond building ran synchronously on load and on
   every debounced resize (long tasks of 92 + 53 ms at 4×, 201/204 ms at 6×); `backdrop-filter` blur on the sticky nav
   and caption sat over a continuously repainting canvas.

## What changed
* One `Scheduler` (single rAF loop). Per-canvas `IntersectionObserver` visibility and `document.hidden` are tracked
  separately; the loop exists only when both allow it, so there is never more than one pending callback and none when idle.
* Animation clocks advance by capped `dt` (≤ 50 ms): pausing costs nothing and resuming never jumps. Rotation is `dt`-based.
* Molecular field: typed arrays, no per-frame allocation, 2 trig calls per particle, dots/bonds/shapes batched into a few
  paths, captions updated only when the text changes, bond grid uses linked lists. Outline sampling and bonds run in
  `requestIdleCallback`, are cached per quality level, and are never repeated on resize (targets are size-independent).
* Hero strand: dots batched into 8 depth buckets per strand, colour set once, edge fade moved to a CSS mask, no layout reads.
* Quality levels (particles 560/960/1600; canvas DPR cap 1/1.5/2; strand DPR cap 1/1.25/1.5) chosen from device hints, then
  adjusted from measured frame intervals: 2 slow windows (~1 s) or one severe window (8 frames > 40 ms) steps down; stepping
  up needs ~4 s of healthy frames and 12 s since the last change, and a step down permanently lowers the ceiling to prevent
  oscillation. Phones are capped at level 1.
* `ResizeObserver` replaces window resize handlers; observers are created once; `destroy()` is available for every module.
* `prefers-reduced-motion`: no loops at all; the strand and the analyser are drawn once (0 rAF calls verified).
* Removed: nav/caption blur, floating badges, count-up animation, marquee, scroll-drawn connector lines.

## Results (same scenarios, same machine)
Frame interval in ms (60 fps = 16.7). "Frames > 33 ms" counts frames that lost at least one full frame.
Long-task ms is the total time in tasks over 50 ms. rAF/s is page callbacks per second (the harness's own probe excluded).

#### CPU throttle 1×

| Scenario | Before: mean / p95 / max ms | Before: frames >33 ms · long-task ms · rAF/s | After: mean / p95 / max ms | After: frames >33 ms · long-task ms · rAF/s |
|---|---|---|---|---|
| Hero strand, idle | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.2 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.2 |
| Molecular field, idle | 16.69 / 16.8 / 33.3 | 0 · 0 · 60.1 | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.1 |
| Scroll top→bottom | 16.73 / 16.7 / 33.3 | 0 · 0 · 78.9 | 16.67 / 16.7 / 16.8 | 0 · 0 · 40.2 |
| Enter/leave About ×8 | 16.67 / 16.7 / 16.8 | 0 · 0 · 62.7 | 16.67 / 16.7 / 16.8 | 0 · 0 · 61.3 |
| After tab hide→show | 16.67 / 16.8 / 16.8 | 0 · 0 · 120.5 | 17.09 / 16.8 / 66.6 | 3 · 63 · 58.8 |
| After 6 hide/show cycles | 16.67 / 16.7 / 16.8 | 0 · 0 · 120.5 | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.3 |
| Both canvases off-screen | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.3 | 16.76 / 16.8 / 33.4 | 1 · 0 · 0 |
| Resize storm (7 sizes) | 17.01 / 16.8 / 33.4 | 3 · 0 · 95 | 16.83 / 16.8 / 33.4 | 0 · 0 · 53.4 |
| Phone 390px, molecular | 16.67 / 16.8 / 16.8 | 0 · 0 · 120.3 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.2 |

Load-time long tasks (ms): before [], after [].

#### CPU throttle 4×

| Scenario | Before: mean / p95 / max ms | Before: frames >33 ms · long-task ms · rAF/s | After: mean / p95 / max ms | After: frames >33 ms · long-task ms · rAF/s |
|---|---|---|---|---|
| Hero strand, idle | 16.71 / 16.8 / 33.4 | 0 · 0 · 60 | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.2 |
| Molecular field, idle | 46.83 / 66.7 / 166.7 | 155 · 2859 · 21.7 | 17.54 / 33.2 / 33.4 | 3 · 0 · 57.2 |
| Scroll top→bottom | 25.66 / 50 / 66.7 | 38 · 314 · 59.8 | 16.67 / 16.8 / 16.8 | 0 · 0 · 40.4 |
| Enter/leave About ×8 | 26.27 / 50.1 / 66.8 | 59 · 1633 · 40.8 | 16.67 / 16.7 / 16.8 | 0 · 0 · 61.3 |
| After tab hide→show | 59.95 / 66.8 / 83.4 | 66 · 3494 · 34 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.3 |
| After 6 hide/show cycles | 55.02 / 66.7 / 100 | 72 · 2594 · 37 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.3 |
| Both canvases off-screen | 17.64 / 33.3 / 33.4 | 1 · 0 · 57.3 | 16.67 / 16.8 / 16.8 | 0 · 0 · 0 |
| Resize storm (7 sizes) | 35.46 / 100 / 183.3 | 47 · 1268 · 39.8 | 17.24 / 16.8 / 66.6 | 4 · 0 · 52.2 |
| Phone 390px, molecular | 21.58 / 33.4 / 50 | 18 · 0 · 93 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.2 |

Load-time long tasks (ms): before [92, 53], after [].

#### CPU throttle 6×

| Scenario | Before: mean / p95 / max ms | Before: frames >33 ms · long-task ms · rAF/s | After: mean / p95 / max ms | After: frames >33 ms · long-task ms · rAF/s |
|---|---|---|---|---|
| Hero strand, idle | 19.42 / 33.4 / 50.1 | 10 · 0 · 51.7 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.2 |
| Molecular field, idle | 71.39 / 83.4 / 100.1 | 141 · 9896 · 14.2 | 18.86 / 33.3 / 116.7 | 18 · 739 · 53.2 |
| Scroll top→bottom | 34.34 / 83.3 / 100.1 | 40 · 2302 · 44.7 | 16.67 / 16.7 / 16.8 | 0 · 0 · 43.8 |
| Enter/leave About ×8 | 42.98 / 99.9 / 100.1 | 68 · 3521 · 26 | 16.67 / 16.7 / 16.8 | 0 · 0 · 61.3 |
| After tab hide→show | 76.1 / 100 / 100.1 | 53 · 3922 · 27 | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.3 |
| After 6 hide/show cycles | 93.02 / 133.4 / 149.9 | 43 · 3989 · 22 | 16.67 / 16.7 / 16.8 | 0 · 0 · 60.3 |
| Both canvases off-screen | 38.89 / 50.1 / 66.8 | 37 · 339 · 26.3 | 16.67 / 16.8 / 16.8 | 0 · 0 · 0 |
| Resize storm (7 sizes) | 213.18 / 400.1 / 933.3 | 22 · 3683 · 9.8 | 17.67 / 16.8 / 83.3 | 5 · 0 · 50.6 |
| Phone 390px, molecular | 38.82 / 50.1 / 66.7 | 66 · 903 · 52 | 16.67 / 16.8 / 16.8 | 0 · 0 · 60.2 |

Load-time long tasks (ms): before [201, 69, 204, 141, 119], after [54].

## Reading the results
* At **1×** the old code also held 60 fps in this environment; the visible defects were the duplicated loops (120 rAF/s after
  hide/show), animation running while off-screen (60 rAF/s with both canvases hidden, now 0), and main-thread cost.
* At **4×/6×** the old molecular field produced 47–71 ms mean frames, 2.9–9.9 s of long tasks in 10 s, and a 0.9 s frame
  during resize. The new build steps down within a couple of seconds; at 4× it settles at 17–18 ms mean with no long tasks,
  at 6× at ~19 ms mean after a ~0.7 s adaptation burst (739 ms of long tasks in the first 10 s, all while stepping down).
* The remaining dropped frames are concentrated in the adaptation window and resize rebuilds, not steady state.

## Limitations
* Headless Chromium with software rasterisation, one Apple-silicon machine, synthetic CPU throttling. It captures CPU and
  fill cost but not real GPU canvas acceleration, thermal throttling, or a 120 Hz display. **Real-device numbers (mid-range
  Android, older iPhone) have not been taken and should be before launch.**
* Tab hide/show is emulated by overriding `document.hidden` and dispatching `visibilitychange`; it exercises the handlers but
  not the browser's real background throttling.
* The first run after an emulated hide/show at 1× showed one 66 ms frame (3 frames > 33 ms), the only regression in the table;
  it is not reproduced in later cycles or at 4×/6×.
* DevTools trace files were not retained; the JSON metrics above are the record.
* No Web Worker / OffscreenCanvas was added: script time is 2–5 % of the frame, so measurement did not justify it.

## Update: particle field replaced by an SVG specimen plate
The About-section canvas (`molecular.js`, up to 1,600 particles morphing into an analyser, capsule and paw) was removed.
Its replacement (`assets/js/plate.js`, SVG + CSS) has no canvas and no `requestAnimationFrame` loop: strokes trace in with
`stroke-dashoffset` transitions, the frame rotates/scans with CSS animations that are paused while the plate is off screen,
and tab autoplay is driven by a CSS progress animation (`animationend`). The numbers above describe the old field and are
kept as the historical baseline; `tools/levels.cjs` and `tools/forms.cjs` (which measured it) were deleted with it.
Reduced motion: no animations and no autoplay; tabs still switch figures.
