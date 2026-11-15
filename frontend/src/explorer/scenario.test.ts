import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { getConditions } from './geometry';
import { createCustomScenario, createNamedScenario, formatCoordinates, formatUtc, parseUtcInput } from './scenario';

const dataset = parseNavigatorDataset(rawDataset);
const timestamps = dataset.mission_window.timestamps_utc;

describe('guided explorer scenarios', () => {
  it('identifies named geometry explicitly without exposing legacy terrain or engineering fields', () => {
    const original = dataset.sites[1];
    const scenario = createNamedScenario(dataset, original.id, 6);
    expect(scenario.origin).toBe('precomputed');
    expect(scenario.site.geometrySource).toBe('precomputed');
    expect(scenario.epochIdx).toBe(6);
    expect(getConditions(scenario.site, 6).sun.elevationDeg).toBe(original.sky_series.sun_el_deg[6]);
    expect(scenario.site).not.toHaveProperty('engineering_summary');
    expect(scenario.site).not.toHaveProperty('horizon_elev_deg');
    expect(scenario.site).not.toHaveProperty('local_grid');
    expect(scenario.site.center).not.toHaveProperty('is_psr');
    expect(scenario.site.sky_series).not.toHaveProperty('elfo_constellation_visible');
    expect(original).toHaveProperty('engineering_summary');
  });

  it('keeps an arbitrary point distinct from named polar sites and normalizes equivalent longitudes', () => {
    const first = createCustomScenario(dataset, 0, -90, 12);
    const equivalent = createCustomScenario(dataset, 0, 270, 12);
    expect(first.origin).toBe('approximate');
    expect(first.site.geometrySource).toBe('approximate');
    expect(first.site.center).toEqual({ latitude_deg: 0, longitude_east_deg: 270 });
    expect(first.site.sky_series).toEqual(equivalent.site.sky_series);
    expect(dataset.sites.some(site => site.id === first.site.id)).toBe(false);
    expect(first.site).not.toHaveProperty('engineering_summary');
  });

  it('rejects missing sites, invalid samples and invalid custom coordinates without fallback', () => {
    expect(() => createNamedScenario(dataset, 'missing')).toThrow(RangeError);
    for (const epoch of [-1, 0.5, timestamps.length, Infinity]) {
      expect(() => createNamedScenario(dataset, dataset.sites[0].id, epoch)).toThrow(RangeError);
      expect(() => createCustomScenario(dataset, 0, 0, epoch)).toThrow(RangeError);
    }
    expect(() => createCustomScenario(dataset, 91, 0)).toThrow(RangeError);
  });
});

describe('UTC inputs for the available data window', () => {
  it('matches exact hourly samples at both boundaries', () => {
    expect(parseUtcInput('2026-11-15', '0', timestamps)).toEqual({ valid: true, epochIdx: 0 });
    expect(parseUtcInput('2026-11-15', '06', timestamps)).toEqual({ valid: true, epochIdx: 6 });
    expect(parseUtcInput('2026-12-15', '0', timestamps)).toEqual({ valid: true, epochIdx: 720 });
  });

  it('rejects hours outside the actual final timestamp instead of clamping to the last day', () => {
    const after = parseUtcInput('2026-12-15', '1', timestamps);
    expect(after.valid).toBe(false);
    if (!after.valid) expect(after.error).toContain('15 Dec 2026, 00:00 UTC');
    expect(parseUtcInput('2026-11-14', '23', timestamps).valid).toBe(false);
  });

  it('rejects empty, fractional or malformed hours and impossible calendar dates', () => {
    for (const hour of ['', ' ', '-1', '24', '1.5', '1e1', 'Infinity']) {
      expect(parseUtcInput('2026-11-20', hour, timestamps).valid).toBe(false);
    }
    for (const date of ['', '2026-11-31', '2026-02-29', '2026-13-01', '20-11-2026']) {
      expect(parseUtcInput(date, '6', timestamps).valid).toBe(false);
    }
  });

  it('does not substitute a nearby sample for an unsupported hour inside a sparse window', () => {
    const sparse = [timestamps[0], timestamps[6]];
    const result = parseUtcInput('2026-11-15', '3', sparse);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('No saved sample');
    expect(parseUtcInput('2026-11-15', '0', []).valid).toBe(false);
  });

  it('formats location and time independently of host locale and time zone', () => {
    expect(formatUtc('2026-11-15T00:00:00Z')).toBe('15 Nov 2026, 00:00 UTC');
    expect(formatUtc('2026-11-15T23:00:00-03:00')).toBe('16 Nov 2026, 02:00 UTC');
    expect(() => formatUtc('invalid')).toThrow(RangeError);
    expect(formatCoordinates(-89.45, -137.5)).toBe('89.45° S · 222.50° E');
    expect(formatCoordinates(0, 359.99999)).toBe('0.00° N · 0.00° E');
    expect(() => formatCoordinates(NaN, 0)).toThrow(RangeError);
  });
});
