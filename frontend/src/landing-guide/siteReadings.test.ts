import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { DEFAULT_CONFIG } from '../navigator/math';
import type { LandingSiteEntry } from '../navigator/types';
import { buildSiteReadout } from './siteReadings';

const dataset = parseNavigatorDataset(rawDataset);
const ridge = dataset.sites[0];
const read = (site = ridge, epochIdx = 0, terrainHorizonDeg: readonly number[] = site.horizon_elev_deg) =>
  buildSiteReadout({ dataset, site, epochIdx, terrainHorizonDeg, config: DEFAULT_CONFIG });

describe('site-specific explanations and capability boundary', () => {
  it('reproduces the two real sampled video states without promising electricity or radio', () => {
    const first = read();
    const later = read(ridge, 168);
    expect(first.kind).toBe('terrain');
    expect(first.sun.label).toBe('Whole Sun in view');
    expect(first.earth.label).toBe('Earth below modeled horizon');
    expect(later.sun.label).toBe('Whole Sun in view');
    expect(later.earth.label).toBe('Whole Earth in view');
    expect(first.timestamp).toBe('2026-11-15T00:00:00Z');
    expect(later.timestamp).toBe('2026-11-22T00:00:00Z');
    expect(later.communicationNote).toContain('a working radio link is not assessed');
    expect(first.energyNote).toContain('depends on');
  });

  it('free points bypass stale display horizons and borrowed sky tracks', () => {
    // Synthetic hostile scaffold: neither the displayed atlas nor copied named
    // sky/engineering values may become the source of a free-point reading.
    const free: LandingSiteEntry = {
      ...ridge,
      id: 'free-test-point',
      center: { ...ridge.center, latitude_deg: 30, longitude_east_deg: 180 },
      sky_series: { ...ridge.sky_series, sun_el_deg: [], earth_el_deg: [] },
    };
    const result = read(free, 0, [Number.NaN]);
    expect(result.kind).toBe('geometric');
    expect(result.basis).toBe('Approximate geometry · geometric horizon');
    expect(result.sun.label).toMatch(/^Sun center (above|below|at) horizon$/);
    expect(result.earth.label).toMatch(/^Earth center (above|below|at) horizon$/);
    expect(result.sun.angle).toContain('geometric horizon');
    expect(result.modelNote).toContain('Local obstruction, PSR, power and relay availability are not calculated');
    expect(result.modelNote).not.toMatch(/80 m|verified|0\.0000/);
  });

  it('does not turn a missing named horizon or time sample into a night or a communications failure', () => {
    const missing = read(ridge, 0, []);
    expect(missing.kind).toBe('unknown');
    expect(missing.sun.label).toBe('Sunlight not assessed');
    expect(missing.earth.label).toBe('Earth view not assessed');
    expect(missing.summary).toBe('Conditions not assessed');
    const last = dataset.mission_window.timestamps_utc.length - 1;
    expect(read(ridge, last).kind).toBe('terrain');
    const outside = read(ridge, last + 1);
    expect(outside.kind).toBe('unknown');
    expect(outside.timestamp).toBe('Time unavailable');
    expect(outside.sun.label).toBe('No data for this time');
    expect(read(ridge, -1).kind).toBe('unknown');
  });

  it('explains partial Earth independently of a whole-disk criterion failure', () => {
    // Synthetic disk-edge case: center +0.5°, radius 1°, level skyline.
    const site: LandingSiteEntry = {
      ...ridge,
      sky_series: { ...ridge.sky_series, earth_el_deg: [0.5], earth_az_deg: [0] },
    };
    const syntheticDataset = {
      ...dataset,
      mission_window: { ...dataset.mission_window, earth_angular_radius_deg: [1] },
    };
    const input = {
      dataset: syntheticDataset, site, epochIdx: 0,
      terrainHorizonDeg: dataset.horizon_azimuths_deg.map(() => 0),
    };
    const whole = buildSiteReadout({ ...input, config: DEFAULT_CONFIG });
    expect(whole.earth.label).toBe('Earth partly in view');
    expect(whole.earth.detail).toContain('crosses');
    const center = buildSiteReadout({ ...input, config: { ...DEFAULT_CONFIG, dteMarginMode: 'center' } });
    expect(center.earth.label).toBe('Earth center above horizon');
    expect(center.earth.detail).toContain('not a whole-disk clearance test');
  });
});
