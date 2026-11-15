import {
  computeCompositeScore,
  LiveEpochState,
  LiveSiteAnalysis,
} from '../navigator/math';
import {
  EngineeringConfig,
  LandingSiteEntry,
  MissionWindow,
  ScoreSummary,
} from '../navigator/types';
import { analyzeSampledRuns, integrateSavedSeries } from '../navigator/sampledIntervals';

export type ViewportMode = '3d' | 'astronaut';
export type SelectionMode = 'cursor' | 'crosshair';
export type SlotLabel = 'A' | 'B' | 'C' | 'D';
export type AssignTarget = SlotLabel;
export type DurationDays = 1 | 3 | 7 | 14 | 30;
export type PlaybackSpeed = 1 | 3 | 6;

export const SLOT_LABELS: SlotLabel[] = ['A', 'B', 'C', 'D'];
export const MAX_SITE_SLOTS = 4;

export interface SlotVisualMeta {
  label: SlotLabel;
  color: string;
  textColor: string;
  shapeName: string;
  glyph: string;
  dashArray?: string;
  dashDesc: string;
}

export const SLOT_META: Record<SlotLabel, SlotVisualMeta> = {
  A: {
    label: 'A',
    color: '#ffffff',
    textColor: '#ffffff',
    shapeName: 'circle',
    glyph: '●',
    dashArray: undefined,
    dashDesc: 'solid line',
  },
  B: {
    label: 'B',
    color: '#d4d4d8',
    textColor: '#e4e4e7',
    shapeName: 'diamond',
    glyph: '◆',
    dashArray: '5 3',
    dashDesc: 'dashed line',
  },
  C: {
    label: 'C',
    color: '#a1a1aa',
    textColor: '#d4d4d8',
    shapeName: 'triangle',
    glyph: '▲',
    dashArray: '2 3',
    dashDesc: 'dotted line',
  },
  D: {
    label: 'D',
    color: '#e4e4e7',
    textColor: '#f4f4f5',
    shapeName: 'square',
    glyph: '■',
    dashArray: '8 3 2 3',
    dashDesc: 'dash-dot line',
  },
};

export interface SiteSlotState {
  siteId: string;
  offsetXNorm: number;
  offsetYNorm: number;
}

export interface EvaluatedSlotEntry {
  label: SlotLabel;
  meta: SlotVisualMeta;
  slot: SiteSlotState;
  site: LandingSiteEntry;
  analysis: LiveSiteAnalysis;
  metrics: WindowMetrics;
}

export interface WindowSlice {
  startIdx: number;
  endIdx: number;
  epochCount: number;
  totalHours: number;
  clampedByEnd: boolean;
}

export interface WindowMetrics {
  meanIllumFraction: number;
  sunlitHours: number;
  maxContinuousShadowHours: number;
  energyCycleWh: number;
  minBatteryWh: number;
  dteDutyCyclePct: number;
  elfoDutyCyclePct: number;
  combinedDutyCyclePct: number;
  relayCoverageGainPct: number;
  blackoutCountDte: number;
  blackoutCountCombined: number;
  maxBlackoutDteHours: number;
  maxBlackoutCombinedHours: number;
  score: ScoreSummary;
}

export interface NearestSiteMatch {
  site: LandingSiteEntry;
  angularDistanceDeg: number;
  withinLolaCoverage: boolean;
}

export interface TimeValidationResult {
  valid: boolean;
  startIdx?: number;
  errorMessage?: string;
}

export interface GlossaryItem {
  id: string;
  term: string;
  shortDesc: string;
  detailDesc: string;
}

export interface PlainLanguageSummary {
  whereText: string;
  nowText: string;
  periodText: string;
  limitationNote: string;
}

export const DURATION_OPTIONS: DurationDays[] = [1, 3, 7, 14, 30];
export const SPEED_OPTIONS: PlaybackSpeed[] = [1, 3, 6];

export const GLOSSARY_ITEMS: GlossaryItem[] = [
  {
    id: 'local_horizon',
    term: 'Geometric Horizon vs. Local Terrain',
    shortDesc: 'A smooth sphere horizon ignores surrounding mountains and crater rims.',
    detailDesc:
      'Metrics here march geodesics up to 120 km over the NASA LOLA 80 m/px polar DEM: if a ridge rises to +4° along an azimuth, the Sun or Earth must clear +4° to be visible.',
  },
  {
    id: 'psr',
    term: 'PSR (Permanently Shadowed Region)',
    shortDesc: 'Polar crater interiors never reached by direct sunlight.',
    detailDesc:
      'The Moon’s small axial tilt allows some polar depressions to remain in shadow. A dark 30-day sample alone does not establish permanent shadow; this app does not assess the presence of ice.',
  },
  {
    id: 'dte',
    term: 'DTE (Direct-to-Earth)',
    shortDesc: 'Direct radio line-of-sight between a lunar surface terminal and Earth stations.',
    detailDesc:
      'Available only when Earth sits above local crater walls. From the South Pole, Earth oscillates near the horizon over the lunar libration cycle and can be blocked for days.',
  },
  {
    id: 'elfo',
    term: 'ELFO Relay Satellites',
    shortDesc: 'An illustrative orbit arrangement that may offer another line of sight.',
    detailDesc:
      'The model uses a 3-satellite phased ELFO constellation (a = 5,740 km, e = 0.58). Availability of an operating service and radio-link performance are not assessed.',
  },
  {
    id: 'blackout',
    term: 'Visibility Gap',
    shortDesc: 'A sampled gap in the selected Earth and modelled relay visibility criteria.',
    detailDesc:
      'The displayed gap describes the selected geometric criteria within the analysis window. It does not establish a radio outage or an exact rise/set time.',
  },
  {
    id: 'clps_slope',
    term: 'Terrain Slope (< 12°–15°)',
    shortDesc: 'Local DEM slope compared against typical lander stability thresholds.',
    detailDesc:
      'Computed on an 80 m/px LOLA grid; sub-meter boulders and micro-craters still require LROC NAC hazard imagery prior to landing certification.',
  },
];

function clamp(v: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, v));
}

export function addSiteSlot(
  slots: SiteSlotState[],
  allSites: LandingSiteEntry[],
  preferredSiteId?: string,
): SiteSlotState[] {
  if (slots.length >= MAX_SITE_SLOTS) return slots;
  const usedIds = new Set(slots.map((s) => s.siteId));
  const fallback =
    (preferredSiteId ? allSites.find((s) => s.id === preferredSiteId) : undefined) ??
    allSites.find((s) => !usedIds.has(s.id)) ??
    allSites[slots.length % allSites.length];
  if (!fallback) return slots;
  return [...slots, { siteId: fallback.id, offsetXNorm: 0, offsetYNorm: 0 }];
}

export function removeSiteSlot(slots: SiteSlotState[], index: number): SiteSlotState[] {
  if (slots.length <= 1 || index < 0 || index >= slots.length) return slots;
  return slots.filter((_, i) => i !== index);
}

export function setSiteSlotAt(
  slots: SiteSlotState[],
  index: number,
  siteId: string,
): SiteSlotState[] {
  if (index < 0 || index >= slots.length) return slots;
  return slots.map((slot, i) =>
    i === index ? { siteId, offsetXNorm: 0, offsetYNorm: 0 } : slot,
  );
}

export function swapSiteSlots(
  slots: SiteSlotState[],
  indexA: number,
  indexB: number,
): SiteSlotState[] {
  if (
    indexA === indexB ||
    indexA < 0 ||
    indexB < 0 ||
    indexA >= slots.length ||
    indexB >= slots.length
  ) {
    return slots;
  }
  const next = [...slots];
  const tmp = next[indexA];
  next[indexA] = next[indexB];
  next[indexB] = tmp;
  return next;
}

export function getDateHourFromIso(utcIso: string): { date: string; hour: number } {
  const date = utcIso.slice(0, 10);
  const hour = Number.parseInt(utcIso.slice(11, 13), 10);
  return {
    date,
    hour: Number.isFinite(hour) ? hour : 0,
  };
}

export function formatUtcShort(utcIso: string): string {
  const { date, hour } = getDateHourFromIso(utcIso);
  return `${date} ${String(hour).padStart(2, '0')}:00 UTC`;
}

export function parseUtcDateHourToEpochIndex(
  dateStr: string,
  hourUtc: number,
  timestampsUtc: string[],
): TimeValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return {
      valid: false,
      errorMessage:
        'Enter a valid YYYY-MM-DD date between 2026-11-15 and 2026-12-15 UTC.',
    };
  }
  if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
    return {
      valid: false,
      errorMessage: 'Enter a whole UTC hour between 0 and 23.',
    };
  }

  const targetIso = `${dateStr}T${String(hourUtc).padStart(2, '0')}:00:00Z`;
  const firstIso = timestampsUtc[0];
  const lastIso = timestampsUtc[timestampsUtc.length - 1];

  if (targetIso < firstIso || targetIso > lastIso) {
    return {
      valid: false,
      errorMessage: `Outside the precomputed LOLA/SPICE window (${firstIso.slice(0, 10)} to ${lastIso.slice(0, 10)} UTC). Use "Reset window" to return to valid dates.`,
    };
  }

  const exactIdx = timestampsUtc.indexOf(targetIso);
  if (exactIdx >= 0) {
    return { valid: true, startIdx: exactIdx };
  }

  const targetMs = Date.parse(targetIso);
  let bestIdx = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < timestampsUtc.length; i++) {
    const diff = Math.abs(Date.parse(timestampsUtc[i]) - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return { valid: true, startIdx: bestIdx };
}

export function computeWindowSlice(
  timestampsUtc: string[],
  startIdx: number,
  durationDays: DurationDays,
): WindowSlice {
  const n = Math.max(1, timestampsUtc.length);
  const clampedStart = clamp(Math.floor(startIdx), 0, n - 1);
  const requestedSteps = durationDays * 24;
  const rawEnd = clampedStart + requestedSteps;
  const endIdx = Math.min(n - 1, rawEnd);
  return {
    startIdx: clampedStart,
    endIdx,
    epochCount: endIdx - clampedStart + 1,
    totalHours: (Date.parse(timestampsUtc[endIdx]) - Date.parse(timestampsUtc[clampedStart])) / 3_600_000,
    clampedByEnd: rawEnd > n - 1,
  };
}

function analyzeFalseRuns(
  epochs: LiveEpochState[],
  startIdx: number,
  endIdx: number,
  timestamps: readonly string[],
  predicate: (ep: LiveEpochState) => boolean | null,
): { falseCount: number; maxFalseHours: number } {
  const flags = epochs.slice(startIdx, endIdx + 1).map(ep => {
    const value = predicate(ep);
    return value === null ? null : !value;
  });
  const runs = analyzeSampledRuns(timestamps.slice(startIdx, endIdx + 1), flags);
  return runs.status === 'known'
    ? { falseCount: runs.matchingRunCount, maxFalseHours: runs.longestMatchingSpan?.hours ?? 0 }
    : { falseCount: Number.NaN, maxFalseHours: Number.NaN };
}

export function evaluateWindowMetrics(
  analysis: LiveSiteAnalysis,
  missionWindow: MissionWindow,
  config: EngineeringConfig,
  slice: WindowSlice,
): WindowMetrics {
  const { startIdx, endIdx } = slice;
  const count = Math.max(1, endIdx - startIdx + 1);
  const timestamps = missionWindow.timestamps_utc.slice(startIdx, endIdx + 1);
  const samples = analysis.epochStates.slice(startIdx, endIdx + 1);

  let illumSum = 0;
  let dteCount = 0;
  let elfoCount = 0;
  let combinedCount = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    const ep = analysis.epochStates[i];
    illumSum += ep.fIllum;

    if (ep.dteVisible) dteCount++;
    if (ep.elfoConstellationVisible) elfoCount++;
    if (ep.combinedLinkVisible) combinedCount++;
  }

  const shadowStats = analyzeFalseRuns(
    analysis.epochStates,
    startIdx,
    endIdx,
    missionWindow.timestamps_utc,
    (ep) => Number.isFinite(ep.fIllum) ? ep.fIllum > 0 : null,
  );
  const dteBlackouts = analyzeFalseRuns(
    analysis.epochStates,
    startIdx,
    endIdx,
    missionWindow.timestamps_utc,
    (ep) => ep.dteVisible,
  );
  const combBlackouts = analyzeFalseRuns(
    analysis.epochStates,
    startIdx,
    endIdx,
    missionWindow.timestamps_utc,
    (ep) => ep.combinedLinkVisible,
  );

  const meanIllumFraction = illumSum / count;
  const sunlight = integrateSavedSeries(timestamps,
    samples.map(ep => Number.isFinite(ep.fIllum) ? Number(ep.fIllum > 0) : Number.NaN));
  const energy = integrateSavedSeries(timestamps, samples.map(ep => ep.powerW));
  const sunlitHours = sunlight.status === 'known' ? sunlight.valueHours : Number.NaN;
  const energyCycleWh = energy.status === 'known' ? energy.valueHours : Number.NaN;
  const minBatteryWh = count < 2 ? Number.NaN : config.survivalLoadW * shadowStats.maxFalseHours;

  const dteDutyCyclePct = (dteCount / count) * 100;
  const elfoDutyCyclePct = (elfoCount / count) * 100;
  const combinedDutyCyclePct = (combinedCount / count) * 100;
  const relayCoverageGainPct = config.relayEnabled ? combinedDutyCyclePct - dteDutyCyclePct : 0;

  const score = computeCompositeScore(
    analysis.terrain.slopeDeg,
    meanIllumFraction,
    shadowStats.maxFalseHours,
    dteDutyCyclePct,
    combinedDutyCyclePct,
    analysis.terrain.psrDistanceM,
    analysis.terrain.isPsr,
    config.weights,
    config.relayEnabled,
  );

  return {
    meanIllumFraction,
    sunlitHours,
    maxContinuousShadowHours: shadowStats.maxFalseHours,
    energyCycleWh,
    minBatteryWh,
    dteDutyCyclePct,
    elfoDutyCyclePct,
    combinedDutyCyclePct,
    relayCoverageGainPct,
    blackoutCountDte: dteBlackouts.falseCount,
    blackoutCountCombined: combBlackouts.falseCount,
    maxBlackoutDteHours: dteBlackouts.maxFalseHours,
    maxBlackoutCombinedHours: combBlackouts.maxFalseHours,
    score,
  };
}

export function findNearestPrecomputedSite(
  latDeg: number,
  lonEastDeg: number,
  sites: LandingSiteEntry[],
): NearestSiteMatch {
  const degToRad = Math.PI / 180;
  const phi1 = latDeg * degToRad;
  const lam1 = lonEastDeg * degToRad;

  let bestSite = sites[0];
  let bestAngleDeg = Number.POSITIVE_INFINITY;

  for (const site of sites) {
    const phi2 = site.center.latitude_deg * degToRad;
    const lam2 = site.center.longitude_east_deg * degToRad;
    const cosTheta = clamp(
      Math.sin(phi1) * Math.sin(phi2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.cos(lam1 - lam2),
      -1,
      1,
    );
    const angleDeg = Math.acos(cosTheta) / degToRad;
    if (angleDeg < bestAngleDeg) {
      bestAngleDeg = angleDeg;
      bestSite = site;
    }
  }

  return {
    site: bestSite,
    angularDistanceDeg: bestAngleDeg,
    withinLolaCoverage: latDeg <= -80,
  };
}

function describeInstantSky(
  label: string,
  site: LandingSiteEntry,
  analysis: LiveSiteAnalysis,
  epochIdx: number,
  relayEnabled: boolean,
): string {
  const ep = analysis.epochStates[epochIdx];
  const sunEl = site.sky_series.sun_el_deg[epochIdx];
  const earthEl = site.sky_series.earth_el_deg[epochIdx];

  const sunState =
    ep.fIllum >= 0.99
      ? `Sun visible (${sunEl.toFixed(1)}° vs ${ep.horizonAtSunDeg.toFixed(1)}° rim)`
      : ep.fIllum > 0.01
        ? `Sun partial (${(ep.fIllum * 100).toFixed(0)}% disk)`
        : `Sun blocked (${sunEl.toFixed(1)}° vs ${ep.horizonAtSunDeg.toFixed(1)}° rim)`;

  const commsState = ep.dteVisible
    ? `Earth DTE (${earthEl.toFixed(1)}°)`
    : relayEnabled && ep.elfoConstellationVisible
      ? `Earth blocked · ELFO relay active`
      : `Blackout (no DTE or relay)`;

  return `${label} (${site.name}): ${sunState}; ${commsState}.`;
}

export function buildPlainSummary(params: {
  entries: EvaluatedSlotEntry[];
  epochIdx: number;
  currentUtc: string;
  slice: WindowSlice;
  relayEnabled: boolean;
}): PlainLanguageSummary {
  const { entries, epochIdx, currentUtc, slice, relayEnabled } = params;
  const primary = entries[0];

  const offsetNote =
    Math.abs(primary.analysis.terrain.dxM) >= 5 || Math.abs(primary.analysis.terrain.dyM) >= 5
      ? ` (offset dx=${primary.analysis.terrain.dxM.toFixed(0)} m, dy=${primary.analysis.terrain.dyM.toFixed(0)} m)`
      : '';

  const fmtLat = (deg: number) => `${Math.abs(deg).toFixed(2)}° ${deg < 0 ? 'S' : 'N'}`;

  const whereText =
    entries.length === 1
      ? `Observing 1 location: ${primary.label} — ${primary.site.name}${offsetNote} (${fmtLat(primary.analysis.terrain.latitudeDeg)}, ${primary.analysis.terrain.longitudeEastDeg.toFixed(1)}° E).`
      : `Comparing ${entries.length} lunar sites: ${entries
          .map(
            (e) =>
              `${e.label} (${e.site.name}, ${fmtLat(e.analysis.terrain.latitudeDeg)})`,
          )
          .join(' vs ')}.`;

  const nowText = `At ${formatUtcShort(currentUtc)} — ${entries
    .map((e) => describeInstantSky(e.label, e.site, e.analysis, epochIdx, relayEnabled))
    .join(' ')}`;

  const daysNum = slice.totalHours / 24;
  const periodLabel = `${slice.totalHours}h (${daysNum.toFixed(slice.totalHours % 24 === 0 ? 0 : 1)}d)`;
  const periodText =
    entries.length === 1
      ? `Over ${periodLabel}: ${primary.site.name} averages ${(primary.metrics.meanIllumFraction * 100).toFixed(1)}% sunlight (${primary.metrics.sunlitHours.toFixed(0)}h lit, max shadow ${primary.metrics.maxContinuousShadowHours.toFixed(1)}h). Direct-to-Earth ${primary.metrics.dteDutyCyclePct.toFixed(1)}%${relayEnabled ? `, ${primary.metrics.combinedDutyCyclePct.toFixed(1)}% with ELFO relay (max blackout ${primary.metrics.maxBlackoutCombinedHours.toFixed(1)}h)` : ` (max blackout ${primary.metrics.maxBlackoutDteHours.toFixed(1)}h)`}.`
      : `Over ${periodLabel}: ${entries
          .map(
            (e) =>
              `${e.label}: ${(e.metrics.meanIllumFraction * 100).toFixed(1)}% sun, ${e.metrics.combinedDutyCyclePct.toFixed(1)}% link (max blackout ${e.metrics.maxBlackoutCombinedHours.toFixed(1)}h)`,
          )
          .join(' · ')}.`;

  return {
    whereText,
    nowText,
    periodText,
    limitationNote:
      'Preliminary geometric study using LOLA 80 m/px topography and SPICE MOON_ME ephemeris. Does not certify landing safety, power, or communications.',
  };
}
