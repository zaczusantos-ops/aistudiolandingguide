import { Matrix4, Vector3, type PerspectiveCamera } from 'three';
import { ORBITAL_BODY_RADII, ORBITAL_BODY_RANGES } from './orbitalBodyScale';

export interface Vector3Like { x: number; y: number; z: number }
export interface OrbitalDisplaySphere {
  id: 'moon' | 'earth' | 'sun';
  center: Vector3Like;
  radius: number;
}
export interface OrbitalBodiesLayoutInput {
  observerLocal: Vector3Like | null;
  /** Moon-fixed LOS already mapped into Three object coordinates (-ME.x,ME.z,ME.y). */
  earthDirectionLocal: Vector3Like | null;
  sunDirectionLocal: Vector3Like | null;
  moonMatrixWorld: Matrix4;
  /** Illustrative world display units; these are not ephemeris ranges. */
  ranges?: Partial<{ earth: number; sun: number }>;
  /** Actual visual world radii used for display separation and camera framing. */
  radii?: Partial<{ moon: number; earth: number; sun: number }>;
  separationGap?: number;
}
export interface OrbitalBodiesLayout {
  observerWorld: Vector3 | null;
  moonCenterWorld: Vector3 | null;
  earthPosition: Vector3 | null;
  sunPosition: Vector3 | null;
  /** Directional illumination basis, independent of the compressed proxy positions. */
  sunDirectionWorld: Vector3 | null;
  earthRange: number | null;
  sunRange: number | null;
  spheres: OrbitalDisplaySphere[];
}

const EPS = 1e-9;
const positive = (value: number): boolean => Number.isFinite(value) && value > 0;
const finiteVector = (value: Vector3Like | null): value is Vector3Like => !!value
  && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const vector = (value: Vector3Like): Vector3 => new Vector3(value.x, value.y, value.z);
function validWorldMatrix(matrix: Matrix4): boolean {
  return matrix.elements.every(Number.isFinite) && Number.isFinite(matrix.determinant()) && matrix.determinant() !== 0
    && Math.abs(matrix.elements[3]) < EPS && Math.abs(matrix.elements[7]) < EPS
    && Math.abs(matrix.elements[11]) < EPS && Math.abs(matrix.elements[15] - 1) < EPS;
}

/** Extend only along the same positive ray when the requested display sphere intersects another. */
function separatedRange(origin: Vector3, direction: Vector3, range: number, center: Vector3, requiredDistance: number): number {
  if (origin.clone().addScaledVector(direction, range).distanceToSquared(center) >= requiredDistance * requiredDistance) return range;
  const relative = origin.clone().sub(center);
  const projection = relative.dot(direction);
  const discriminant = projection * projection - relative.lengthSq() + requiredDistance * requiredDistance;
  return Math.max(range, -projection + Math.sqrt(Math.max(0, discriminant)) + 1e-6);
}

/**
 * Place illustrative bodies at P+t*d with t>0. Their bearing is never changed to
 * improve composition. A range may increase only for display-volume separation;
 * this is not lunar occultation, local visibility, physical distance or phase.
 * Unknown directions yield null positions. Inputs, matrices and source vectors
 * are never mutated, and no camera/renderer is controlled here.
 */
export function computeOrbitalBodiesLayout(input: OrbitalBodiesLayoutInput): OrbitalBodiesLayout {
  const result: OrbitalBodiesLayout = {
    observerWorld: null, moonCenterWorld: null, earthPosition: null, sunPosition: null,
    sunDirectionWorld: null, earthRange: null, sunRange: null, spheres: [],
  };
  if (!validWorldMatrix(input.moonMatrixWorld)) return result;
  const center = new Vector3().applyMatrix4(input.moonMatrixWorld);
  result.moonCenterWorld = center;
  const radii = { ...ORBITAL_BODY_RADII, ...input.radii };
  if (!positive(radii.moon)) return result;
  result.spheres.push({ id: 'moon', center: center.clone(), radius: radii.moon });
  const gap = input.separationGap ?? 0.08;
  if (!Number.isFinite(gap) || gap < 0 || !finiteVector(input.observerLocal)) return result;
  const observer = vector(input.observerLocal).applyMatrix4(input.moonMatrixWorld);
  if (![observer.x, observer.y, observer.z].every(Number.isFinite)) return result;
  result.observerWorld = observer;
  const ranges = { ...ORBITAL_BODY_RANGES, ...input.ranges };
  const position = (body: 'earth' | 'sun', source: Vector3Like | null) => {
    if (!finiteVector(source) || !positive(radii[body]) || !positive(ranges[body])) return null;
    const direction = vector(source);
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < EPS * EPS) return null;
    direction.transformDirection(input.moonMatrixWorld);
    if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < EPS * EPS) return null;
    let range = separatedRange(observer, direction, ranges[body], center, radii.moon + radii[body] + gap);
    if (body === 'sun' && result.earthPosition) {
      range = separatedRange(observer, direction, range, result.earthPosition, radii.earth + radii.sun + gap);
    }
    const point = observer.clone().addScaledVector(direction, range);
    if (!positive(range) || ![point.x, point.y, point.z].every(Number.isFinite)) return null;
    return { point, direction, range };
  };
  const earth = position('earth', input.earthDirectionLocal);
  if (earth) {
    result.earthPosition = earth.point;
    result.earthRange = earth.range;
    result.spheres.push({ id: 'earth', center: earth.point.clone(), radius: radii.earth });
  }
  const sun = position('sun', input.sunDirectionLocal);
  if (sun) {
    result.sunPosition = sun.point;
    result.sunDirectionWorld = sun.direction;
    result.sunRange = sun.range;
    result.spheres.push({ id: 'sun', center: sun.point.clone(), radius: radii.sun });
  }
  return result;
}

export interface OrbitalCameraFitInput {
  /** Unparented Explorer camera at its intended viewing direction; never the hero pose. */
  camera: PerspectiveCamera;
  spheres: readonly OrbitalDisplaySphere[];
  target?: Vector3Like;
  /** Fraction of each viewport edge reserved for framing, default 0.06. */
  padding?: number;
  minDistance?: number;
}
export type OrbitalCameraFit =
  | { status: 'ready'; position: Vector3; target: Vector3; up: Vector3; distance: number; near: number; far: number }
  | { status: 'unavailable'; reason: 'no-spheres' | 'invalid-sphere' | 'invalid-camera' | 'invalid-view-direction' | 'far-clip' };

/**
 * Smallest distance along the current camera-to-target axis that contains every
 * complete visual sphere. Target defaults to the Moon center (0,0,0). FOV/aspect,
 * up and clipping planes are preserved. This is a one-shot Explorer framing
 * calculation; callers decide when to apply it, never continuously during drag.
 */
export function fitOrbitalBodiesCamera(input: OrbitalCameraFitInput): OrbitalCameraFit {
  if (input.spheres.length === 0) return { status: 'unavailable', reason: 'no-spheres' };
  if (input.spheres.some(sphere => !finiteVector(sphere.center) || !Number.isFinite(sphere.radius) || sphere.radius < 0)) {
    return { status: 'unavailable', reason: 'invalid-sphere' };
  }
  const { camera } = input;
  const padding = input.padding ?? 0.06;
  const minDistance = input.minDistance ?? 0;
  const target = input.target ?? { x: 0, y: 0, z: 0 };
  if (!finiteVector(target) || !finiteVector(camera.position) || !finiteVector(camera.up) || camera.parent
    || camera.filmOffset !== 0 || camera.view?.enabled
    || !positive(camera.aspect) || !positive(camera.zoom) || !positive(camera.fov) || camera.fov >= 180
    || !positive(camera.near) || !Number.isFinite(camera.far) || camera.far <= camera.near
    || !Number.isFinite(padding) || padding < 0 || padding >= 0.5 || !Number.isFinite(minDistance) || minDistance < 0) {
    return { status: 'unavailable', reason: 'invalid-camera' };
  }
  const targetVector = vector(target);
  const back = camera.position.clone().sub(targetVector);
  if (back.lengthSq() < EPS * EPS || camera.up.lengthSq() < EPS * EPS) return { status: 'unavailable', reason: 'invalid-view-direction' };
  back.normalize();
  const right = camera.up.clone().cross(back);
  if (right.lengthSq() < EPS * EPS) return { status: 'unavailable', reason: 'invalid-view-direction' };
  right.normalize();
  const up = back.clone().cross(right).normalize();
  const tanVertical = Math.tan(camera.fov * Math.PI / 360) / camera.zoom * (1 - 2 * padding);
  const tanHorizontal = tanVertical * camera.aspect;
  if (!positive(tanVertical) || !positive(tanHorizontal)) return { status: 'unavailable', reason: 'invalid-camera' };
  const sinVertical = tanVertical / Math.hypot(1, tanVertical);
  const sinHorizontal = tanHorizontal / Math.hypot(1, tanHorizontal);
  let distance = minDistance;
  for (const sphere of input.spheres) {
    const relative = vector(sphere.center).sub(targetVector);
    const z = relative.dot(back);
    // Signed distances to the four frustum side planes contain the whole sphere.
    distance = Math.max(distance, z + Math.abs(relative.dot(right)) / tanHorizontal + sphere.radius / sinHorizontal,
      z + Math.abs(relative.dot(up)) / tanVertical + sphere.radius / sinVertical,
      z + camera.near + sphere.radius);
  }
  distance += 1e-6;
  if (!positive(distance)) return { status: 'unavailable', reason: 'invalid-camera' };
  for (const sphere of input.spheres) {
    if (distance - vector(sphere.center).sub(targetVector).dot(back) + sphere.radius > camera.far) {
      return { status: 'unavailable', reason: 'far-clip' };
    }
  }
  return { status: 'ready', position: targetVector.clone().addScaledVector(back, distance), target: targetVector, up: camera.up.clone(),
    distance, near: camera.near, far: camera.far };
}

/**
 * Optional one-shot portrait framing: search 36 camera rolls at five-degree
 * spacing and choose the smallest valid fit. Only camera up changes; the viewing
 * axis, target and world spheres remain unchanged. Frustum containment is
 * 180-degree periodic, so test the equivalent roll nearest the original up to
 * avoid an unnecessary upside-down composition. Root chooses when to use this
 * helper (initial preset, saved time or resize), never on every drag/frame.
 */
export function fitOrbitalBodiesContextCamera(input: OrbitalCameraFitInput): OrbitalCameraFit {
  const base = fitOrbitalBodiesCamera(input);
  // A different roll can recover a far-clip failure, but cannot repair invalid
  // source bounds, parameters or an undefined viewing axis.
  if (base.status === 'unavailable' && base.reason !== 'far-clip') return base;
  let best = base.status === 'ready' ? base : null;
  const target = vector(input.target ?? { x: 0, y: 0, z: 0 });
  const back = input.camera.position.clone().sub(target).normalize();
  const originalUp = input.camera.up.clone();
  const candidateCamera = input.camera.clone();
  const angles: number[] = [];
  for (let step = 1; step <= 17; step++) angles.push(step * 5, -step * 5);
  angles.push(90);
  for (const degrees of angles) {
    candidateCamera.up.copy(originalUp).applyAxisAngle(back, degrees * Math.PI / 180);
    const candidate = fitOrbitalBodiesCamera({ ...input, camera: candidateCamera });
    if (candidate.status === 'ready' && (!best || candidate.distance < best.distance - 1e-9)) best = candidate;
  }
  return best ?? base;
}
