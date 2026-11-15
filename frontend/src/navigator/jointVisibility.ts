import type { LandingSiteEntry } from './types';
import { readVisibilityAt } from './visibilityReading';

export interface JointVisibilityInput {
  site: LandingSiteEntry;
  /** Physical terrain skyline for this site and observer, not a display texture. */
  terrainHorizonDeg: readonly number[];
  horizonAzimuthDeg: readonly number[];
  sunAngularRadiusDeg: readonly number[];
  earthAngularRadiusDeg: readonly number[];
  /** Complete hourly UTC sample axis, including the final saved sample. */
  timestamps: readonly string[];
  /** Inclusive. The caller can pass currentEpochIdx + 1 for a strictly later search. */
  fromEpochIdx: number;
  earthCriterion: 'center' | 'full-disk';
}

export type JointVisibilityUnavailableReason =
  | 'empty-timestamps'
  | 'invalid-timestamps'
  | 'invalid-start-index'
  | 'invalid-earth-criterion'
  | 'missing-horizon'
  | 'invalid-horizon';

export type JointVisibilityResult =
  | {
    status: 'found';
    startEpochIdx: number;
    /** Last consecutive matching saved sample, not an exact setting time. */
    endEpochIdx: number;
    /** The run reaches the dataset boundary or the next sample is incomplete. */
    endCensored: boolean;
    /** Incomplete samples before this match may hide an earlier opportunity. */
    unknownSamplesBefore: number;
  }
  | { status: 'not-found'; unknownSamples: number }
  | { status: 'unavailable'; reason: JointVisibilityUnavailableReason };

const HOUR_MS = 3_600_000;

function hasCompleteHourlyAxis(timestamps: readonly string[]): boolean {
  let previous: number | undefined;
  for (const stamp of timestamps) {
    // Date.parse alone normalizes impossible dates such as February 30.
    if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(stamp)) return false;
    const time = Date.parse(stamp);
    if (!Number.isFinite(time)
      || new Date(time).toISOString().replace('.000Z', 'Z') !== stamp.replace('.000Z', 'Z')
      || (previous !== undefined && time - previous !== HOUR_MS)) return false;
    previous = time;
  }
  return true;
}

function horizonProblem(input: JointVisibilityInput): 'missing-horizon' | 'invalid-horizon' | null {
  const { horizonAzimuthDeg: bins, terrainHorizonDeg: heights } = input;
  if (!Array.isArray(bins) || !Array.isArray(heights) || bins.length === 0 || heights.length === 0) return 'missing-horizon';
  if (bins.length < 2 || bins.length !== heights.length) return 'invalid-horizon';
  for (let i = 0; i < bins.length; i++) {
    if (!Number.isFinite(bins[i]) || bins[i] < 0 || bins[i] >= 360
      || (i > 0 && bins[i] <= bins[i - 1]) || !Number.isFinite(heights[i]) || Math.abs(heights[i]) > 90) return 'invalid-horizon';
  }
  return null;
}

/**
 * Search the saved hourly geometry, never interpolate a rise/set transition.
 * Sun: a positive visible fraction of a uniform disk. Earth: strict center or
 * full-disk skyline clearance. Both use readVisibilityAt and the supplied terrain
 * profile. This is neither usable solar power nor a radio-link assessment.
 *
 * Unknown directions/radii remain incomplete samples; they are never coerced to
 * false or joined across. A found run with unknownSamplesBefore > 0 is the first
 * confirmed match, not proof that no earlier match existed. The last timestamp
 * bounds every search; no sample or continuation is extrapolated beyond it.
 */
export function findNextJointVisibility(input: JointVisibilityInput): JointVisibilityResult {
  if (!Array.isArray(input.timestamps) || input.timestamps.length === 0) return { status: 'unavailable', reason: 'empty-timestamps' };
  if (!hasCompleteHourlyAxis(input.timestamps)) return { status: 'unavailable', reason: 'invalid-timestamps' };
  if (!Number.isInteger(input.fromEpochIdx) || input.fromEpochIdx < 0 || input.fromEpochIdx >= input.timestamps.length) {
    return { status: 'unavailable', reason: 'invalid-start-index' };
  }
  if (input.earthCriterion !== 'center' && input.earthCriterion !== 'full-disk') {
    return { status: 'unavailable', reason: 'invalid-earth-criterion' };
  }
  const problem = horizonProblem(input);
  if (problem) return { status: 'unavailable', reason: problem };

  const horizon = {
    kind: 'terrain-profile' as const,
    azimuthDeg: input.horizonAzimuthDeg,
    elevationDeg: input.terrainHorizonDeg,
  };
  const sky = input.site.sky_series;
  const at = (epochIdx: number): 'matching' | 'nonmatching' | 'unknown' => {
    const sun = readVisibilityAt({
      body: 'sun', epochIdx, criterion: 'partial-uniform-solar', horizon,
      series: { azimuthDeg: sky.sun_az_deg, elevationDeg: sky.sun_el_deg, angularRadiusDeg: input.sunAngularRadiusDeg },
    });
    const earth = readVisibilityAt({
      body: 'earth', epochIdx, criterion: input.earthCriterion, horizon,
      series: { azimuthDeg: sky.earth_az_deg, elevationDeg: sky.earth_el_deg, angularRadiusDeg: input.earthAngularRadiusDeg },
    });
    if (sun.status === 'unknown' || earth.status === 'unknown') return 'unknown';
    return sun.criterionSatisfied && earth.criterionSatisfied ? 'matching' : 'nonmatching';
  };

  let unknownSamples = 0;
  for (let i = input.fromEpochIdx; i < input.timestamps.length; i++) {
    const state = at(i);
    if (state === 'unknown') {
      unknownSamples++;
      continue;
    }
    if (state === 'nonmatching') continue;

    let endEpochIdx = i;
    for (let next = i + 1; next < input.timestamps.length; next++) {
      const nextState = at(next);
      if (nextState !== 'matching') {
        return { status: 'found', startEpochIdx: i, endEpochIdx, endCensored: nextState === 'unknown', unknownSamplesBefore: unknownSamples };
      }
      endEpochIdx = next;
    }
    return { status: 'found', startEpochIdx: i, endEpochIdx, endCensored: true, unknownSamplesBefore: unknownSamples };
  }
  return { status: 'not-found', unknownSamples };
}
