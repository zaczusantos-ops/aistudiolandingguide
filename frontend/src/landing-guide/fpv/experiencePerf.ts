/**
 * Frame-rate safeguards for the first-person view: the device pixel ratio cap and a small adaptive
 * resolution controller. Pure functions on plain state (no three.js, no DOM) so they can be unit-tested
 * and called every frame without allocating.
 *
 * Why: the terrain shader does several anisotropic texture lookups plus a sheen term per pixel and the
 * canvas is multisampled, so fill rate is the only real 60 fps risk. When frames get slow the controller
 * lowers the renderer pixel ratio one step at a time (down to MIN_ADAPTIVE_PIXEL_RATIO) and raises it
 * again when there is headroom.
 *
 * - Frame time is the requestAnimationFrame interval averaged over ~1 s windows. Single samples are
 *   clamped (MAX_SAMPLE_MS) so a hitch (shader compile, GC, tab switch) cannot trigger a step.
 * - Hysteresis: down when a window averages > SLOW_FRAME_MS, up when two consecutive windows average
 *   < FAST_FRAME_MS, hold in between.
 * - The rAF interval cannot drop below the display refresh (16.7 ms at 60 Hz), so on a 60 Hz screen
 *   "< 13 ms" never happens. After a slowdown the controller therefore also probes one step up when it
 *   has held steady for a while; a probe that turns the next window slow is undone and the next probe
 *   waits twice as long (exponential back-off), so it settles instead of oscillating.
 * - Browsers that cap rAF at 30 Hz (power-saving modes) settle at the lowest ratio, which only softens
 *   the image and saves power there.
 * Callers keep it off for deterministic captures (debug pose).
 */

/** Device pixel ratio cap: high-DPI screens render at most 1.25 device px per CSS px. */
export const MAX_PIXEL_RATIO = 1.25;
/** Lowest pixel ratio the adaptive controller may use. */
export const MIN_ADAPTIVE_PIXEL_RATIO = 0.75;
export const PIXEL_RATIO_STEP = 0.125;
/** Length of one measurement window (ms of frames). */
export const PERF_WINDOW_MS = 1000;
/** A window whose mean frame time is above this lowers the resolution (< 50 fps). */
export const SLOW_FRAME_MS = 20;
/** Two consecutive windows below this raise the resolution (> ~77 fps, high-refresh screens). */
export const FAST_FRAME_MS = 13;
/** Single frame intervals are clamped to this before averaging. */
export const MAX_SAMPLE_MS = 50;
/** Frames ignored after a (re)start: first frames upload textures and compile programs. */
export const WARMUP_MS = 1000;
/** First wait (ms) before probing one step up after a slowdown; doubles after each failed probe. */
export const PROBE_DELAY_MS = 8000;
export const MAX_PROBE_DELAY_MS = 64000;
const FAST_WINDOWS_TO_STEP_UP = 2;

/** Pixel ratio for the renderer before any adaptation: the device ratio, capped (1 in lowPower). */
export function pickPixelRatio(devicePixelRatio: number, lowPower: boolean): number {
  if (lowPower) return 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, MAX_PIXEL_RATIO);
}

export interface AdaptiveResolution {
  /** Pixel ratio to apply to the renderer. */
  ratio: number;
  /** Upper bound (the capped device pixel ratio). */
  maxRatio: number;
  /** Lower bound: MIN_ADAPTIVE_PIXEL_RATIO, or maxRatio when that is already lower. */
  minRatio: number;
  /** Measurement window accumulators. */
  windowMs: number;
  sumMs: number;
  frames: number;
  /** Remaining warm-up time (ms) during which frames are ignored. */
  skipMs: number;
  /** Total measured time (ms); the probe schedule is expressed on this clock. */
  clockMs: number;
  fastWindows: number;
  /** The last change was a step up that has not been confirmed by a following window yet. */
  pendingUp: boolean;
  nextProbeAtMs: number;
  probeDelayMs: number;
}

function boundsFor(maxRatio: number): { max: number; min: number } {
  const max = Number.isFinite(maxRatio) && maxRatio > 0 ? maxRatio : 1;
  return { max, min: Math.min(max, MIN_ADAPTIVE_PIXEL_RATIO) };
}

export function createAdaptiveResolution(maxRatio: number): AdaptiveResolution {
  const { max, min } = boundsFor(maxRatio);
  return {
    ratio: max,
    maxRatio: max,
    minRatio: min,
    windowMs: 0,
    sumMs: 0,
    frames: 0,
    skipMs: WARMUP_MS,
    clockMs: 0,
    fastWindows: 0,
    pendingUp: false,
    nextProbeAtMs: 0,
    probeDelayMs: PROBE_DELAY_MS,
  };
}

/**
 * Starts a fresh measurement window with a warm-up (after resuming from a hidden tab, a restored GL
 * context or a resize), keeping the current ratio.
 */
export function resetAdaptiveWindow(s: AdaptiveResolution): void {
  s.windowMs = 0;
  s.sumMs = 0;
  s.frames = 0;
  s.skipMs = WARMUP_MS;
  s.fastWindows = 0;
  s.pendingUp = false;
}

/**
 * Updates the upper bound (e.g. the device pixel ratio changed). An unthrottled controller follows the
 * new maximum; a throttled one only gets clamped into the new range. Returns true when `ratio` changed.
 */
export function setAdaptiveMaxRatio(s: AdaptiveResolution, maxRatio: number): boolean {
  const { max, min } = boundsFor(maxRatio);
  if (max === s.maxRatio) return false;
  const prev = s.ratio;
  const wasAtMax = s.ratio >= s.maxRatio;
  s.maxRatio = max;
  s.minRatio = min;
  s.ratio = wasAtMax ? max : Math.min(max, Math.max(min, s.ratio));
  return s.ratio !== prev;
}

const roundRatio = (r: number) => Math.round(r * 1000) / 1000;

/**
 * Feeds one frame interval (ms). Returns true when `s.ratio` changed and must be applied to the
 * renderer. Allocation-free; non-finite or non-positive intervals are ignored.
 */
export function updateAdaptiveResolution(s: AdaptiveResolution, frameMs: number): boolean {
  if (!(frameMs > 0) || !Number.isFinite(frameMs)) return false;
  if (s.skipMs > 0) {
    s.skipMs -= frameMs;
    return false;
  }
  s.clockMs += frameMs;
  s.windowMs += frameMs;
  s.sumMs += Math.min(frameMs, MAX_SAMPLE_MS);
  s.frames += 1;
  if (s.windowMs < PERF_WINDOW_MS) return false;

  const avg = s.sumMs / s.frames;
  s.windowMs = 0;
  s.sumMs = 0;
  s.frames = 0;
  const prev = s.ratio;

  if (avg > SLOW_FRAME_MS) {
    s.fastWindows = 0;
    if (s.pendingUp) {
      // The last step up made frames slow: undo it and wait longer before the next probe.
      s.probeDelayMs = Math.min(s.probeDelayMs * 2, MAX_PROBE_DELAY_MS);
      s.pendingUp = false;
    }
    s.ratio = roundRatio(Math.max(s.minRatio, s.ratio - PIXEL_RATIO_STEP));
    if (s.ratio !== prev) s.nextProbeAtMs = s.clockMs + s.probeDelayMs;
  } else if (avg < FAST_FRAME_MS) {
    s.pendingUp = false;
    s.fastWindows += 1;
    if (s.fastWindows >= FAST_WINDOWS_TO_STEP_UP && s.ratio < s.maxRatio) {
      s.fastWindows = 0;
      s.ratio = roundRatio(Math.min(s.maxRatio, s.ratio + PIXEL_RATIO_STEP));
      s.pendingUp = true;
    }
  } else {
    // Hold band. A step up that lands here is kept; a long steady period allows a probe.
    s.fastWindows = 0;
    s.pendingUp = false;
    if (s.ratio < s.maxRatio && s.clockMs >= s.nextProbeAtMs) {
      s.ratio = roundRatio(Math.min(s.maxRatio, s.ratio + PIXEL_RATIO_STEP));
      s.pendingUp = true;
      s.nextProbeAtMs = s.clockMs + s.probeDelayMs;
    }
  }
  return s.ratio !== prev;
}
