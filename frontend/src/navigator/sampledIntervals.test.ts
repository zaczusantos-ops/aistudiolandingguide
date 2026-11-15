import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { analyzeSampledRuns, integrateSavedSeries } from './sampledIntervals';

/** Synthetic axes below exercise time arithmetic, not modeled lunar conditions. */
const hours = (...offsets: number[]): string[] => offsets.map(value => new Date(Date.UTC(2026, 10, 15) + value * 3_600_000).toISOString());

describe('saved-sample spans', () => {
  it('measures the actual 721-point dataset as 720 hours without a final extra step', () => {
    const timestamps = rawDataset.mission_window.timestamps_utc;
    expect(timestamps).toHaveLength(721);
    // TRUE denotes the shadow/gap state being measured, not illumination.
    expect(analyzeSampledRuns(timestamps, timestamps.map(() => true))).toEqual({
      status: 'known', elapsedHours: 720, matchingRunCount: 1, unknownSamples: 0,
      longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 720, hours: 720, leftCensored: true, rightCensored: true },
    });
  });

  it('measures a single matching instant as a censored zero-hour extent, with no invented interval', () => {
    const last = rawDataset.mission_window.timestamps_utc.at(-1)!;
    expect(analyzeSampledRuns([last], [true])).toEqual({
      status: 'known', elapsedHours: 0, matchingRunCount: 1, unknownSamples: 0,
      longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 0, hours: 0, leftCensored: true, rightCensored: true },
    });
    expect(analyzeSampledRuns([last], [false])).toEqual({
      status: 'known', elapsedHours: 0, matchingRunCount: 0, unknownSamples: 0, longestMatchingSpan: null,
    });
  });

  it('keeps known transitions outside the matching sampled extent', () => {
    expect(analyzeSampledRuns(hours(0, 1, 2, 3, 4), [false, true, true, true, false])).toEqual({
      status: 'known', elapsedHours: 4, matchingRunCount: 1, unknownSamples: 0,
      longestMatchingSpan: { startEpochIdx: 1, endEpochIdx: 3, hours: 2, leftCensored: false, rightCensored: false },
    });
    expect(analyzeSampledRuns(hours(0, 1, 2), [false, true, false])).toMatchObject({
      matchingRunCount: 1,
      longestMatchingSpan: { startEpochIdx: 1, endEpochIdx: 1, hours: 0, leftCensored: false, rightCensored: false },
    });
  });

  it('does not count known nonmatching intervals as a run', () => {
    expect(analyzeSampledRuns(hours(0, 1, 2), [false, false, false])).toEqual({
      status: 'known', elapsedHours: 2, matchingRunCount: 0, unknownSamples: 0, longestMatchingSpan: null,
    });
  });

  it('marks censorship independently at either saved-data boundary', () => {
    expect(analyzeSampledRuns(hours(0, 1, 2), [true, true, false])).toMatchObject({
      longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 1, hours: 1, leftCensored: true, rightCensored: false },
    });
    expect(analyzeSampledRuns(hours(0, 1, 2), [false, true, true])).toMatchObject({
      longestMatchingSpan: { startEpochIdx: 1, endEpochIdx: 2, hours: 1, leftCensored: false, rightCensored: true },
    });
  });

  it('splits at unknown samples and censors both neighboring fragments', () => {
    const timestamps = hours(0, 1, 2, 3, 4, 5);
    const result = analyzeSampledRuns(timestamps, [true, true, null, true, true, true]);
    expect(result).toEqual({
      status: 'unknown', reason: 'incomplete-samples', elapsedHours: 5, matchingRunCount: 2, unknownSamples: 1,
      longestMatchingSpan: { startEpochIdx: 3, endEpochIdx: 5, hours: 2, leftCensored: true, rightCensored: true },
    });
    expect(analyzeSampledRuns(timestamps, [false, true, true, null, false, false])).toMatchObject({
      status: 'unknown', matchingRunCount: 1, unknownSamples: 1,
      longestMatchingSpan: { startEpochIdx: 1, endEpochIdx: 2, hours: 1, leftCensored: false, rightCensored: true },
    });
  });

  it('retains incompleteness when no matching sample was confirmed', () => {
    expect(analyzeSampledRuns(hours(0, 1, 2), [null, false, null])).toEqual({
      status: 'unknown', reason: 'incomplete-samples', elapsedHours: 2,
      matchingRunCount: 0, unknownSamples: 2, longestMatchingSpan: null,
    });
    expect(analyzeSampledRuns(hours(0), [null])).toMatchObject({
      status: 'unknown', elapsedHours: 0, unknownSamples: 1, longestMatchingSpan: null,
    });
  });

  it('uses actual positive time differences for nonuniform adjacent observations', () => {
    expect(analyzeSampledRuns(hours(0, 0.5, 2, 3, 6.25), [true, true, false, true, true])).toEqual({
      status: 'known', elapsedHours: 6.25, matchingRunCount: 2, unknownSamples: 0,
      longestMatchingSpan: { startEpochIdx: 3, endEpochIdx: 4, hours: 3.25, leftCensored: false, rightCensored: true },
    });
    // These are two observations; no intermediate flags or exact event were filled in.
    expect(analyzeSampledRuns(hours(0, 24), [true, true])).toMatchObject({
      elapsedHours: 24, longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 1, hours: 24 },
    });
  });

  it('chooses the earliest run when matching sampled extents tie', () => {
    expect(analyzeSampledRuns(hours(0, 1, 2, 3, 4), [true, true, false, true, true])).toMatchObject({
      matchingRunCount: 2, longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 1, hours: 1 },
    });
  });

  it('never coerces sparse or nonboolean flags into a known false result', () => {
    const malformed = [true, undefined, 'yes', false] as unknown as (boolean | null)[];
    expect(analyzeSampledRuns(hours(0, 1, 2, 3), malformed)).toMatchObject({
      status: 'unknown', reason: 'incomplete-samples', unknownSamples: 2,
      longestMatchingSpan: { startEpochIdx: 0, endEpochIdx: 0, hours: 0, rightCensored: true },
    });
  });

  it('does not invent measured zeros for empty or misaligned inputs', () => {
    expect(analyzeSampledRuns([], [])).toEqual({
      status: 'unknown', reason: 'empty-input', elapsedHours: null,
      matchingRunCount: null, unknownSamples: null, longestMatchingSpan: null,
    });
    expect(analyzeSampledRuns(hours(0, 1), [true])).toEqual({
      status: 'unknown', reason: 'length-mismatch', elapsedHours: null,
      matchingRunCount: null, unknownSamples: null, longestMatchingSpan: null,
    });
  });

  it('rejects invalid, duplicate, reversed or non-UTC instants', () => {
    for (const timestamps of [
      ['invalid'], ['2026-02-30T00:00:00Z'], ['2026-11-15T00:00:00'],
      ['2026-11-15T00:00:00+00:00'], hours(0, 0), hours(1, 0),
    ]) {
      expect(analyzeSampledRuns(timestamps, timestamps.map(() => true))).toEqual({
        status: 'unknown', reason: 'invalid-timestamps', elapsedHours: null,
        matchingRunCount: null, unknownSamples: null, longestMatchingSpan: null,
      });
    }
  });
});

describe('saved-series trapezoidal integration', () => {
  it('integrates constant and ramp values only between the two saved endpoints', () => {
    expect(integrateSavedSeries(hours(0, 1), [20, 20])).toEqual({ status: 'known', elapsedHours: 1, valueHours: 20 });
    expect(integrateSavedSeries(hours(0, 2), [0, 4])).toEqual({ status: 'known', elapsedHours: 2, valueHours: 4 });
    expect(integrateSavedSeries(hours(0, 1), [0, 1])).toEqual({ status: 'known', elapsedHours: 1, valueHours: 0.5 });
  });

  it('uses actual elapsed time for nonuniform steps and never appends a final step', () => {
    expect(integrateSavedSeries(hours(0, 0.5, 2.5), [2, 4, 8])).toEqual({ status: 'known', elapsedHours: 2.5, valueHours: 13.5 });
    const timestamps = rawDataset.mission_window.timestamps_utc;
    expect(integrateSavedSeries(timestamps, timestamps.map(() => 10))).toEqual({ status: 'known', elapsedHours: 720, valueHours: 7200 });
  });

  it('keeps the dataset final instant unknown for integration rather than assigning zero or one hour', () => {
    const last = rawDataset.mission_window.timestamps_utc.at(-1)!;
    expect(integrateSavedSeries([last], [1576.52])).toEqual({ status: 'unknown', reason: 'single-sample', elapsedHours: 0, valueHours: null });
    expect(integrateSavedSeries([last], [0])).toEqual({ status: 'unknown', reason: 'single-sample', elapsedHours: 0, valueHours: null });
  });

  it('does not coerce missing or nonfinite values into a valid integral', () => {
    expect(integrateSavedSeries(hours(0, 1), [1])).toEqual({ status: 'unknown', reason: 'length-mismatch', elapsedHours: null, valueHours: null });
    for (const values of [[1, NaN], [Infinity, 1], [1, undefined], [1, '2']] as unknown as number[][]) {
      expect(integrateSavedSeries(hours(0, 1), values)).toEqual({ status: 'unknown', reason: 'invalid-values', elapsedHours: 1, valueHours: null });
    }
  });

  it('retains unknown for an empty or invalid time axis', () => {
    expect(integrateSavedSeries([], [])).toEqual({ status: 'unknown', reason: 'empty-input', elapsedHours: null, valueHours: null });
    for (const timestamps of [hours(0, 0), hours(1, 0), ['2026-02-30T00:00:00Z', '2026-03-02T01:00:00Z']]) {
      expect(integrateSavedSeries(timestamps, [1, 1])).toEqual({ status: 'unknown', reason: 'invalid-timestamps', elapsedHours: null, valueHours: null });
    }
  });

  it('does not expose an overflowing numeric result as known', () => {
    expect(integrateSavedSeries(hours(0, 1), [Number.MAX_VALUE, Number.MAX_VALUE])).toEqual({ status: 'known', elapsedHours: 1, valueHours: Number.MAX_VALUE });
    expect(integrateSavedSeries(hours(0, 2), [Number.MAX_VALUE, Number.MAX_VALUE])).toEqual({ status: 'unknown', reason: 'nonfinite-result', elapsedHours: 2, valueHours: null });
  });
});
