import { describe, expect, it } from 'vitest';
import { readVisibilityAt, type VisibilityReadingInput } from './visibilityReading';

/** All geometry below is synthetic test input, not a lunar dataset or validation claim. */
const sample = (overrides: Partial<VisibilityReadingInput> = {}): VisibilityReadingInput => ({
  body: 'sun', epochIdx: 0, criterion: 'partial-uniform-solar',
  series: { azimuthDeg: [0], elevationDeg: [0], angularRadiusDeg: [0.25] },
  horizon: { kind: 'geometric' }, ...overrides,
});

describe('explicit visibility readings', () => {
  it('reports half a uniform solar disk without calling the centre above the horizon', () => {
    expect(readVisibilityAt(sample())).toMatchObject({
      status: 'known', horizonKind: 'geometric', centerPosition: 'on', centerClearanceDeg: 0,
      diskState: 'partial', visibleDiskFraction: 0.5, criterionSatisfied: true,
      diskApproximation: 'uniform-disk-locally-straight-horizon',
    });
    expect(readVisibilityAt(sample({ criterion: 'center' }))).toMatchObject({ criterionSatisfied: false, diskState: 'partial' });
  });

  it('distinguishes Earth centre visibility from strict full-disk clearance', () => {
    const earth = sample({ body: 'earth', criterion: 'full-disk', series: { azimuthDeg: [100], elevationDeg: [0.5], angularRadiusDeg: [1] } });
    expect(readVisibilityAt(earth)).toMatchObject({
      status: 'known', centerPosition: 'above', diskState: 'partial', criterionSatisfied: false,
      centerClearanceDeg: 0.5, criterionClearanceDeg: -0.5,
    });
    expect(readVisibilityAt({ ...earth, criterion: 'center' })).toMatchObject({ criterionSatisfied: true, diskState: 'partial' });
  });

  it('preserves solar-area and strict-clearance conventions at tangency', () => {
    const tangent = sample({ series: { azimuthDeg: [0], elevationDeg: [0.25], angularRadiusDeg: [0.25] } });
    expect(readVisibilityAt(tangent)).toMatchObject({ visibleDiskFraction: 1, diskState: 'full', criterionSatisfied: true });
    expect(readVisibilityAt({ ...tangent, criterion: 'full-disk' })).toMatchObject({ visibleDiskFraction: 1, criterionClearanceDeg: 0, criterionSatisfied: false });
    expect(readVisibilityAt(sample({ series: { azimuthDeg: [0], elevationDeg: [-0.25], angularRadiusDeg: [0.25] } }))).toMatchObject({ visibleDiskFraction: 0, diskState: 'hidden', criterionSatisfied: false });
  });

  it('uses the supplied negative terrain horizon rather than silently assuming zero', () => {
    const input = sample({ criterion: 'center', series: { azimuthDeg: [0], elevationDeg: [-1] }, horizon: { kind: 'terrain-profile', azimuthDeg: [0, 180], elevationDeg: [-2, -2] } });
    expect(readVisibilityAt(input)).toMatchObject({ status: 'known', horizonKind: 'terrain-profile', horizonElevationDeg: -2, centerClearanceDeg: 1, criterionSatisfied: true, diskState: 'not-evaluated', visibleDiskFraction: null });
    expect(readVisibilityAt({ ...input, horizon: { kind: 'geometric' } })).toMatchObject({ centerClearanceDeg: -1, criterionSatisfied: false });
  });

  it('interpolates actual nonuniform bins periodically across 359/0 and equivalent long turns', () => {
    const input = sample({ criterion: 'center', horizon: { kind: 'terrain-profile', azimuthDeg: [10, 90, 350], elevationDeg: [2, 7, -2] } });
    for (const az of [359, -1, 719]) {
      expect(readVisibilityAt({ ...input, series: { azimuthDeg: [az], elevationDeg: [0] } })).toMatchObject({ horizonElevationDeg: expect.closeTo(-0.2, 10) });
    }
    expect(readVisibilityAt({ ...input, series: { azimuthDeg: [0], elevationDeg: [0] } })).toMatchObject({ horizonElevationDeg: 0 });
    expect(readVisibilityAt({ ...input, series: { azimuthDeg: [90], elevationDeg: [0] } })).toMatchObject({ horizonElevationDeg: 7 });
  });

  it('keeps missing or malformed terrain unknown while preserving valid direction', () => {
    const cases: VisibilityReadingInput['horizon'][] = [
      undefined,
      null,
      { kind: 'unknown', reason: 'No physical DEM for this point.' },
      { kind: 'terrain-profile', azimuthDeg: [], elevationDeg: [] },
      { kind: 'terrain-profile', azimuthDeg: [0, 180], elevationDeg: [1] },
      { kind: 'terrain-profile', azimuthDeg: [0, 180], elevationDeg: [1, NaN] },
      { kind: 'terrain-profile', azimuthDeg: [180, 0], elevationDeg: [1, 2] },
      { kind: 'terrain-profile', azimuthDeg: [0, 0], elevationDeg: [1, 2] },
      { kind: 'terrain-profile', azimuthDeg: [0, Infinity], elevationDeg: [1, 2] },
    ];
    for (const horizon of cases) {
      expect(readVisibilityAt(sample({ horizon }))).toMatchObject({ status: 'unknown', azimuthDeg: 0, elevationDeg: 0, horizonElevationDeg: null, criterionSatisfied: null, diskState: null, visibleDiskFraction: null });
    }
  });

  it('reads first and last samples but never clamps or extrapolates an unavailable epoch', () => {
    const input = sample({ series: { azimuthDeg: [1, 2], elevationDeg: [-2, 2], angularRadiusDeg: [0.25, 0.25] } });
    expect(readVisibilityAt(input)).toMatchObject({ status: 'known', elevationDeg: -2, diskState: 'hidden' });
    expect(readVisibilityAt({ ...input, epochIdx: 1 })).toMatchObject({ status: 'known', elevationDeg: 2, diskState: 'full' });
    for (const epochIdx of [-1, 2, 0.5, NaN, Infinity]) {
      expect(readVisibilityAt({ ...input, epochIdx })).toMatchObject({ status: 'unknown', reason: 'unavailable-epoch', criterionSatisfied: null });
    }
  });

  it('does not invent a radius, accept nonfinite inputs, or apply the solar criterion to Earth', () => {
    expect(readVisibilityAt(sample({ series: { azimuthDeg: [0], elevationDeg: [0] } }))).toMatchObject({ status: 'unknown', reason: 'missing-angular-radius' });
    for (const radius of [NaN, Infinity, 0, -1, 90]) {
      expect(readVisibilityAt(sample({ series: { azimuthDeg: [0], elevationDeg: [0], angularRadiusDeg: [radius] } }))).toMatchObject({ status: 'unknown', reason: 'invalid-angular-radius' });
    }
    for (const elevation of [NaN, Infinity, 91]) {
      expect(readVisibilityAt(sample({ series: { azimuthDeg: [0], elevationDeg: [elevation], angularRadiusDeg: [0.25] } }))).toMatchObject({ status: 'unknown', reason: 'invalid-direction' });
    }
    expect(readVisibilityAt(sample({ series: { azimuthDeg: [NaN], elevationDeg: [0], angularRadiusDeg: [0.25] } }))).toMatchObject({ status: 'unknown', azimuthDeg: null });
    expect(readVisibilityAt(sample({ body: 'earth' }))).toMatchObject({ status: 'unknown', reason: 'unsupported-criterion' });
  });

  it('keeps a partially risen Sun distinct from its centre test at any supplied disk scale', () => {
    for (const radius of [0.25, 1e-8]) {
      const reading = readVisibilityAt(sample({ criterion: 'center', series: { azimuthDeg: [0], elevationDeg: [-radius / 2], angularRadiusDeg: [radius] } }));
      expect(reading).toMatchObject({ status: 'known', centerPosition: 'below', criterionSatisfied: false, diskState: 'partial' });
      expect(reading.visibleDiskFraction).toBeCloseTo(1 / 3 - Math.sqrt(3) / (4 * Math.PI), 12);
    }
  });
});
