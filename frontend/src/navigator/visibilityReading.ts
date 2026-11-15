import { computeSolarIllumFraction } from './math';

export type VisibilityBody = 'sun' | 'earth';
export type VisibilityCriterion = 'center' | 'full-disk' | 'partial-uniform-solar';
export type DiskState = 'full' | 'partial' | 'hidden' | 'not-evaluated';

/** A terrain profile must belong to the actual site/observer, never a display atlas. */
export type VisibilityHorizon =
  | { kind: 'terrain-profile'; azimuthDeg: readonly number[]; elevationDeg: readonly number[] }
  | { kind: 'geometric' }
  | { kind: 'unknown'; reason?: string };

export interface VisibilityReadingInput {
  body: VisibilityBody;
  epochIdx: number;
  series: {
    azimuthDeg: readonly number[];
    elevationDeg: readonly number[];
    angularRadiusDeg?: readonly number[];
  };
  /** Omission means unavailable; a zero geometric horizon always requires explicit opt-in. */
  horizon?: VisibilityHorizon | null;
  criterion: VisibilityCriterion;
}

interface ReadingContext {
  body: VisibilityBody;
  epochIdx: number | null;
  criterion: VisibilityCriterion;
  horizonKind: VisibilityHorizon['kind'];
  azimuthDeg: number | null;
  elevationDeg: number | null;
  angularRadiusDeg: number | null;
}

export interface KnownVisibilityReading extends ReadingContext {
  status: 'known';
  azimuthDeg: number;
  elevationDeg: number;
  horizonElevationDeg: number;
  centerClearanceDeg: number;
  centerPosition: 'above' | 'on' | 'below';
  /** Center/full-disk tests require strictly positive clearance, matching legacy math. */
  criterionSatisfied: boolean;
  /** For partial-uniform-solar this is upper-limb clearance; satisfaction means some area visible. */
  criterionClearanceDeg: number;
  diskState: DiskState;
  /** Geometric area only: uniform circular disk cut by a locally straight skyline. */
  visibleDiskFraction: number | null;
  diskApproximation: 'uniform-disk-locally-straight-horizon' | null;
}

export interface UnknownVisibilityReading extends ReadingContext {
  status: 'unknown';
  reason: 'unavailable-epoch' | 'invalid-direction' | 'missing-horizon' | 'invalid-horizon'
    | 'invalid-angular-radius' | 'missing-angular-radius' | 'unsupported-criterion';
  detail: string | null;
  horizonElevationDeg: null;
  centerClearanceDeg: null;
  centerPosition: null;
  criterionSatisfied: null;
  criterionClearanceDeg: null;
  diskState: null;
  visibleDiskFraction: null;
  diskApproximation: null;
}

export type VisibilityReading = KnownVisibilityReading | UnknownVisibilityReading;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const wrap = (azimuth: number): number => ((azimuth % 360) + 360) % 360;

function unknown(context: ReadingContext, reason: UnknownVisibilityReading['reason'], detail: string | null = null): UnknownVisibilityReading {
  return {
    ...context, status: 'unknown', reason, detail, horizonElevationDeg: null,
    centerClearanceDeg: null, centerPosition: null, criterionSatisfied: null,
    criterionClearanceDeg: null, diskState: null, visibleDiskFraction: null, diskApproximation: null,
  };
}

/** Unlike legacy interpolateHorizon, respect the actual (possibly nonuniform) azimuth bins. */
function terrainElevationAt(azimuth: number, bins: readonly number[], heights: readonly number[]): number | null {
  if (!Array.isArray(bins) || !Array.isArray(heights) || bins.length < 2 || bins.length !== heights.length) return null;
  for (let i = 0; i < bins.length; i++) {
    if (!finite(bins[i]) || bins[i] < 0 || bins[i] >= 360 || (i > 0 && bins[i] <= bins[i - 1])
      || !finite(heights[i]) || Math.abs(heights[i]) > 90) return null;
  }
  const next = bins.findIndex(bin => bin > azimuth);
  const right = next < 0 ? 0 : next;
  const left = (right + bins.length - 1) % bins.length;
  const a = bins[left];
  const b = bins[right] + (right === 0 ? 360 : 0);
  const query = azimuth < a ? azimuth + 360 : azimuth;
  const fraction = (query - a) / (b - a);
  return heights[left] + fraction * (heights[right] - heights[left]);
}

/**
 * One sampled body reading, with an explicit horizon and criterion. Unknown is never
 * a zero horizon or a false visibility flag. No power, relay, RF or terrain-source
 * validation is inferred here. A complete valid profile is a caller assertion.
 */
export function readVisibilityAt(input: VisibilityReadingInput): VisibilityReading {
  const { body, epochIdx, series, horizon, criterion } = input;
  const rawAz = series.azimuthDeg?.[epochIdx];
  const rawEl = series.elevationDeg?.[epochIdx];
  const rawRadius = series.angularRadiusDeg?.[epochIdx];
  const context: ReadingContext = {
    body, epochIdx: Number.isInteger(epochIdx) ? epochIdx : null, criterion, horizonKind: horizon?.kind ?? 'unknown',
    azimuthDeg: finite(rawAz) ? wrap(rawAz) : null,
    elevationDeg: finite(rawEl) && Math.abs(rawEl) <= 90 ? rawEl : null,
    angularRadiusDeg: finite(rawRadius) && rawRadius > 0 && rawRadius < 90 ? rawRadius : null,
  };
  if (!Number.isInteger(epochIdx) || epochIdx < 0 || epochIdx >= series.azimuthDeg?.length
    || epochIdx >= series.elevationDeg?.length || !Array.isArray(series.azimuthDeg) || !Array.isArray(series.elevationDeg)) {
    return unknown(context, 'unavailable-epoch');
  }
  if (!finite(rawAz) || !finite(rawEl) || Math.abs(rawEl) > 90) return unknown(context, 'invalid-direction');
  if (!['center', 'full-disk', 'partial-uniform-solar'].includes(criterion)
    || (criterion === 'partial-uniform-solar' && body !== 'sun')) return unknown(context, 'unsupported-criterion');
  if (series.angularRadiusDeg !== undefined && (!finite(rawRadius) || rawRadius <= 0 || rawRadius >= 90)) {
    return unknown(context, 'invalid-angular-radius');
  }
  if (criterion !== 'center' && rawRadius === undefined) return unknown(context, 'missing-angular-radius');
  if (!horizon || horizon.kind === 'unknown') return unknown(context, 'missing-horizon', horizon?.reason ?? null);
  if (horizon.kind === 'terrain-profile' && (!horizon.azimuthDeg?.length || !horizon.elevationDeg?.length)) {
    return unknown(context, 'missing-horizon');
  }
  const h = horizon.kind === 'geometric' ? 0
    : terrainElevationAt(wrap(rawAz), horizon.azimuthDeg, horizon.elevationDeg);
  if (h === null) return unknown(context, 'invalid-horizon');

  const clearance = rawEl - h;
  const radius = context.angularRadiusDeg;
  // Normalize to a unit disk so the legacy helper's minimum angular-radius
  // guard cannot silently enlarge a small, but valid, supplied test disk.
  const fraction = radius === null ? null : computeSolarIllumFraction(clearance / radius, 0, 1);
  const criterionClearance = criterion === 'center' ? clearance
    : criterion === 'full-disk' ? clearance - radius! : clearance + radius!;
  return {
    ...context, status: 'known', azimuthDeg: wrap(rawAz), elevationDeg: rawEl,
    horizonElevationDeg: h, centerClearanceDeg: clearance,
    centerPosition: clearance > 0 ? 'above' : clearance < 0 ? 'below' : 'on',
    criterionClearanceDeg: criterionClearance,
    criterionSatisfied: criterion === 'partial-uniform-solar' ? fraction! > 0 : criterionClearance > 0,
    // A lower limb tangent to the skyline has full area visible but does not
    // satisfy the strict full-disk clearance test. Keep these answers separate.
    diskState: fraction === null ? 'not-evaluated' : fraction === 1 ? 'full' : fraction === 0 ? 'hidden' : 'partial',
    visibleDiskFraction: fraction,
    diskApproximation: fraction === null ? null : 'uniform-disk-locally-straight-horizon',
  };
}
