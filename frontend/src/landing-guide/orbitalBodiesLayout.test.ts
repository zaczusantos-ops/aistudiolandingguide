import { describe, expect, it } from 'vitest';
import { Frustum, Group, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { bodyDirectionAt } from '../explorer/geometry';
import { ORBITAL_BODY_RADII, ORBITAL_BODY_RANGES } from './orbitalBodyScale';
import { computeOrbitalBodiesLayout, fitOrbitalBodiesCamera, fitOrbitalBodiesContextCamera, type OrbitalBodiesLayoutInput, type OrbitalCameraFit, type OrbitalDisplaySphere } from './orbitalBodiesLayout';

const point = (x: number, y: number, z: number) => new Vector3(x, y, z);
function input(overrides: Partial<OrbitalBodiesLayoutInput> = {}): OrbitalBodiesLayoutInput {
  return {
    observerLocal: point(0, 0, 1.02), earthDirectionLocal: point(1, 0, 0), sunDirectionLocal: point(0, 1, 0),
    moonMatrixWorld: new Matrix4(), ...overrides,
  };
}
const ridge = rawDataset.sites.find(site => site.id === 'shackleton_ridge')!;
function local(latDeg: number, lonDeg: number): Vector3 {
  const lat = latDeg * Math.PI / 180;
  const lon = lonDeg * Math.PI / 180;
  return point(-Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}
function ridgeLayout(epochIdx: number, moonMatrixWorld = new Matrix4().makeRotationX(Math.PI)) {
  const sun = bodyDirectionAt(ridge, epochIdx, 'sun');
  const earth = bodyDirectionAt(ridge, epochIdx, 'earth');
  return computeOrbitalBodiesLayout(input({
    observerLocal: local(ridge.center.latitude_deg, ridge.center.longitude_east_deg).multiplyScalar(1.02),
    sunDirectionLocal: local(sun.latDeg, sun.lonEastDeg), earthDirectionLocal: local(earth.latDeg, earth.lonEastDeg), moonMatrixWorld,
  }));
}
function camera(width = 1440, height = 900): PerspectiveCamera {
  const result = new PerspectiveCamera(34, width / height, 0.1, 100);
  result.position.set(-0.72, 3.15, 1.08);
  result.lookAt(0, 0, 0);
  result.updateMatrixWorld(true);
  return result;
}
function fittedCamera(source: PerspectiveCamera, fit: Extract<OrbitalCameraFit, { status: 'ready' }>): PerspectiveCamera {
  const result = source.clone();
  result.position.copy(fit.position);
  result.up.copy(fit.up);
  result.lookAt(fit.target);
  result.updateMatrixWorld(true);
  return result;
}
function containsSpheres(view: PerspectiveCamera, spheres: readonly OrbitalDisplaySphere[], padding: number): boolean {
  const projection = view.projectionMatrix.clone();
  projection.elements[0] /= 1 - padding * 2;
  projection.elements[5] /= 1 - padding * 2;
  const frustum = new Frustum().setFromProjectionMatrix(projection.multiply(view.matrixWorldInverse));
  return spheres.every(sphere => frustum.planes.every(plane => plane.distanceToPoint(new Vector3(sphere.center.x, sphere.center.y, sphere.center.z)) >= sphere.radius - 1e-7));
}

describe('illustrative orbital body positions', () => {
  it('uses the shared small-body radii/ranges and keeps every body on the active point positive ray', () => {
    const source = input({
      observerLocal: point(0.1, 0.9, 0.3), sunDirectionLocal: point(1, 0, 0), earthDirectionLocal: point(0, 0, 1),
      moonMatrixWorld: new Matrix4().makeTranslation(4, -2, 1).multiply(new Matrix4().makeRotationY(0.6)),
    });
    const result = computeOrbitalBodiesLayout(source);
    const p = point(0.1, 0.9, 0.3).applyMatrix4(source.moonMatrixWorld);
    expect(result.observerWorld!.distanceTo(p)).toBeLessThan(1e-12);
    expect(result.earthRange).toBe(ORBITAL_BODY_RANGES.earth);
    expect(result.sunRange).toBe(ORBITAL_BODY_RANGES.sun);
    for (const [body, original, range] of [
      [result.earthPosition!, point(0, 0, 1), result.earthRange!],
      [result.sunPosition!, point(1, 0, 0), result.sunRange!],
    ] as const) {
      const direction = original.transformDirection(source.moonMatrixWorld);
      expect(body.clone().sub(p).length()).toBeCloseTo(range, 12);
      expect(body.clone().sub(p).normalize().distanceTo(direction)).toBeLessThan(1e-12);
      expect(range).toBeGreaterThan(0);
    }
    expect(result.spheres.map(sphere => sphere.radius)).toEqual([ORBITAL_BODY_RADII.moon, ORBITAL_BODY_RADII.earth, ORBITAL_BODY_RADII.sun]);
  });

  it('increases only positive ray ranges to separate intersecting display volumes', () => {
    const result = computeOrbitalBodiesLayout(input({ earthDirectionLocal: point(0, 0, -1), sunDirectionLocal: point(0, 0, -1) }));
    expect(result.earthRange).toBeGreaterThan(ORBITAL_BODY_RANGES.earth);
    expect(result.sunRange).toBeGreaterThanOrEqual(ORBITAL_BODY_RANGES.sun);
    expect(result.earthPosition!.length()).toBeGreaterThanOrEqual(ORBITAL_BODY_RADII.moon + ORBITAL_BODY_RADII.earth + 0.08);
    expect(result.sunPosition!.length()).toBeGreaterThanOrEqual(ORBITAL_BODY_RADII.moon + ORBITAL_BODY_RADII.sun + 0.08);
    expect(result.sunPosition!.distanceTo(result.earthPosition!)).toBeGreaterThanOrEqual(ORBITAL_BODY_RADII.sun + ORBITAL_BODY_RADII.earth + 0.08);
    for (const p of [result.earthPosition!, result.sunPosition!]) expect(p.clone().sub(result.observerWorld!).normalize().toArray()).toEqual([0, 0, -1]);
  });

  it('uses a directional Sun basis rather than the difference between compressed body positions', () => {
    const result = computeOrbitalBodiesLayout(input({ earthDirectionLocal: point(1, 0, 0), sunDirectionLocal: point(0, 1, 0), ranges: { earth: 5 } }));
    expect(result.sunDirectionWorld!.toArray()).toEqual([0, 1, 0]);
    const proxyDifference = result.sunPosition!.clone().sub(result.earthPosition!).normalize();
    expect(proxyDifference.distanceTo(result.sunDirectionWorld!)).toBeGreaterThan(0.5);
  });

  it.each([0, 168])('keeps the Ridge saved directions at epoch%s even when a local Earth criterion is not met', epochIdx => {
    const result = ridgeLayout(epochIdx);
    expect(result.earthPosition).not.toBeNull();
    expect(result.sunPosition).not.toBeNull();
    const sun = bodyDirectionAt(ridge, epochIdx, 'sun');
    const expected = local(sun.latDeg, sun.lonEastDeg).transformDirection(new Matrix4().makeRotationX(Math.PI));
    expect(result.sunPosition!.clone().sub(result.observerWorld!).normalize().distanceTo(expected)).toBeLessThan(1e-12);
  });

  it('applies own-axis group rotation exactly once to both observer and directions', () => {
    const base = ridgeLayout(0);
    const rotation = new Matrix4().makeRotationZ(0.7).multiply(new Matrix4().makeRotationY(-0.4));
    const rotated = ridgeLayout(0, rotation.clone().multiply(new Matrix4().makeRotationX(Math.PI)));
    expect(rotated.observerWorld!.distanceTo(base.observerWorld!.clone().applyMatrix4(rotation))).toBeLessThan(1e-12);
    expect(rotated.sunPosition!.distanceTo(base.sunPosition!.clone().applyMatrix4(rotation))).toBeLessThan(1e-12);
    expect(rotated.earthPosition!.distanceTo(base.earthPosition!.clone().applyMatrix4(rotation))).toBeLessThan(1e-12);
  });

  it('keeps missing or malformed bodies null and does not mutate inputs', () => {
    for (const direction of [null, point(0, 0, 0), point(NaN, 0, 1), point(Infinity, 0, 1)]) {
      const source = input({ earthDirectionLocal: direction });
      const before = JSON.stringify(source);
      const result = computeOrbitalBodiesLayout(source);
      expect(result.earthPosition).toBeNull();
      expect(result.earthRange).toBeNull();
      expect(result.sunPosition).not.toBeNull();
      expect(result.spheres.map(sphere => sphere.id)).toEqual(['moon', 'sun']);
      expect(JSON.stringify(source)).toBe(before);
    }
    expect(computeOrbitalBodiesLayout(input({ observerLocal: null })).earthPosition).toBeNull();
    expect(computeOrbitalBodiesLayout(input({ moonMatrixWorld: new Matrix4().makeScale(0, 1, 1) })).spheres).toEqual([]);
    expect(computeOrbitalBodiesLayout(input({ ranges: { earth: 0 } })).earthPosition).toBeNull();
  });
});

describe('one-shot Explorer camera fit', () => {
  it.each([[1440, 900], [390, 844], [320, 740]])('contains every complete Ridge15/22 display sphere with padding at %sx%s', (width, height) => {
    for (const epochIdx of [0, 168]) {
      const source = camera(width, height);
      const original = { position: source.position.clone(), quaternion: source.quaternion.clone(), up: source.up.clone(), projection: source.projectionMatrix.clone() };
      const layout = ridgeLayout(epochIdx);
      const fit = fitOrbitalBodiesCamera({ camera: source, spheres: layout.spheres });
      expect(fit.status).toBe('ready');
      if (fit.status !== 'ready') throw new Error(fit.reason);
      const view = fittedCamera(source, fit);
      expect(containsSpheres(view, layout.spheres, 0.06)).toBe(true);
      expect(fit.target.toArray()).toEqual([0, 0, 0]);
      expect(fit.position.clone().normalize().distanceTo(original.position.clone().normalize())).toBeLessThan(1e-12);
      expect(fit.near).toBe(source.near);
      expect(fit.far).toBe(source.far);
      expect(fit.up.equals(original.up)).toBe(true);
      expect(source.position.equals(original.position)).toBe(true);
      expect(source.quaternion.equals(original.quaternion)).toBe(true);
      expect(source.up.equals(original.up)).toBe(true);
      expect(source.projectionMatrix.equals(original.projection)).toBe(true);
    }
  });

  it('chooses the minimum fit distance instead of shrinking the Moon by an arbitrary extra distance', () => {
    const source = camera();
    const layout = ridgeLayout(0);
    const fit = fitOrbitalBodiesCamera({ camera: source, spheres: layout.spheres });
    expect(fit.status).toBe('ready');
    if (fit.status !== 'ready') throw new Error(fit.reason);
    const view = fittedCamera(source, fit);
    view.position.multiplyScalar((fit.distance - 0.01) / fit.distance);
    view.lookAt(fit.target);
    view.updateMatrixWorld(true);
    expect(containsSpheres(view, layout.spheres, 0.06)).toBe(false);
  });

  it('fits the same saved case after a mixed own-axis rotation without changing its bearing', () => {
    const matrix = new Matrix4().makeRotationZ(0.4).multiply(new Matrix4().makeRotationY(-0.7)).multiply(new Matrix4().makeRotationX(Math.PI));
    const layout = ridgeLayout(168, matrix);
    const source = camera(390, 844);
    const fit = fitOrbitalBodiesCamera({ camera: source, spheres: layout.spheres });
    expect(fit.status).toBe('ready');
    if (fit.status !== 'ready') throw new Error(fit.reason);
    expect(containsSpheres(fittedCamera(source, fit), layout.spheres, 0.06)).toBe(true);
    expect(layout.sunPosition!.clone().sub(layout.observerWorld!).normalize().distanceTo(layout.sunDirectionWorld!)).toBeLessThan(1e-12);
  });

  it('keeps a nearby display sphere completely beyond the near plane', () => {
    const source = camera();
    source.position.set(0, 0, 2);
    source.lookAt(0, 0, 0);
    const spheres: OrbitalDisplaySphere[] = [{ id: 'moon', center: point(0, 0, 0), radius: 1.06 }, { id: 'earth', center: point(0, 0, 10), radius: 0.22 }];
    const fit = fitOrbitalBodiesCamera({ camera: source, spheres });
    expect(fit.status).toBe('ready');
    if (fit.status !== 'ready') throw new Error(fit.reason);
    expect(fit.distance).toBeGreaterThan(10 + 0.22 + source.near);
    expect(containsSpheres(fittedCamera(source, fit), spheres, 0.06)).toBe(true);
  });

  it('returns explicit unavailable for unknown bounds or degenerate camera state', () => {
    const source = camera();
    expect(fitOrbitalBodiesCamera({ camera: source, spheres: [] })).toEqual({ status: 'unavailable', reason: 'no-spheres' });
    expect(fitOrbitalBodiesCamera({ camera: source, spheres: [{ id: 'moon', center: point(NaN, 0, 0), radius: 1 }] })).toEqual({ status: 'unavailable', reason: 'invalid-sphere' });
    source.position.set(0, 0, 0);
    expect(fitOrbitalBodiesCamera({ camera: source, spheres: ridgeLayout(0).spheres })).toEqual({ status: 'unavailable', reason: 'invalid-view-direction' });
    source.position.set(0, 2, 0);
    expect(fitOrbitalBodiesCamera({ camera: source, spheres: ridgeLayout(0).spheres })).toEqual({ status: 'unavailable', reason: 'invalid-view-direction' });
    new Group().add(source);
    expect(fitOrbitalBodiesCamera({ camera: source, spheres: ridgeLayout(0).spheres })).toEqual({ status: 'unavailable', reason: 'invalid-camera' });
  });

  it('does not claim a fit that would cross the existing far clip plane', () => {
    const source = camera();
    const fit = fitOrbitalBodiesCamera({ camera: source, spheres: [{ id: 'sun', center: point(0, 0, -200), radius: 1 }] });
    expect(fit).toEqual({ status: 'unavailable', reason: 'far-clip' });
  });
});

describe('optional portrait camera roll fit', () => {
  it.each([[390, 844], [320, 740]])('improves or retains the fit distance and contains complete spheres at %sx%s', (width, height) => {
    for (const epochIdx of [0, 168]) {
      const source = camera(width, height);
      const spheres = ridgeLayout(epochIdx).spheres;
      const before = JSON.stringify({ position: source.position, up: source.up, quaternion: source.quaternion, spheres });
      const fixed = fitOrbitalBodiesCamera({ camera: source, spheres });
      const context = fitOrbitalBodiesContextCamera({ camera: source, spheres });
      expect(fixed.status).toBe('ready');
      expect(context.status).toBe('ready');
      if (fixed.status !== 'ready' || context.status !== 'ready') throw new Error('Expected both visual fits.');
      expect(context.distance).toBeLessThanOrEqual(fixed.distance);
      expect(context.target.toArray()).toEqual([0, 0, 0]);
      expect(context.position.clone().normalize().distanceTo(fixed.position.clone().normalize())).toBeLessThan(1e-12);
      expect(containsSpheres(fittedCamera(source, context), spheres, 0.06)).toBe(true);
      expect(context.near).toBe(fixed.near);
      expect(context.far).toBe(fixed.far);
      expect(JSON.stringify({ position: source.position, up: source.up, quaternion: source.quaternion, spheres })).toBe(before);
    }
  });

  it('makes the portrait Nov 22 Moon larger by requiring less camera distance', () => {
    const source = camera(320, 740);
    const spheres = ridgeLayout(168).spheres;
    const fixed = fitOrbitalBodiesCamera({ camera: source, spheres });
    const context = fitOrbitalBodiesContextCamera({ camera: source, spheres });
    expect(fixed.status).toBe('ready');
    expect(context.status).toBe('ready');
    if (fixed.status !== 'ready' || context.status !== 'ready') throw new Error('Expected both visual fits.');
    expect(context.distance).toBeLessThan(fixed.distance * 0.9);
    expect(context.up.distanceTo(source.up)).toBeGreaterThan(0.01);
  });

  it('can recover a valid roll when the fixed-up fit crosses the existing far plane', () => {
    const source = camera(320, 740);
    source.far = 12;
    source.updateProjectionMatrix();
    const spheres = ridgeLayout(168).spheres;
    expect(fitOrbitalBodiesCamera({ camera: source, spheres })).toEqual({ status: 'unavailable', reason: 'far-clip' });
    const context = fitOrbitalBodiesContextCamera({ camera: source, spheres });
    expect(context.status).toBe('ready');
    if (context.status !== 'ready') throw new Error(context.reason);
    expect(containsSpheres(fittedCamera(source, context), spheres, 0.06)).toBe(true);
    expect(source.far).toBe(12);
  });

  it('preserves explicit unavailable results and original up when no better roll is needed', () => {
    const source = camera(390, 844);
    expect(fitOrbitalBodiesContextCamera({ camera: source, spheres: [] })).toEqual({ status: 'unavailable', reason: 'no-spheres' });
    const context = fitOrbitalBodiesContextCamera({ camera: source, spheres: [{ id: 'moon', center: point(0, 0, 0), radius: 1.06 }] });
    expect(context.status).toBe('ready');
    if (context.status !== 'ready') throw new Error(context.reason);
    expect(context.up.equals(source.up)).toBe(true);
  });
});
