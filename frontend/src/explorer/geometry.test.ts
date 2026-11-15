import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { bodyDirectionAt, classifyElevation, createGeometrySite, formatElevation, getConditions, type ExplorerSite } from './geometry';

const dataset = parseNavigatorDataset(rawDataset);

describe('geometry-only lunar exploration', () => {
  it('reconstructs sampled named-site directions to the precision of rounded input data', () => {
    for (const site of dataset.sites) {
      const projected = createGeometrySite(dataset, site.center.latitude_deg, site.center.longitude_east_deg);
      for (const epoch of [0, 180, 360, 540, 720]) {
        for (const body of ['sun', 'earth'] as const) {
          const expected = getConditions(site, epoch)[body];
          const actual = getConditions(projected, epoch)[body];
          // The custom observer is on the reference sphere, not at the stored
          // terrain elevation. Allow that difference and rounded source angles.
          expect(Math.abs(actual.elevationDeg - expected.elevationDeg)).toBeLessThan(0.003);
          const azimuthDifference = Math.abs(((actual.azimuthDeg - expected.azimuthDeg + 540) % 360) - 180);
          expect(azimuthDifference * Math.cos(expected.elevationDeg * Math.PI / 180)).toBeLessThan(0.003);
        }
      }
    }
  });

  it('distinguishes the near side from the far side without inventing terrain or engineering data', () => {
    const near = createGeometrySite(dataset, 0, 0);
    const far = createGeometrySite(dataset, 0, 180);
    expect(getConditions(near, 0).earth.elevationDeg).toBeGreaterThan(80);
    expect(getConditions(far, 0).earth.elevationDeg).toBeLessThan(-80);
    expect(near.geometrySource).toBe('approximate');
    expect(near.name).toContain('Approximate');
    expect(Object.keys(near.center).sort()).toEqual(['latitude_deg', 'longitude_east_deg']);
    expect(near).not.toHaveProperty('horizon_elev_deg');
    expect(near).not.toHaveProperty('engineering_summary');
    expect(near).not.toHaveProperty('local_grid');
    expect(near.sky_series).not.toHaveProperty('elfo_constellation_visible');
  });

  it('handles both poles, longitude wrapping, and frame directions without singularities', () => {
    for (const latitude of [-90, 90]) {
      const site = createGeometrySite(dataset, latitude, -360);
      expect(site.center.longitude_east_deg).toBe(0);
      for (const epoch of [0, 360, 720]) {
        for (const body of ['sun', 'earth'] as const) {
          const condition = getConditions(site, epoch)[body];
          const direction = bodyDirectionAt(site, epoch, body);
          expect(Number.isFinite(condition.azimuthDeg)).toBe(true);
          expect(Number.isFinite(condition.elevationDeg)).toBe(true);
          expect(Number.isFinite(direction.latDeg)).toBe(true);
          expect(Number.isFinite(direction.lonEastDeg)).toBe(true);
          expect(Math.abs(direction.latDeg)).toBeLessThanOrEqual(90);
          expect(direction.lonEastDeg).toBeGreaterThanOrEqual(0);
          expect(direction.lonEastDeg).toBeLessThan(360);
        }
      }
    }
    const equator: ExplorerSite = {
      id: 'test', name: 'test', center: { latitude_deg: 0, longitude_east_deg: 0 },
      sky_series: { sun_az_deg: [90], sun_el_deg: [0], earth_az_deg: [0], earth_el_deg: [90] },
    };
    expect(bodyDirectionAt(equator, 0, 'sun').lonEastDeg).toBeCloseTo(90, 8);
    expect(bodyDirectionAt(equator, 0, 'earth').latDeg).toBeCloseTo(0, 8);
  });

  it('keeps near-horizon signs and caution separate from classification', () => {
    expect(classifyElevation(-0.000001)).toBe('below');
    expect(classifyElevation(0.000001)).toBe('above');
    expect(classifyElevation(0)).toBe('on');
    expect(formatElevation(-0.000001)).toBe('−<0.01°');
    expect(formatElevation(0.000001)).toBe('+<0.01°');
    expect(formatElevation(-2.25)).toBe('−2.25°');
    expect(formatElevation(-0)).toBe('0.00°');
    const sample: ExplorerSite = {
      id: 'test', name: 'test', center: { latitude_deg: 0, longitude_east_deg: 0 },
      sky_series: { sun_az_deg: [0], sun_el_deg: [-0.01], earth_az_deg: [0], earth_el_deg: [1.01] },
    };
    expect(getConditions(sample, 0).sun).toMatchObject({ position: 'below', nearHorizon: true });
    expect(getConditions(sample, 0).earth).toMatchObject({ position: 'above', nearHorizon: false });
  });

  it('rejects invalid coordinates and unavailable sample indices', () => {
    for (const latitude of [-90.01, 90.01, NaN, Infinity]) {
      expect(() => createGeometrySite(dataset, latitude, 0)).toThrow(RangeError);
    }
    expect(() => createGeometrySite(dataset, 0, Infinity)).toThrow(RangeError);
    for (const epoch of [-1, 0.5, 721, NaN]) {
      expect(() => getConditions(dataset.sites[0], epoch)).toThrow(RangeError);
      expect(() => bodyDirectionAt(dataset.sites[0], epoch, 'sun')).toThrow(RangeError);
    }
    expect(() => classifyElevation(NaN)).toThrow(RangeError);
    expect(() => formatElevation(Infinity)).toThrow(RangeError);
  });
});
