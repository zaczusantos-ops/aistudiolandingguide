import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from '../navigator/math';
import type { NavigatorDatasetV1 } from '../navigator/types';
import { computeWindowSlice, evaluateWindowMetrics } from '../landing-guide/state';
import {
  decodeScenarioUrl, encodeScenarioUrl, SCENARIO_URL_PARAM, type ScenarioUrlState,
} from './scenarioUrl';

const dataset = parseNavigatorDataset(rawDataset);
const base = 'https://example.vercel.app/explorer?_vercel_share=token%2Bsafe&autostart=1&v=host&tag=a&tag=b#moon';
const named = (): ScenarioUrlState => ({
  site: { kind: 'named', siteId: dataset.sites[0].id },
  epochIdx: 87, startIdx: 24, durationDays: 7, offsetXNorm: 0.4, offsetYNorm: -0.6,
  config: { ...DEFAULT_CONFIG, dteMarginMode: 'center', weights: { ...DEFAULT_CONFIG.weights } },
});
const encode = (state = named(), data = dataset) => encodeScenarioUrl(base, state, data);
const decode = (url: string, data = dataset) => decodeScenarioUrl(new URL(url).search, data);
const payloadOf = (url: string) => JSON.parse(new URL(url).searchParams.get(SCENARIO_URL_PARAM)!);
function alter(change: (payload: ReturnType<typeof payloadOf>) => void, data = dataset): string {
  const url = new URL(encode(named(), data));
  const payload = payloadOf(url.toString());
  change(payload);
  url.searchParams.set(SCENARIO_URL_PARAM, JSON.stringify(payload));
  return url.toString();
}

describe('single-scenario share URL', () => {
  it('round-trips the active named point, nonzero offset, exact window, Earth criterion and every engineering setting', () => {
    const original = named();
    original.config = {
      panelAreaM2: 12.5, panelEfficiency: 0.33, panelMode: 'fixed_north', survivalLoadW: 250,
      antennaMaskDeg: 9, dteMarginMode: 'center', relayEnabled: false,
      weights: { safety: 0.1, power: 0.4, comms: 0.35, science_psr: 0.15 },
    };
    const result = decode(encode(original));
    expect(result).toEqual({
      status: 'valid', scenario: original, model: 'catalogue-terrain-v1',
      utc: dataset.mission_window.timestamps_utc[87], startUtc: dataset.mission_window.timestamps_utc[24],
    });
    const serialized = payloadOf(encode(original));
    expect(serialized.offsets.observerHeightM).toBe(dataset.sites[0].center.observer_height_m);
    expect(serialized).not.toHaveProperty('epochIdx');
    expect(serialized).not.toHaveProperty('startIdx');
    expect(serialized.config).toEqual(original.config);
  });

  it('reproduces terrain interpolation, energy and communication window results without recomputing a nearby site', () => {
    const original = named();
    const result = decode(encode(original));
    if (result.status !== 'valid') throw new Error('Expected a valid fixture.');
    const evaluate = (state: ScenarioUrlState) => {
      if (state.site.kind !== 'named') throw new Error('Expected a named fixture.');
      const siteId = state.site.siteId;
      const site = dataset.sites.find(site => site.id === siteId)!;
      const analysis = evaluateLiveSite(site, state.offsetXNorm, state.offsetYNorm,
        dataset.horizon_azimuths_deg, dataset.mission_window, state.config);
      return {
        analysis,
        window: evaluateWindowMetrics(analysis, dataset.mission_window, state.config,
          computeWindowSlice(dataset.mission_window.timestamps_utc, state.startIdx, state.durationDays)),
      };
    };
    const before = evaluate(original);
    const after = evaluate(result.scenario);
    expect(after).toEqual(before);
    expect(after.analysis.terrain.dxM).not.toBe(0);
    expect(after.analysis.terrain.dyM).not.toBe(0);
    expect(after.analysis.terrain.horizonElevDeg).not.toEqual(dataset.sites[0].horizon_elev_deg);
  });

  it('preserves the Earth criterion that changes the first saved joint opportunity at Connecting Ridge', () => {
    const firstJoint = (dteMarginMode: 'full_disk' | 'center') => {
      const result = decode(encode({ ...named(), epochIdx: 0, startIdx: 0, durationDays: 30,
        offsetXNorm: 0, offsetYNorm: 0, config: { ...DEFAULT_CONFIG, dteMarginMode } }));
      if (result.status !== 'valid') throw new Error('Expected a valid fixture.');
      const state = result.scenario;
      const analysis = evaluateLiveSite(dataset.sites[0], state.offsetXNorm, state.offsetYNorm,
        dataset.horizon_azimuths_deg, dataset.mission_window, state.config);
      return analysis.epochStates.findIndex(sample => sample.fIllum > 0 && sample.dteVisible);
    };
    // Saved hourly model samples, not exact event times or a working power/radio service.
    expect(firstJoint('full_disk')).toBe(87);
    expect(firstJoint('center')).toBe(72);
  });

  it('keeps arbitrary coordinates explicitly spherical with no fabricated terrain offset or observer mast', () => {
    const custom: ScenarioUrlState = { ...named(),
      site: { kind: 'coordinates', latDeg: -86.123456789, lonEastDeg: 359.987654321 },
      offsetXNorm: 0, offsetYNorm: 0,
    };
    const url = encode(custom);
    expect(decode(url)).toMatchObject({ status: 'valid', scenario: custom, model: 'finite-range-spherical-sky-v1' });
    expect(payloadOf(url).offsets.observerHeightM).toBeNull();
    expect(payloadOf(url).site).not.toHaveProperty('siteId');
    expect(() => encode({ ...custom, offsetXNorm: 0.1 })).toThrow(/not calculated/);
  });

  it('preserves hosting tokens, unrelated and repeated query parameters, path and fragment when replacing an old share', () => {
    const first = new URL(encode());
    const second = new URL(encodeScenarioUrl(first.toString(), { ...named(), epochIdx: 88 }, dataset));
    expect(second.origin + second.pathname + second.hash).toBe('https://example.vercel.app/explorer#moon');
    expect(second.searchParams.get('_vercel_share')).toBe('token+safe');
    expect(second.searchParams.get('autostart')).toBe('1');
    expect(second.searchParams.get('v')).toBe('host');
    expect(second.searchParams.getAll('tag')).toEqual(['a', 'b']);
    expect(second.searchParams.getAll(SCENARIO_URL_PARAM)).toHaveLength(1);
    expect(decode(second.toString())).toMatchObject({ status: 'valid', scenario: { epochIdx: 88 } });
  });

  it('distinguishes an ordinary visit from malformed, empty, duplicate or oversized shares', () => {
    expect(decodeScenarioUrl('?_vercel_share=token&v=anything', dataset)).toEqual({ status: 'absent' });
    for (const search of [`?${SCENARIO_URL_PARAM}=`, `?${SCENARIO_URL_PARAM}=%7Bbad`,
      `?${SCENARIO_URL_PARAM}=null`, `?${SCENARIO_URL_PARAM}=[]`,
      `?${SCENARIO_URL_PARAM}=${'x'.repeat(16_385)}`,
      `${new URL(encode()).search}&${SCENARIO_URL_PARAM}={}`]) {
      expect(decodeScenarioUrl(search, dataset).status).toBe('invalid');
    }
  });

  it.each([
    (p: any) => { delete p.version; },
    (p: any) => { p.version = 2; },
    (p: any) => { delete p.model; },
    (p: any) => { p.model = 'unknown-v1'; },
    (p: any) => { p.model = 'finite-range-spherical-sky-v1'; },
    (p: any) => { p.dataset.generatedUtc = '2026-11-15T00:00:00Z'; },
    (p: any) => { p.dataset.demSha256 = 'different-dem'; },
    (p: any) => { p.dataset.conventions.lunar_radius_m = 1; },
    (p: any) => { p.dataset.relayPresets.elfo_constellation.satellites_count += 1; },
    (p: any) => { p.site.siteId = 'unknown-site'; },
    (p: any) => { p.site.latDeg = -85; },
    (p: any) => { p.offsets.observerHeightM = 10; },
    (p: any) => { delete p.config.dteMarginMode; },
    (p: any) => { p.unused = 'silently discard me'; },
  ])('rejects unknown versions, source assumptions and incomplete or ambiguous states (%#)', change => {
    expect(decode(alter(change)).status).toBe('invalid');
  });

  it.each(['2026-11-31T00:00:00Z', '2026-11-15T00:30:00Z', '2026-11-14T23:00:00Z',
    '2026-12-15T01:00:00Z', '2026-11-15T25:00:00Z', '2026-11-18',
    '2026-11-18T00:00:00+00:00', '2026-11-18T00:00:00.000Z'])('never clamps, normalizes or substitutes a nonsampled UTC: %s', utc => {
    expect(decode(alter(p => { p.utc = utc; })).status).toBe('invalid');
    expect(decode(alter(p => { p.startUtc = utc; })).status).toBe('invalid');
  });

  it('accepts exact endpoints and the UI end-truncated duration, while rejecting epochs outside the effective window', () => {
    const first = { ...named(), epochIdx: 0, startIdx: 0, durationDays: 1 as const };
    const lastIdx = dataset.mission_window.timestamps_utc.length - 1;
    const last = { ...named(), epochIdx: lastIdx, startIdx: lastIdx, durationDays: 30 as const };
    expect(decode(encode(first))).toMatchObject({ status: 'valid', scenario: first });
    expect(decode(encode(last))).toMatchObject({ status: 'valid', scenario: last });
    expect(() => encode({ ...first, epochIdx: 25 })).toThrow(/outside/);
    expect(() => encode({ ...first, startIdx: 1 })).toThrow(/outside/);
    for (const index of [-1, 0.5, 721, NaN, Infinity]) {
      expect(() => encode({ ...named(), epochIdx: index })).toThrow();
      expect(() => encode({ ...named(), startIdx: index })).toThrow();
    }
  });

  it.each([
    ['panelAreaM2', 0], ['panelAreaM2', 21], ['panelEfficiency', 0.17], ['panelEfficiency', 0.37],
    ['survivalLoadW', 39], ['survivalLoadW', 301], ['antennaMaskDeg', -1], ['antennaMaskDeg', 16],
    ['panelMode', 'magic'], ['dteMarginMode', 'any-disk'], ['relayEnabled', 'true'],
  ])('validates UI configuration ranges and types: %s=%s', (key, value) => {
    expect(decode(alter(p => { p.config[key] = value; })).status).toBe('invalid');
  });

  it('rejects out-of-range coordinates and offsets, and nonfinite configuration values before serialization', () => {
    for (const [latDeg, lonEastDeg] of [[-91, 0], [91, 0], [0, -1], [0, 360], [NaN, 0], [0, Infinity]]) {
      expect(() => encode({ ...named(), site: { kind: 'coordinates', latDeg, lonEastDeg }, offsetXNorm: 0, offsetYNorm: 0 })).toThrow();
    }
    for (const value of [-1.01, 1.01, NaN, Infinity]) {
      expect(() => encode({ ...named(), offsetXNorm: value })).toThrow();
      expect(() => encode({ ...named(), offsetYNorm: value })).toThrow();
    }
    for (const value of [NaN, Infinity, 0, 21]) {
      expect(() => encode({ ...named(), config: { ...DEFAULT_CONFIG, panelAreaM2: value } })).toThrow();
    }
    expect(decode(alter(p => { p.config.weights.safety = -0.1; })).status).toBe('invalid');
    expect(decode(alter(p => { p.durationDays = 2; })).status).toBe('invalid');
    expect(() => encodeScenarioUrl('javascript:alert(1)', named(), dataset)).toThrow(/http/);
  });

  it('rejects an in-range missing sample in a sparse supplied dataset rather than choosing its nearest hour', () => {
    const timestamps = [...dataset.mission_window.timestamps_utc];
    timestamps[100] = '2026-11-19T04:30:00Z';
    const sparse: NavigatorDatasetV1 = { ...dataset, mission_window: { ...dataset.mission_window, timestamps_utc: timestamps } };
    expect(decode(alter(p => { p.utc = dataset.mission_window.timestamps_utc[100]; }, sparse), sparse).status).toBe('invalid');
  });
});
