import type { DurationDays } from '../landing-guide/state';
import type { EngineeringConfig, NavigatorDatasetV1 } from '../navigator/types';

/** Only this parameter belongs to the scenario codec. Hosting tokens stay intact. */
export const SCENARIO_URL_PARAM = 'lunarScenario';
export const SCENARIO_URL_VERSION = 1;
export type ScenarioModel = 'catalogue-terrain-v1' | 'finite-range-spherical-sky-v1';
export type ScenarioLocation =
  | { kind: 'named'; siteId: string }
  | { kind: 'coordinates'; latDeg: number; lonEastDeg: number };

/** One active slot, not a comparison, camera pose, playback state or visual atlas. */
export interface ScenarioUrlState {
  site: ScenarioLocation;
  epochIdx: number;
  startIdx: number;
  durationDays: DurationDays;
  offsetXNorm: number;
  offsetYNorm: number;
  config: EngineeringConfig;
}

export type ScenarioUrlResult =
  | { status: 'absent' }
  | { status: 'invalid'; error: string }
  | { status: 'valid'; scenario: ScenarioUrlState; utc: string; startUtc: string; model: ScenarioModel };

const DURATIONS = [1, 3, 7, 14, 30] as const;
const MAX_PAYLOAD_LENGTH = 16_384;
type ObjectValue = Record<string, unknown>;

function reject(message: string): never {
  throw new RangeError(message);
}

function object(value: unknown, keys: string[], label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(`Invalid ${label}.`);
  const result = value as ObjectValue;
  const actual = Object.keys(result);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    reject(`Missing or unsupported ${label} fields.`);
  }
  return result;
}

function numberIn(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    reject(`${label} is outside its supported range.`);
  }
  return value;
}

function member<T extends string | number>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) reject(`Unsupported ${label}.`);
  return value as T;
}

function configFrom(value: unknown): EngineeringConfig {
  const config = object(value, [
    'panelAreaM2', 'panelEfficiency', 'panelMode', 'survivalLoadW',
    'antennaMaskDeg', 'dteMarginMode', 'relayEnabled', 'weights',
  ], 'engineering configuration');
  const weights = object(config.weights, ['safety', 'power', 'comms', 'science_psr'], 'score weights');
  if (typeof config.relayEnabled !== 'boolean') reject('Invalid relay setting.');
  return {
    panelAreaM2: numberIn(config.panelAreaM2, 1, 20, 'Panel area'),
    panelEfficiency: numberIn(config.panelEfficiency, 0.18, 0.36, 'Panel efficiency'),
    panelMode: member(config.panelMode, ['tracking', 'fixed_north', 'fixed_horiz'], 'panel geometry'),
    survivalLoadW: numberIn(config.survivalLoadW, 40, 300, 'Survival load'),
    antennaMaskDeg: numberIn(config.antennaMaskDeg, 0, 15, 'Antenna mask'),
    dteMarginMode: member(config.dteMarginMode, ['full_disk', 'center'], 'Earth visibility criterion'),
    relayEnabled: config.relayEnabled,
    weights: {
      safety: numberIn(weights.safety, 0, 1, 'Safety weight'),
      power: numberIn(weights.power, 0, 1, 'Power weight'),
      comms: numberIn(weights.comms, 0, 1, 'Communication weight'),
      science_psr: numberIn(weights.science_psr, 0, 1, 'Science weight'),
    },
  };
}

function locationFrom(value: unknown, dataset: NavigatorDatasetV1): ScenarioLocation {
  if (value !== null && typeof value === 'object' && 'kind' in value && value.kind === 'named') {
    const site = object(value, ['kind', 'siteId'], 'named location');
    if (typeof site.siteId !== 'string' || !dataset.sites.some(entry => entry.id === site.siteId)) {
      reject('This location is not in the available dataset.');
    }
    return { kind: 'named', siteId: site.siteId };
  }
  const site = object(value, ['kind', 'latDeg', 'lonEastDeg'], 'coordinate location');
  if (site.kind !== 'coordinates') reject('Unsupported location type.');
  const latDeg = numberIn(site.latDeg, -90, 90, 'Latitude');
  const lonEastDeg = numberIn(site.lonEastDeg, 0, 360, 'East longitude');
  if (lonEastDeg === 360) reject('East longitude must be at least 0° and below 360°.');
  return { kind: 'coordinates', latDeg, lonEastDeg };
}

/** Source identity, not a checksum or a new scientific validation of the dataset. */
function datasetIdentity(dataset: NavigatorDatasetV1) {
  return {
    schemaVersion: dataset.schema_version,
    generatedUtc: dataset.generated_utc,
    demSha256: dataset.provenance.dem_product.sha256,
    kernelSha256: dataset.provenance.ephemeris.kernels.map(kernel => kernel.sha256),
    frame: dataset.provenance.ephemeris.frame,
    correction: dataset.provenance.ephemeris.correction,
    conventions: dataset.provenance.conventions,
    relayPresets: dataset.relay_presets,
    startUtc: dataset.mission_window.start_utc,
    endUtc: dataset.mission_window.end_utc,
    stepSeconds: dataset.mission_window.step_seconds,
    sampleCount: dataset.mission_window.timestamps_utc.length,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as ObjectValue)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sampleIndex(value: unknown, dataset: NavigatorDatasetV1): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    reject('Choose an exact saved UTC timestamp.');
  }
  const ms = Date.parse(value);
  const expanded = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== expanded) reject('Invalid UTC calendar date.');
  const idx = dataset.mission_window.timestamps_utc.indexOf(value);
  if (idx < 0) reject('This UTC timestamp has no saved sample in the available dataset.');
  return idx;
}

function indexUtc(index: number, dataset: NavigatorDatasetV1): string {
  if (!Number.isInteger(index) || index < 0 || index >= dataset.mission_window.timestamps_utc.length) {
    reject('Choose an available time sample.');
  }
  const utc = dataset.mission_window.timestamps_utc[index];
  sampleIndex(utc, dataset);
  return utc;
}

function modelFor(site: ScenarioLocation): ScenarioModel {
  return site.kind === 'named' ? 'catalogue-terrain-v1' : 'finite-range-spherical-sky-v1';
}

function observerHeight(site: ScenarioLocation, dataset: NavigatorDatasetV1): number | null {
  // The current UI has no adjustable mast. Custom sky geometry uses a sphere,
  // so a fabricated terrain/observer-height measurement must not be attached.
  return site.kind === 'named'
    ? dataset.sites.find(entry => entry.id === site.siteId)!.center.observer_height_m
    : null;
}

function decodePayload(value: unknown, dataset: NavigatorDatasetV1): Extract<ScenarioUrlResult, { status: 'valid' }> {
  const data = object(value, [
    'version', 'model', 'dataset', 'site', 'utc', 'startUtc', 'durationDays', 'offsets', 'config',
  ], 'scenario');
  if (data.version !== SCENARIO_URL_VERSION) reject('This scenario URL version is not supported.');
  if (canonical(data.dataset) !== canonical(datasetIdentity(dataset))) {
    reject('This scenario uses a different dataset or scientific assumptions.');
  }
  const site = locationFrom(data.site, dataset);
  const model = modelFor(site);
  if (data.model !== model) reject('This scenario model is unknown or does not match its location.');
  const offsets = object(data.offsets, ['offsetXNorm', 'offsetYNorm', 'observerHeightM'], 'local offsets');
  const offsetXNorm = numberIn(offsets.offsetXNorm, -1, 1, 'East–West offset');
  const offsetYNorm = numberIn(offsets.offsetYNorm, -1, 1, 'North–South offset');
  if (site.kind === 'coordinates' && (offsetXNorm !== 0 || offsetYNorm !== 0)) {
    reject('Local terrain offsets are not calculated for an arbitrary point.');
  }
  if (offsets.observerHeightM !== observerHeight(site, dataset)) reject('This observer height is not supported by the model.');
  const epochIdx = sampleIndex(data.utc, dataset);
  const startIdx = sampleIndex(data.startUtc, dataset);
  const durationDays = member(data.durationDays, DURATIONS, 'analysis duration');
  // Match the existing window's end truncation, but never clamp the shared epoch.
  const endIdx = Math.min(dataset.mission_window.timestamps_utc.length - 1, startIdx + durationDays * 24);
  if (epochIdx < startIdx || epochIdx > endIdx) reject('The selected UTC timestamp is outside the analysis window.');
  return {
    status: 'valid', model, utc: data.utc as string, startUtc: data.startUtc as string,
    scenario: { site, epochIdx, startIdx, durationDays, offsetXNorm, offsetYNorm, config: configFrom(data.config) },
  };
}

/** No defaults or clamping: a malformed share is distinct from an ordinary visit. */
export function decodeScenarioUrl(search: string, dataset: NavigatorDatasetV1): ScenarioUrlResult {
  const params = new URLSearchParams(search);
  const values = params.getAll(SCENARIO_URL_PARAM);
  if (values.length === 0) return { status: 'absent' };
  if (values.length !== 1) return { status: 'invalid', error: 'The URL contains more than one scenario.' };
  if (values[0].length > MAX_PAYLOAD_LENGTH) return { status: 'invalid', error: 'This scenario URL is too large.' };
  try {
    return decodePayload(JSON.parse(values[0]) as unknown, dataset);
  } catch (error) {
    return { status: 'invalid', error: error instanceof RangeError ? error.message : 'This scenario URL is malformed.' };
  }
}

/** Absolute http(s) base; only the namespaced scenario parameter is replaced. */
export function encodeScenarioUrl(base: string, scenario: ScenarioUrlState, dataset: NavigatorDatasetV1): string {
  const url = new URL(base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') reject('A public http(s) URL is required.');
  const site = locationFrom(scenario.site, dataset);
  const payload = {
    version: SCENARIO_URL_VERSION,
    model: modelFor(site),
    dataset: datasetIdentity(dataset),
    site,
    utc: indexUtc(scenario.epochIdx, dataset),
    startUtc: indexUtc(scenario.startIdx, dataset),
    durationDays: scenario.durationDays,
    offsets: { offsetXNorm: scenario.offsetXNorm, offsetYNorm: scenario.offsetYNorm, observerHeightM: observerHeight(site, dataset) },
    config: scenario.config,
  };
  // Validate before JSON.stringify can turn nonfinite numbers into null.
  decodePayload(payload, dataset);
  const encoded = JSON.stringify(payload);
  if (encoded.length > MAX_PAYLOAD_LENGTH) reject('This scenario URL is too large.');
  url.searchParams.set(SCENARIO_URL_PARAM, encoded);
  return url.toString();
}
