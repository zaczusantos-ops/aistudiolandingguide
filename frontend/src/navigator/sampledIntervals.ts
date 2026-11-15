/** Extent between matching saved instants, not a measured continuous event. */
export interface SampledSpan {
  startEpochIdx: number;
  endEpochIdx: number;
  hours: number;
  /** No known nonmatching sample immediately before this run. */
  leftCensored: boolean;
  /** No known nonmatching sample immediately after this run. */
  rightCensored: boolean;
}

interface ObservedSampledRuns {
  /** Actual time between the first and last saved instants; one instant is 0 h. */
  elapsedHours: number;
  /** Includes zero-hour singleton runs; not a count of resolved physical events. */
  matchingRunCount: number;
  longestMatchingSpan: SampledSpan | null;
}

export type SampledRunAnalysis =
  | (ObservedSampledRuns & { status: 'known'; unknownSamples: 0 })
  | (ObservedSampledRuns & { status: 'unknown'; reason: 'incomplete-samples'; unknownSamples: number })
  | {
    status: 'unknown';
    reason: 'empty-input' | 'length-mismatch' | 'invalid-timestamps';
    elapsedHours: null;
    matchingRunCount: null;
    unknownSamples: null;
    longestMatchingSpan: null;
  };

export type SavedSeriesIntegral =
  | { status: 'known'; elapsedHours: number; valueHours: number }
  | {
    status: 'unknown';
    reason: 'empty-input' | 'length-mismatch' | 'invalid-timestamps' | 'invalid-values' | 'single-sample' | 'nonfinite-result';
    elapsedHours: number | null;
    valueHours: null;
  };

function unavailable(reason: 'empty-input' | 'length-mismatch' | 'invalid-timestamps'): SampledRunAnalysis {
  return { status: 'unknown', reason, elapsedHours: null, matchingRunCount: null, unknownSamples: null, longestMatchingSpan: null };
}

/** Calendar-valid ISO UTC instants; nonuniform positive time steps are supported. */
function readAxis(timestamps: readonly string[]): number[] | null {
  const times: number[] = [];
  for (const stamp of timestamps) {
    if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp)) return null;
    const time = Date.parse(stamp);
    if (!Number.isFinite(time)
      || new Date(time).toISOString().replace('.000Z', 'Z') !== stamp.replace('.000Z', 'Z')
      || (times.length > 0 && time <= times[times.length - 1])) return null;
    times.push(time);
  }
  return times;
}

/**
 * Measure spans of TRUE samples on their actual saved time axis. To measure a
 * shadow or visibility-gap run, the caller supplies TRUE for that state, leaving
 * unavailable flags null. No state or extra interval is invented after the last
 * sample; 721 hourly matching points span 720 hours, and one point spans zero.
 *
 * Missing/nonboolean flags are unknown, split runs, and censor adjacent extents.
 * Unknown input is never reported as a known zero. With incomplete samples, the
 * returned runs describe only confirmed fragments and may omit a longer run.
 * Boundary censoring means the saved data do not bound that side of the run.
 * Even when both sides are bounded, transition times and continuous physical
 * duration between observations are not established. Nonuniform adjacent saved
 * instants remain adjacent observations; this function does not fill their gap.
 */
export function analyzeSampledRuns(
  timestamps: readonly string[], matches: readonly (boolean | null)[],
): SampledRunAnalysis {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return unavailable('empty-input');
  if (!Array.isArray(matches) || matches.length !== timestamps.length) return unavailable('length-mismatch');
  const times = readAxis(timestamps);
  if (!times) return unavailable('invalid-timestamps');

  let unknownSamples = 0;
  let matchingRunCount = 0;
  let start: number | null = null;
  let longestMatchingSpan: SampledSpan | null = null;
  const isKnown = (index: number): boolean => typeof matches[index] === 'boolean';
  const closeRun = (end: number) => {
    if (start === null) return;
    const span: SampledSpan = {
      startEpochIdx: start,
      endEpochIdx: end,
      hours: (times[end] - times[start]) / 3_600_000,
      leftCensored: start === 0 || !isKnown(start - 1),
      rightCensored: end === times.length - 1 || !isKnown(end + 1),
    };
    matchingRunCount++;
    // Prefer the earliest run when sampled extents have equal length.
    if (longestMatchingSpan === null || span.hours > longestMatchingSpan.hours) longestMatchingSpan = span;
    start = null;
  };

  for (let i = 0; i < matches.length; i++) {
    if (matches[i] === true) {
      if (start === null) start = i;
    } else {
      closeRun(i - 1);
      if (!isKnown(i)) unknownSamples++;
    }
  }
  closeRun(times.length - 1);

  const observed: ObservedSampledRuns = {
    elapsedHours: (times[times.length - 1] - times[0]) / 3_600_000,
    matchingRunCount, longestMatchingSpan,
  };
  return unknownSamples > 0
    ? { ...observed, status: 'unknown', reason: 'incomplete-samples', unknownSamples }
    : { ...observed, status: 'known', unknownSamples: 0 };
}

/**
 * Trapezoidal approximation over adjacent saved instants, using their actual
 * elapsed hours. Units are the caller's value unit multiplied by hours. This
 * assumes linear variation between observations; it does not resolve events or
 * establish physical output. Boolean states mapped to 0/1 likewise yield an
 * interpolated estimate, not exact time in that state. There is no final +dt.
 * One instant cannot establish an integral and remains unknown, not zero.
 */
export function integrateSavedSeries(
  timestamps: readonly string[], values: readonly number[],
): SavedSeriesIntegral {
  const unknownIntegral = (
    reason: Extract<SavedSeriesIntegral, { status: 'unknown' }>['reason'], elapsedHours: number | null = null,
  ): SavedSeriesIntegral => ({ status: 'unknown', reason, elapsedHours, valueHours: null });
  if (!Array.isArray(timestamps) || timestamps.length === 0) return unknownIntegral('empty-input');
  if (!Array.isArray(values) || values.length !== timestamps.length) return unknownIntegral('length-mismatch');
  const times = readAxis(timestamps);
  if (!times) return unknownIntegral('invalid-timestamps');
  const elapsedHours = (times[times.length - 1] - times[0]) / 3_600_000;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return unknownIntegral('invalid-values', elapsedHours);
  }
  if (times.length === 1) return unknownIntegral('single-sample', 0);

  let valueHours = 0;
  for (let i = 1; i < times.length; i++) {
    // Halve before adding so two large finite endpoints do not overflow their mean.
    valueHours += (values[i - 1] / 2 + values[i] / 2) * ((times[i] - times[i - 1]) / 3_600_000);
    if (!Number.isFinite(valueHours)) return unknownIntegral('nonfinite-result', elapsedHours);
  }
  return { status: 'known', elapsedHours, valueHours };
}
