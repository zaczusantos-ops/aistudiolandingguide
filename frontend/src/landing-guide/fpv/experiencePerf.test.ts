import { describe, expect, it } from 'vitest';
import {
  createAdaptiveResolution,
  MAX_PIXEL_RATIO,
  MAX_PROBE_DELAY_MS,
  MIN_ADAPTIVE_PIXEL_RATIO,
  PERF_WINDOW_MS,
  pickPixelRatio,
  PIXEL_RATIO_STEP,
  PROBE_DELAY_MS,
  resetAdaptiveWindow,
  setAdaptiveMaxRatio,
  updateAdaptiveResolution,
  WARMUP_MS,
  type AdaptiveResolution,
} from './experiencePerf';

/** Feeds `seconds` of frames at a constant interval; returns the ratio after each change. */
function run(s: AdaptiveResolution, frameMs: number, seconds: number): number[] {
  const changes: number[] = [];
  const n = Math.round((seconds * 1000) / frameMs);
  for (let i = 0; i < n; i++) if (updateAdaptiveResolution(s, frameMs)) changes.push(s.ratio);
  return changes;
}

/** Feeds frames at a constant interval until `count` measurement windows completed. */
function windows(s: AdaptiveResolution, frameMs: number, count: number): number[] {
  const changes: number[] = [];
  let done = 0;
  while (done < count) {
    if (updateAdaptiveResolution(s, frameMs)) changes.push(s.ratio);
    if (s.frames === 0 && s.skipMs <= 0) done++;
  }
  return changes;
}

/** A controller past its warm-up. */
function warm(maxRatio: number): AdaptiveResolution {
  const s = createAdaptiveResolution(maxRatio);
  run(s, 16.7, WARMUP_MS / 1000 + 0.05);
  return s;
}

describe('pickPixelRatio', () => {
  it('caps high-DPI screens at 1.25 and uses 1 in lowPower or for bad input', () => {
    expect(MAX_PIXEL_RATIO).toBe(1.25);
    expect(pickPixelRatio(2, false)).toBe(1.25);
    expect(pickPixelRatio(3, false)).toBe(1.25);
    expect(pickPixelRatio(1, false)).toBe(1);
    expect(pickPixelRatio(2, true)).toBe(1);
    expect(pickPixelRatio(Number.NaN, false)).toBe(1);
    expect(pickPixelRatio(0, false)).toBe(1);
  });
});

describe('adaptive resolution controller', () => {
  it('starts at the device ratio and ignores the warm-up and invalid samples', () => {
    const s = createAdaptiveResolution(1.25);
    expect(s.ratio).toBe(1.25);
    expect(s.minRatio).toBe(MIN_ADAPTIVE_PIXEL_RATIO);
    // Very slow first frames (program compilation) do not count.
    expect(run(s, 200, WARMUP_MS / 1000)).toEqual([]);
    expect(updateAdaptiveResolution(s, Number.NaN)).toBe(false);
    expect(updateAdaptiveResolution(s, -5)).toBe(false);
    expect(updateAdaptiveResolution(s, Number.POSITIVE_INFINITY)).toBe(false);
    expect(s.ratio).toBe(1.25);
  });

  it('holds a steady 60 Hz frame rate at full resolution', () => {
    const s = warm(1.25);
    expect(run(s, 16.7, 30)).toEqual([]);
    expect(s.ratio).toBe(1.25);
  });

  it('steps down once per ~1 s window while frames are slow, and never below the floor', () => {
    const s = warm(1.25);
    const changes = run(s, 25, 10);
    expect(changes).toEqual([1.125, 1, 0.875, 0.75]);
    expect(s.ratio).toBe(MIN_ADAPTIVE_PIXEL_RATIO);
    // A 1x screen has less room: it only goes down to the same floor.
    const t = warm(1);
    expect(run(t, 33.3, 10)).toEqual([0.875, 0.75]);
  });

  it('does not react to an isolated hitch', () => {
    const s = warm(1.25);
    run(s, 16.7, 0.5);
    updateAdaptiveResolution(s, 400); // GC pause / shader compile
    expect(run(s, 16.7, 5)).toEqual([]);
    expect(s.ratio).toBe(1.25);
  });

  it('keeps the ratio inside the 13–20 ms hysteresis band', () => {
    const s = warm(1.25);
    run(s, 25, 1.05); // one slow window: 1.25 → 1.125
    expect(s.ratio).toBe(1.125);
    // 18 ms is neither slow nor fast: no change until the probe delay has passed.
    expect(run(s, 18, PROBE_DELAY_MS / 1000 - 1.5)).toEqual([]);
    expect(s.ratio).toBe(1.125);
  });

  it('steps back up after two fast windows on a high-refresh screen', () => {
    const s = warm(1.25);
    run(s, 30, 3.1);
    expect(s.ratio).toBe(0.875);
    const changes = run(s, 8.3, 6.2);
    expect(changes).toEqual([1, 1.125, 1.25]);
    expect(run(s, 8.3, 5)).toEqual([]);
  });

  it('probes up on a 60 Hz screen and backs off exponentially when the probe fails', () => {
    const s = warm(1.25);
    expect(windows(s, 25, 1)).toEqual([1.125]);
    const probeWindows = PROBE_DELAY_MS / PERF_WINDOW_MS;
    // Vsync-limited (16.7 ms, never < 13 ms): after the probe delay it tries the next step up.
    expect(windows(s, 16.7, probeWindows - 1)).toEqual([]);
    expect(windows(s, 16.7, 1)).toEqual([1.25]);
    // The probe makes frames slow again: undone, and the next probe waits twice as long.
    expect(windows(s, 25, 1)).toEqual([1.125]);
    expect(s.probeDelayMs).toBe(PROBE_DELAY_MS * 2);
    expect(windows(s, 16.7, 2 * probeWindows - 1)).toEqual([]);
    expect(windows(s, 16.7, 1)).toEqual([1.25]);
    // Repeated failures saturate the back-off.
    for (let i = 0; i < 10; i++) {
      windows(s, 25, 1);
      windows(s, 16.7, s.probeDelayMs / PERF_WINDOW_MS);
    }
    expect(s.probeDelayMs).toBe(MAX_PROBE_DELAY_MS);
  });

  it('keeps a successful probe', () => {
    const s = warm(1.25);
    windows(s, 25, 1);
    expect(windows(s, 16.7, PROBE_DELAY_MS / PERF_WINDOW_MS + 1)).toEqual([1.25]);
    expect(run(s, 16.7, 20)).toEqual([]);
    expect(s.ratio).toBe(1.25);
    expect(s.probeDelayMs).toBe(PROBE_DELAY_MS);
  });

  it('restarts measuring with a warm-up after a reset (resume, resize, restored context)', () => {
    const s = warm(1.25);
    run(s, 25, 0.9); // almost a full slow window…
    resetAdaptiveWindow(s);
    // …discarded: the long first interval after a resume is skipped as warm-up.
    expect(updateAdaptiveResolution(s, 5000)).toBe(false);
    expect(run(s, 16.7, PERF_WINDOW_MS / 1000 + 0.1)).toEqual([]);
    expect(s.ratio).toBe(1.25);
  });

  it('follows a new device ratio when unthrottled and clamps when throttled', () => {
    const s = warm(1);
    expect(setAdaptiveMaxRatio(s, 1.25)).toBe(true);
    expect(s.ratio).toBe(1.25);
    run(s, 25, 2.1);
    expect(s.ratio).toBe(1);
    expect(setAdaptiveMaxRatio(s, 1.25)).toBe(false);
    // Moving to a 0.9x screen: the bounds shrink and the ratio is clamped into them.
    setAdaptiveMaxRatio(s, 0.9);
    expect(s.ratio).toBe(0.9);
    expect(s.minRatio).toBe(0.75);
    run(s, 25, 5);
    expect(s.ratio).toBeGreaterThanOrEqual(0.75);
    // A screen below the floor never steps (min = max).
    const low = warm(0.5);
    expect(run(low, 40, 5)).toEqual([]);
    expect(low.ratio).toBe(0.5);
  });

  it('moves in whole steps', () => {
    const s = warm(1.25);
    run(s, 25, 1.05);
    expect(1.25 - s.ratio).toBeCloseTo(PIXEL_RATIO_STEP, 10);
  });
});
