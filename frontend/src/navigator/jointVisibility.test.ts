import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { findNextJointVisibility, type JointVisibilityInput } from './jointVisibility';

const dataset = parseNavigatorDataset(rawDataset);
const baseSite = dataset.sites[0];

/** Synthetic sky/skyline values below are unit-test geometry, not lunar measurements. */
function samples(sunElevations: number[], earthElevations: number[], overrides: Partial<JointVisibilityInput> = {}): JointVisibilityInput {
  const count = Math.max(sunElevations.length, earthElevations.length);
  return {
    site: {
      ...baseSite,
      sky_series: {
        ...baseSite.sky_series,
        sun_az_deg: Array(count).fill(0), sun_el_deg: sunElevations,
        earth_az_deg: Array(count).fill(0), earth_el_deg: earthElevations,
      },
    },
    terrainHorizonDeg: [0, 0], horizonAzimuthDeg: [0, 180],
    sunAngularRadiusDeg: Array(count).fill(0.25), earthAngularRadiusDeg: Array(count).fill(1),
    timestamps: Array.from({ length: count }, (_, i) => new Date(Date.UTC(2026, 10, 15, i)).toISOString()),
    fromEpochIdx: 0, earthCriterion: 'full-disk', ...overrides,
  };
}

function ridgeInput(fromEpochIdx: number): JointVisibilityInput {
  const site = dataset.sites.find(entry => entry.id === 'shackleton_ridge');
  if (!site) throw new Error('Missing Connecting Ridge regression fixture.');
  return {
    site, terrainHorizonDeg: site.horizon_elev_deg, horizonAzimuthDeg: dataset.horizon_azimuths_deg,
    sunAngularRadiusDeg: dataset.mission_window.solar_angular_radius_deg,
    earthAngularRadiusDeg: dataset.mission_window.earth_angular_radius_deg,
    timestamps: dataset.mission_window.timestamps_utc, fromEpochIdx, earthCriterion: 'full-disk',
  };
}

describe('next joint saved visibility samples', () => {
  it('finds the existing Connecting Ridge run without inventing an exact transition', () => {
    const input = ridgeInput(0);
    const result = findNextJointVisibility(input);
    expect(result).toEqual({ status: 'found', startEpochIdx: 87, endEpochIdx: 339, endCensored: false, unknownSamplesBefore: 0 });
    if (result.status !== 'found') throw new Error('Expected a saved matching sample.');
    expect(input.timestamps[result.startEpochIdx]).toBe('2026-11-18T15:00:00Z');
    expect(input.timestamps[result.endEpochIdx]).toBe('2026-11-29T03:00:00Z');
    expect(findNextJointVisibility(ridgeInput(168))).toMatchObject({ status: 'found', startEpochIdx: 168, endEpochIdx: 339 });
  });

  it('includes the requested sample but never returns an earlier match', () => {
    expect(findNextJointVisibility(samples([1, 1, 1], [2, 2, 2], { fromEpochIdx: 1 }))).toEqual({
      status: 'found', startEpochIdx: 1, endEpochIdx: 2, endCensored: true, unknownSamplesBefore: 0,
    });
  });

  it('requires positive solar area and distinguishes partial Earth from full-disk clearance', () => {
    // Solar upper-limb tangency at index 0 exposes no area; index 1 exposes a sliver.
    const input = samples([-0.25, -0.125, 1], [2, 0.5, 2]);
    expect(findNextJointVisibility(input)).toMatchObject({ status: 'found', startEpochIdx: 2 });
    expect(findNextJointVisibility({ ...input, earthCriterion: 'center' })).toMatchObject({ status: 'found', startEpochIdx: 1, endEpochIdx: 2 });
  });

  it('does not admit Earth center or lower-limb tangency under their strict criteria', () => {
    const full = samples([1, 1], [1, 1.01]);
    expect(findNextJointVisibility(full)).toMatchObject({ status: 'found', startEpochIdx: 1 });
    expect(findNextJointVisibility(samples([1, 1], [0, 0.01], { earthCriterion: 'center' }))).toMatchObject({ status: 'found', startEpochIdx: 1 });
  });

  it('counts incomplete indices once before a match and never joins across them', () => {
    const before = samples([NaN, 1, 1], [NaN, 2, -2]);
    expect(findNextJointVisibility(before)).toEqual({ status: 'found', startEpochIdx: 1, endEpochIdx: 1, endCensored: false, unknownSamplesBefore: 1 });
    const gap = samples([1, NaN, 1], [2, 2, 2]);
    expect(findNextJointVisibility(gap)).toEqual({ status: 'found', startEpochIdx: 0, endEpochIdx: 0, endCensored: true, unknownSamplesBefore: 0 });
    expect(findNextJointVisibility({ ...gap, fromEpochIdx: 1 })).toEqual({ status: 'found', startEpochIdx: 2, endEpochIdx: 2, endCensored: true, unknownSamplesBefore: 1 });
  });

  it('reports no match only within the saved range, keeping missing fields unknown', () => {
    const input = samples([-2, -2, 1], [2, 2, NaN]);
    expect(findNextJointVisibility(input)).toEqual({ status: 'not-found', unknownSamples: 1 });
    expect(findNextJointVisibility({ ...input, sunAngularRadiusDeg: [] })).toEqual({ status: 'not-found', unknownSamples: 3 });
    expect(findNextJointVisibility(samples([1, 1], [2, 2], { earthAngularRadiusDeg: [] }))).toEqual({ status: 'not-found', unknownSamples: 2 });
    expect(findNextJointVisibility(samples([1, 1], [2, 2], { sunAngularRadiusDeg: [0.25] }))).toEqual({ status: 'found', startEpochIdx: 0, endEpochIdx: 0, endCensored: true, unknownSamplesBefore: 0 });
  });

  it('recomputes against the supplied terrain profile rather than caching a prior result', () => {
    const heights = [0, 0];
    const input = samples([1, 1], [2, 2], { terrainHorizonDeg: heights });
    expect(findNextJointVisibility(input)).toMatchObject({ status: 'found', startEpochIdx: 0 });
    heights[0] = 3;
    expect(findNextJointVisibility(input)).toEqual({ status: 'not-found', unknownSamples: 0 });
    heights[0] = -2;
    expect(findNextJointVisibility(samples([-1, -1], [0, 0], { terrainHorizonDeg: heights }))).toMatchObject({ status: 'found', startEpochIdx: 0 });
  });

  it('rejects absent or malformed skylines instead of assuming a zero horizon', () => {
    const input = samples([1], [2]);
    expect(findNextJointVisibility({ ...input, terrainHorizonDeg: [] })).toEqual({ status: 'unavailable', reason: 'missing-horizon' });
    for (const horizon of [
      { horizonAzimuthDeg: [0, 180], terrainHorizonDeg: [0] },
      { horizonAzimuthDeg: [180, 0], terrainHorizonDeg: [0, 0] },
      { horizonAzimuthDeg: [0, 0], terrainHorizonDeg: [0, 0] },
      { horizonAzimuthDeg: [0, 360], terrainHorizonDeg: [0, 0] },
      { horizonAzimuthDeg: [0, 180], terrainHorizonDeg: [NaN, 0] },
      { horizonAzimuthDeg: [0, 180], terrainHorizonDeg: [91, 0] },
    ]) expect(findNextJointVisibility({ ...input, ...horizon })).toEqual({ status: 'unavailable', reason: 'invalid-horizon' });
  });

  it('refuses invalid initial indices without clamping or extrapolating', () => {
    const input = samples([1, 1], [2, 2]);
    for (const fromEpochIdx of [-1, 2, 0.5, NaN, Infinity]) {
      expect(findNextJointVisibility({ ...input, fromEpochIdx })).toEqual({ status: 'unavailable', reason: 'invalid-start-index' });
    }
    expect(findNextJointVisibility({ ...input, fromEpochIdx: 1 })).toMatchObject({ status: 'found', startEpochIdx: 1, endEpochIdx: 1, endCensored: true });
  });

  it('rejects a missing, invalid, duplicated or gapped hourly UTC axis', () => {
    const input = samples([1, 1], [2, 2]);
    expect(findNextJointVisibility({ ...input, timestamps: [] })).toEqual({ status: 'unavailable', reason: 'empty-timestamps' });
    for (const timestamps of [
      ['invalid', '2026-11-15T01:00:00Z'],
      ['2026-02-30T00:00:00Z', '2026-03-02T01:00:00Z'],
      ['2026-11-15T00:00:00', '2026-11-15T01:00:00'],
      ['2026-11-15T00:00:00Z', '2026-11-15T00:00:00Z'],
      ['2026-11-15T01:00:00Z', '2026-11-15T00:00:00Z'],
      ['2026-11-15T00:00:00Z', '2026-11-15T02:00:00Z'],
    ]) expect(findNextJointVisibility({ ...input, timestamps })).toEqual({ status: 'unavailable', reason: 'invalid-timestamps' });
  });
});
