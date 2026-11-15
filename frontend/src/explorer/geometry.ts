import type { NavigatorDatasetV1 } from '../navigator/types';

export type Body = 'sun' | 'earth';
export type HorizonPosition = 'above' | 'below' | 'on';

/** Geometry only. Named dataset entries are structurally compatible. */
export interface ExplorerSite {
  id: string;
  name: string;
  center: { latitude_deg: number; longitude_east_deg: number };
  sky_series: {
    sun_az_deg: number[];
    sun_el_deg: number[];
    earth_az_deg: number[];
    earth_el_deg: number[];
  };
  geometrySource?: 'precomputed' | 'approximate';
}

export interface BodyConditions {
  azimuthDeg: number;
  elevationDeg: number;
  position: HorizonPosition;
  /** A display caution, not an error bound or a terrain obstruction model. */
  nearHorizon: boolean;
}

const DEG = Math.PI / 180;
const AU_KM = 149_597_870.7;
type Vector = [number, number, number];

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Geometry values must be finite.');
  return value;
}

function longitude(value: number): number {
  return ((finite(value) % 360) + 360) % 360;
}

function skyUnitVector(latDeg: number, lonDeg: number, azDeg: number, elDeg: number): Vector {
  const lat = finite(latDeg) * DEG;
  const lon = finite(lonDeg) * DEG;
  const az = finite(azDeg) * DEG;
  const el = finite(elDeg) * DEG;
  const east = Math.cos(el) * Math.sin(az);
  const north = Math.cos(el) * Math.cos(az);
  const up = Math.sin(el);
  return [
    -east * Math.sin(lon) - north * Math.sin(lat) * Math.cos(lon) + up * Math.cos(lat) * Math.cos(lon),
    east * Math.cos(lon) - north * Math.sin(lat) * Math.sin(lon) + up * Math.cos(lat) * Math.sin(lon),
    north * Math.cos(lat) + up * Math.sin(lat),
  ];
}

function project(vector: Vector, latDeg: number, lonDeg: number): { azimuthDeg: number; elevationDeg: number } {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const [x, y, z] = vector;
  const east = -x * Math.sin(lon) + y * Math.cos(lon);
  const north = -x * Math.sin(lat) * Math.cos(lon) - y * Math.sin(lat) * Math.sin(lon) + z * Math.cos(lat);
  const up = x * Math.cos(lat) * Math.cos(lon) + y * Math.cos(lat) * Math.sin(lon) + z * Math.sin(lat);
  return {
    azimuthDeg: longitude(Math.atan2(east, north) / DEG),
    elevationDeg: Math.atan2(up, Math.hypot(east, north)) / DEG,
  };
}

function epochAngles(site: ExplorerSite, epochIdx: number, body: Body) {
  if (!Number.isInteger(epochIdx) || epochIdx < 0) throw new RangeError('Choose an available hourly sample.');
  return {
    azimuthDeg: finite(site.sky_series[`${body}_az_deg`][epochIdx]),
    elevationDeg: finite(site.sky_series[`${body}_el_deg`][epochIdx]),
  };
}

/**
 * Reprojects rounded, SPICE-based samples to a spherical observer. The reference
 * range restores finite-distance parallax; this is not a fresh SPICE calculation.
 * No display atlas, terrain horizon, PSR, power, relay or landing metric is used.
 */
export function createGeometrySite(dataset: NavigatorDatasetV1, latDeg: number, lonEastDeg: number): ExplorerSite {
  if (finite(latDeg) < -90 || latDeg > 90) throw new RangeError('Latitude must be between -90° and 90°.');
  const lon = longitude(lonEastDeg);
  const reference = dataset.sites[0];
  if (!reference) throw new RangeError('A reference site is required.');
  const radius = finite(dataset.provenance.conventions.lunar_radius_m) / 1000;
  if (radius <= 0) throw new RangeError('A positive lunar reference radius is required.');
  const target: Vector = [
    radius * Math.cos(latDeg * DEG) * Math.cos(lon * DEG),
    radius * Math.cos(latDeg * DEG) * Math.sin(lon * DEG),
    radius * Math.sin(latDeg * DEG),
  ];
  const sky: ExplorerSite['sky_series'] = { sun_az_deg: [], sun_el_deg: [], earth_az_deg: [], earth_el_deg: [] };
  const window = dataset.mission_window;
  for (let i = 0; i < window.timestamps_utc.length; i++) {
    for (const body of ['sun', 'earth'] as const) {
      const angles = epochAngles(reference, i, body);
      const unit = skyUnitVector(reference.center.latitude_deg, reference.center.longitude_east_deg, angles.azimuthDeg, angles.elevationDeg);
      const angularRadius = finite(window.earth_angular_radius_deg[i]);
      if (body === 'earth' && (angularRadius <= 0 || angularRadius >= 90)) throw new RangeError('Earth angular radius must be between 0° and 90°.');
      const range = body === 'sun'
        ? finite(window.sun_dist_au[i]) * AU_KM
        : finite(dataset.provenance.conventions.earth_radius_km) / Math.sin(angularRadius * DEG);
      if (range <= 0) throw new RangeError('Body range must be positive.');
      const vector = unit.map((value, axis) => finite(reference.center.cartesian_me_km[axis]) + value * range - target[axis]) as Vector;
      const local = project(vector, latDeg, lon);
      sky[`${body}_az_deg`].push(local.azimuthDeg);
      sky[`${body}_el_deg`].push(local.elevationDeg);
    }
  }
  return {
    id: `geometry_${latDeg.toFixed(6)}_${lon.toFixed(6)}`,
    name: `Approximate point (${Math.abs(latDeg).toFixed(2)}°${latDeg < 0 ? 'S' : 'N'}, ${lon.toFixed(2)}°E)`,
    center: { latitude_deg: latDeg, longitude_east_deg: lon },
    sky_series: sky,
    geometrySource: 'approximate',
  };
}

/** Body line-of-sight direction in the Moon-fixed frame, for the existing globe. */
export function bodyDirectionAt(site: ExplorerSite, epochIdx: number, body: Body): { latDeg: number; lonEastDeg: number } {
  const angles = epochAngles(site, epochIdx, body);
  const [x, y, z] = skyUnitVector(site.center.latitude_deg, site.center.longitude_east_deg, angles.azimuthDeg, angles.elevationDeg);
  return { latDeg: Math.atan2(z, Math.hypot(x, y)) / DEG, lonEastDeg: longitude(Math.atan2(y, x) / DEG) };
}

/** Preserve the exact sign. A small negative angle is never reported as above. */
export function classifyElevation(elevationDeg: number): HorizonPosition {
  finite(elevationDeg);
  return elevationDeg > 0 ? 'above' : elevationDeg < 0 ? 'below' : 'on';
}

export function getConditions(site: ExplorerSite, epochIdx: number): { sun: BodyConditions; earth: BodyConditions } {
  const condition = (body: Body): BodyConditions => {
    const angles = epochAngles(site, epochIdx, body);
    return { ...angles, position: classifyElevation(angles.elevationDeg), nearHorizon: Math.abs(angles.elevationDeg) <= 1 };
  };
  return { sun: condition('sun'), earth: condition('earth') };
}

/** Keep the sign visible even when two decimal places would round to zero. */
export function formatElevation(elevationDeg: number): string {
  finite(elevationDeg);
  const magnitude = Math.abs(elevationDeg);
  if (magnitude === 0) return '0.00°';
  const sign = elevationDeg > 0 ? '+' : '−';
  return `${sign}${magnitude < 0.01 ? '<0.01' : magnitude.toFixed(2)}°`;
}
