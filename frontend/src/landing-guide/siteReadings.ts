import { createGeometrySite, formatElevation } from '../explorer/geometry';
import type { ExplorerSite } from '../explorer/geometry';
import { readVisibilityAt } from '../navigator/visibilityReading';
import type { VisibilityHorizon, VisibilityReading } from '../navigator/visibilityReading';
import type { EngineeringConfig, LandingSiteEntry, NavigatorDatasetV1 } from '../navigator/types';

/** Copy and capability boundary for the orbital explorer, separate from visual terrain. */
export interface BodyReadout {
  label: string;
  detail: string;
  angle: string | null;
}

export interface SiteReadout {
  kind: 'terrain' | 'geometric' | 'unknown';
  timestamp: string;
  sun: BodyReadout;
  earth: BodyReadout;
  basis: string;
  energyNote: string;
  communicationNote: string;
  modelNote: string;
  summary?: string;
}

export interface SiteReadoutInput {
  dataset: NavigatorDatasetV1;
  site: LandingSiteEntry;
  terrainHorizonDeg: readonly number[];
  epochIdx: number;
  config: EngineeringConfig;
}

function describeBody(reading: VisibilityReading, geometric: boolean): BodyReadout {
  const name = reading.body === 'sun' ? 'Sun' : 'Earth';
  if (reading.status === 'unknown') {
    return {
      label: reading.reason === 'unavailable-epoch' ? 'No data for this time' : `${name === 'Sun' ? 'Sunlight' : 'Earth view'} not assessed`,
      detail: 'A valid result is unavailable for this point and time.',
      angle: null,
    };
  }
  const angle = `Center ${formatElevation(reading.elevationDeg)} · ${geometric ? 'geometric' : 'terrain'} horizon ${formatElevation(reading.horizonElevationDeg)}`;
  if (geometric || reading.criterion === 'center') {
    const position = reading.centerPosition === 'on' ? 'at' : reading.centerPosition;
    return {
      label: `${name} center ${position} horizon`,
      detail: `${name}'s center is ${position} the ${geometric ? 'geometric' : 'modeled terrain'} horizon. ${geometric ? 'Local terrain and disk visibility are not assessed.' : 'This is a center check, not a whole-disk clearance test.'}`,
      angle,
    };
  }
  if (reading.diskState === 'hidden') {
    return {
      label: name === 'Sun' ? 'No direct sunlight modeled' : 'Earth below modeled horizon',
      detail: `Even ${name === 'Sun' ? "the Sun's" : "Earth's"} upper edge does not clear the modeled terrain horizon.`,
      angle,
    };
  }
  if (reading.diskState === 'partial') {
    return {
      label: `${name} partly in view`,
      detail: `The modeled terrain horizon crosses ${name === 'Sun' ? "the Sun's" : "Earth's"} disk.`,
      angle,
    };
  }
  if (reading.criterion === 'full-disk' && !reading.criterionSatisfied) {
    return { label: 'Earth touches modeled horizon', detail: "Earth's lower edge touches the modeled horizon; the strict whole-disk clearance test does not pass.", angle };
  }
  return {
    label: `Whole ${name} in view`,
    detail: `${name === 'Sun' ? "The Sun's" : "Earth's"} lower edge ${reading.centerClearanceDeg === reading.angularRadiusDeg ? 'touches' : 'clears'} the modeled terrain horizon.`,
    angle,
  };
}

function compactReading(sun: VisibilityReading, earth: VisibilityReading, geometric: boolean): string {
  if (sun.status === 'unknown' || earth.status === 'unknown') return 'Conditions not assessed';
  if (geometric) return `Sun ${formatElevation(sun.elevationDeg)} · Earth ${formatElevation(earth.elevationDeg)} · approx.`;
  const light = sun.diskState === 'full' ? 'Sunlit' : sun.diskState === 'partial' ? 'Partial Sun' : 'No direct Sun';
  const view = earth.criterion === 'center'
    ? `Earth center ${earth.centerPosition}`
    : earth.criterionSatisfied ? 'Earth fully clear'
      : earth.diskState === 'hidden' ? 'Earth out of view'
        : earth.diskState === 'partial' ? 'Earth partly clear' : 'Earth at skyline';
  return `${light} · ${view}`;
}

// Playback rebuilds readouts every tick, so each free point's full 721 epoch track is reconstructed once.
const geometrySkyCache = new WeakMap<NavigatorDatasetV1, Map<string, ExplorerSite['sky_series'] | null>>();

function geometrySky(dataset: NavigatorDatasetV1, latDeg: number, lonEastDeg: number): ExplorerSite['sky_series'] | null {
  let byPoint = geometrySkyCache.get(dataset);
  if (!byPoint) {
    byPoint = new Map();
    geometrySkyCache.set(dataset, byPoint);
  }
  const key = `${latDeg},${lonEastDeg}`;
  if (!byPoint.has(key)) {
    try {
      byPoint.set(key, createGeometrySite(dataset, latDeg, lonEastDeg).sky_series);
    } catch {
      byPoint.set(key, null);
    }
  }
  return byPoint.get(key) ?? null;
}

/**
 * Catalogued points use their sampled terrain profile and legacy disk criteria.
 * Free points deliberately bypass the visual atlas and its engineering scaffold:
 * reconstruct approximate sky geometry on the reference sphere instead.
 */
export function buildSiteReadout({ dataset, site, terrainHorizonDeg, epochIdx, config }: SiteReadoutInput): SiteReadout {
  const catalogued = dataset.sites.some(candidate => candidate.id === site.id);
  const geometric = !catalogued;
  let sky: ExplorerSite['sky_series'] = site.sky_series;
  let horizon: VisibilityHorizon = catalogued
    ? { kind: 'terrain-profile', azimuthDeg: dataset.horizon_azimuths_deg, elevationDeg: terrainHorizonDeg }
    : { kind: 'geometric' };
  if (geometric) {
    const cached = geometrySky(dataset, site.center.latitude_deg, site.center.longitude_east_deg);
    if (cached) {
      sky = cached;
    } else {
      sky = { sun_az_deg: [], sun_el_deg: [], earth_az_deg: [], earth_el_deg: [] };
      horizon = { kind: 'unknown', reason: 'Approximate sky geometry is unavailable.' };
    }
  }
  const sun = readVisibilityAt({
    body: 'sun', epochIdx,
    series: { azimuthDeg: sky.sun_az_deg, elevationDeg: sky.sun_el_deg, ...(geometric ? {} : { angularRadiusDeg: dataset.mission_window.solar_angular_radius_deg }) },
    horizon, criterion: geometric ? 'center' : 'partial-uniform-solar',
  });
  const earth = readVisibilityAt({
    body: 'earth', epochIdx,
    series: { azimuthDeg: sky.earth_az_deg, elevationDeg: sky.earth_el_deg, ...(geometric ? {} : { angularRadiusDeg: dataset.mission_window.earth_angular_radius_deg }) },
    horizon, criterion: geometric || config.dteMarginMode === 'center' ? 'center' : 'full-disk',
  });
  const available = sun.status === 'known' && earth.status === 'known';
  return {
    kind: available ? geometric ? 'geometric' : 'terrain' : 'unknown',
    timestamp: dataset.mission_window.timestamps_utc[epochIdx] ?? 'Time unavailable',
    sun: describeBody(sun, geometric),
    earth: describeBody(earth, geometric),
    basis: !available ? 'Data unavailable' : geometric ? 'Approximate geometry · geometric horizon' : 'LOLA terrain horizon · SPICE sky samples',
    energyNote: !available ? 'Energy is not assessed.' : geometric
      ? 'The center angle alone does not determine sunlight at the surface. Local terrain and panel output are not assessed.'
      : sun.diskState === 'hidden'
        ? 'No direct sunlight in this sample. Stored energy and other power sources are not assessed.'
        : 'Sunlight can supply solar panels. Output depends on orientation, area, efficiency and conditions.',
    communicationNote: 'Earth visibility is one condition for direct communication. Antennas, pointing, ground stations and radio performance also matter; a working radio link is not assessed.',
    modelNote: geometric
      ? 'Sky directions are reconstructed from rounded SPICE-based samples for an observer on the reference sphere. The geometric horizon is its tangent plane. Local obstruction, PSR, power and relay availability are not calculated. Rendered relief is visual context.'
      : `Hourly samples from ${dataset.mission_window.start_utc} to ${dataset.mission_window.end_utc}. Disk visibility approximates a uniform disk against the horizon at its central azimuth. Sky positions refer to the catalogued site center; terrain within the local grid is interpolated. Rendered relief is visual context, separate from this sampled terrain horizon.`,
    summary: compactReading(sun, earth, geometric),
  };
}
