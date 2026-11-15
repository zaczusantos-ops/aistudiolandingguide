import type { NavigatorDatasetV1 } from '../navigator/types';
import { createGeometrySite, getConditions, type ExplorerSite } from './geometry';

export interface Scenario {
  site: ExplorerSite;
  epochIdx: number;
  origin: 'precomputed' | 'approximate';
}

export type UtcInputResult =
  | { valid: true; epochIdx: number }
  | { valid: false; error: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function validateEpoch(dataset: NavigatorDatasetV1, epochIdx: number): void {
  if (!Number.isInteger(epochIdx) || epochIdx < 0 || epochIdx >= dataset.mission_window.timestamps_utc.length) {
    throw new RangeError('Choose an available hourly sample.');
  }
}

/** A named scenario exposes sky geometry, without legacy engineering results. */
export function createNamedScenario(dataset: NavigatorDatasetV1, siteId: string, epochIdx = 0): Scenario {
  validateEpoch(dataset, epochIdx);
  const entry = dataset.sites.find(site => site.id === siteId);
  if (!entry) throw new RangeError('Choose a location from the list.');
  const site: ExplorerSite = {
    id: entry.id,
    name: entry.name,
    center: {
      latitude_deg: entry.center.latitude_deg,
      longitude_east_deg: entry.center.longitude_east_deg,
    },
    sky_series: {
      sun_az_deg: entry.sky_series.sun_az_deg,
      sun_el_deg: entry.sky_series.sun_el_deg,
      earth_az_deg: entry.sky_series.earth_az_deg,
      earth_el_deg: entry.sky_series.earth_el_deg,
    },
    geometrySource: 'precomputed',
  };
  getConditions(site, epochIdx);
  return { site, epochIdx, origin: 'precomputed' };
}

/** Arbitrary coordinates use the geometry-only approximation, never an atlas. */
export function createCustomScenario(
  dataset: NavigatorDatasetV1,
  latitudeDeg: number,
  longitudeEastDeg: number,
  epochIdx = 0,
): Scenario {
  validateEpoch(dataset, epochIdx);
  const site = createGeometrySite(dataset, latitudeDeg, longitudeEastDeg);
  getConditions(site, epochIdx);
  return { site, epochIdx, origin: 'approximate' };
}

/** English UTC text with no dependence on the computer's local time zone. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Choose a valid UTC date and time.');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hour}:${minute} UTC`;
}

/** Match an exact sample. Invalid drafts never change or clamp a valid choice. */
export function parseUtcInput(date: string, hour: string, timestamps: string[]): UtcInputResult {
  const cleanDate = date.trim();
  const cleanHour = hour.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return { valid: false, error: 'Choose a valid date using day, month and year.' };
  }
  if (!/^(?:[01]?\d|2[0-3])$/.test(cleanHour)) {
    return { valid: false, error: 'Enter a whole hour from 0 to 23 UTC.' };
  }
  const iso = `${cleanDate}T${cleanHour.padStart(2, '0')}:00:00Z`;
  const value = Date.parse(iso);
  // Date.parse can normalize dates such as 31 November into the next month.
  if (!Number.isFinite(value) || new Date(value).toISOString() !== `${cleanDate}T${cleanHour.padStart(2, '0')}:00:00.000Z`) {
    return { valid: false, error: 'Choose a valid calendar date.' };
  }
  if (timestamps.length === 0) {
    return { valid: false, error: 'No time samples are available.' };
  }
  const epochIdx = timestamps.findIndex(timestamp => Date.parse(timestamp) === value);
  if (epochIdx >= 0) return { valid: true, epochIdx };
  const first = Date.parse(timestamps[0]);
  const last = Date.parse(timestamps[timestamps.length - 1]);
  if (Number.isFinite(first) && Number.isFinite(last) && (value < first || value > last)) {
    return {
      valid: false,
      error: `Choose a time from ${formatUtc(timestamps[0])} to ${formatUtc(timestamps[timestamps.length - 1])}.`,
    };
  }
  return { valid: false, error: 'No saved sample is available at that time. Choose another hour.' };
}

export function formatCoordinates(latitudeDeg: number, longitudeEastDeg: number): string {
  if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90 || !Number.isFinite(longitudeEastDeg)) {
    throw new RangeError('Choose finite lunar coordinates with latitude between −90° and 90°.');
  }
  const longitude = ((longitudeEastDeg % 360) + 360) % 360;
  const roundedLongitude = Number(longitude.toFixed(2)) % 360;
  return `${Math.abs(latitudeDeg).toFixed(2)}° ${latitudeDeg < 0 ? 'S' : 'N'} · ${roundedLongitude.toFixed(2)}° E`;
}
