import { Matrix3, Matrix4, Vector3, Vector4, type Camera } from 'three';

export interface Point2 { x: number; y: number }
export interface Vector3Like { x: number; y: number; z: number }
export interface ScreenRect extends Point2 { width: number; height: number }

export interface OrbitalDirectionsInput {
  /** Visual active-point anchor in Moon object coordinates, not terrain evidence. */
  observerLocal: Vector3Like | null;
  /** Moon-fixed directions already mapped to Three local coordinates (-xME,zME,yME). */
  sunDirectionLocal: Vector3Like | null;
  earthDirectionLocal: Vector3Like | null;
  moonMatrixWorld: Matrix4;
  /** Caller updates camera.matrixWorld before requesting this event-driven layout. */
  camera: Camera;
  viewport: { width: number; height: number };
  reservedRects?: readonly ScreenRect[];
  /** Conservative visual exclusion only; never used for local visibility. */
  moonScreenRect?: ScreenRect;
}

export interface ObserverProjection {
  status: 'visible' | 'far-side' | 'offscreen' | 'behind-camera' | 'unknown';
  point: Point2 | null;
  frontFacing: boolean | null;
  inViewport: boolean;
}

export interface OrbitalDirectionPlacement {
  status: 'ready' | 'head-on' | 'unknown-direction' | 'observer-unavailable' | 'unprojectable';
  marker: Point2 | null;
  /** Positive projected P+t*d, clipped/retracted for drawing; never a body position. */
  directionTip: Point2 | null;
  /** Omitted when the selected point is outside the camera view or on the far side. */
  lineStart: Point2 | null;
  /** Nonphysical layout leader from the projected ray tip to a displaced icon. */
  leaderStart: Point2 | null;
  /** The asymptotic direction is outside the camera field, not locally blocked. */
  offscreen: boolean;
  directionState: 'in-front' | 'behind-camera' | 'parallel' | 'unknown';
  facingViewer: boolean | null;
  labelPosition: Point2 | null;
  labelAnchor: 'start' | 'end';
  /** Screen-coordinate degrees: zero points right. Null means no directional arrow. */
  arrowRotationDeg: number | null;
  layout: 'clear' | 'crowded';
}

export interface OrbitalDirectionsLayout {
  observer: ObserverProjection;
  sun: OrbitalDirectionPlacement;
  earth: OrbitalDirectionPlacement;
}

const EPS = 1e-9;
const LABEL_WIDTH = 150;
const finiteVector = (v: Vector3Like | null): v is Vector3Like => !!v
  && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const validRect = (r: ScreenRect): boolean => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
const distance = (a: Point2, b: Point2): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const inside = (p: Point2, r: ScreenRect): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
const expand = (r: ScreenRect, amount: number): ScreenRect => ({ x: r.x - amount, y: r.y - amount, width: r.width + amount * 2, height: r.height + amount * 2 });
function overlap(a: ScreenRect, b: ScreenRect): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

function emptyBody(status: OrbitalDirectionPlacement['status']): OrbitalDirectionPlacement {
  return {
    status, marker: null, directionTip: null, lineStart: null, leaderStart: null,
    offscreen: false, directionState: 'unknown', facingViewer: null,
    labelPosition: null, labelAnchor: 'start', arrowRotationDeg: null, layout: 'clear',
  };
}

/** Intersection parameters of a screen ray and a rectangle; no arbitrary bearing. */
function rayRect(origin: Point2, direction: Point2, rect: ScreenRect): { enter: number; exit: number } | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (const axis of ['x', 'y'] as const) {
    const low = rect[axis];
    const high = low + (axis === 'x' ? rect.width : rect.height);
    if (Math.abs(direction[axis]) < EPS) {
      if (origin[axis] < low || origin[axis] > high) return null;
      continue;
    }
    const a = (low - origin[axis]) / direction[axis];
    const b = (high - origin[axis]) / direction[axis];
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return enter <= exit && exit >= 0 ? { enter, exit } : null;
}

function labelAt(marker: Point2, width: number): { position: Point2; anchor: 'start' | 'end'; rect: ScreenRect } {
  const rightFits = marker.x + 26 + LABEL_WIDTH <= width - 6;
  const leftFits = marker.x - 26 - LABEL_WIDTH >= 6;
  const anchor = rightFits && (!leftFits || marker.x <= width / 2) ? 'start' : 'end';
  const position = { x: marker.x + (anchor === 'start' ? 26 : -26), y: marker.y + 3 };
  const left = Math.min(marker.x - 32, anchor === 'start' ? position.x : position.x - LABEL_WIDTH);
  const right = Math.max(marker.x + 32, anchor === 'start' ? position.x + LABEL_WIDTH : position.x);
  return { position, anchor, rect: { x: left, y: marker.y - 32, width: right - left, height: 64 } };
}

/**
 * Projection/layout only. No horizon, terrain mesh intersection, illumination or
 * radio criterion enters this function. The direction tip is an illustrative
 * point on the active observer's ray, not a compressed Moon-centered body orbit.
 * The icon may move for layout, always with a separate leader. Camera visibility
 * of the selected point never becomes a local Sun/Earth visibility conclusion.
 */
export function layoutOrbitalDirections(input: OrbitalDirectionsInput): OrbitalDirectionsLayout {
  const { width, height } = input.viewport;
  const unavailable: ObserverProjection = { status: 'unknown', point: null, frontFacing: null, inViewport: false };
  const invalid = () => ({ observer: unavailable, sun: emptyBody('observer-unavailable'), earth: emptyBody('observer-unavailable') });
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !finiteVector(input.observerLocal)) return invalid();
  const matrices = [input.moonMatrixWorld, input.camera.matrixWorld, input.camera.projectionMatrix];
  if (matrices.some(matrix => !matrix.elements.every(Number.isFinite) || !Number.isFinite(matrix.determinant()) || matrix.determinant() === 0)) return invalid();
  const localObserver = new Vector3(input.observerLocal.x, input.observerLocal.y, input.observerLocal.z);
  if (localObserver.lengthSq() < EPS * EPS) return invalid();
  const observerWorld = localObserver.clone().applyMatrix4(input.moonMatrixWorld);
  const view = input.camera.matrixWorld.clone().invert();
  const viewProjection = input.camera.projectionMatrix.clone().multiply(view);
  const cameraObserver = observerWorld.clone().applyMatrix4(view);
  if (cameraObserver.z >= -EPS) {
    return { observer: { ...unavailable, status: 'behind-camera' }, sun: emptyBody('observer-unavailable'), earth: emptyBody('observer-unavailable') };
  }
  const viewport: ScreenRect = { x: 0, y: 0, width, height };
  const screen = (clip: Vector4): Point2 | null => {
    if (Math.abs(clip.w) < EPS) return null;
    const point = { x: (clip.x / clip.w + 1) * width / 2, y: (1 - clip.y / clip.w) * height / 2 };
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  };
  const observerClip = new Vector4(observerWorld.x, observerWorld.y, observerWorld.z, 1).applyMatrix4(viewProjection);
  const observerPoint = screen(observerClip);
  if (!observerPoint) return invalid();
  const normal = localObserver.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(input.moonMatrixWorld));
  const toCamera = new Vector3().setFromMatrixPosition(input.camera.matrixWorld).sub(observerWorld).normalize();
  const frontFacing = normal.dot(toCamera) > 0;
  const inViewport = inside(observerPoint, viewport) && observerClip.z / observerClip.w >= -1 && observerClip.z / observerClip.w <= 1;
  const observer: ObserverProjection = {
    status: !frontFacing ? 'far-side' : !inViewport ? 'offscreen' : 'visible',
    point: observerPoint, frontFacing, inViewport,
  };
  const padX = Math.min(36, width / 4);
  const padTop = Math.min(36, height / 4);
  const padBottom = Math.min(36, height / 4);
  const inner: ScreenRect = { x: padX, y: padTop, width: Math.max(1, width - padX * 2), height: Math.max(1, height - padTop - padBottom) };
  const reserved = (input.reservedRects ?? []).filter(validRect).map(rect => expand(rect, 5));
  const moonRect = input.moonScreenRect && validRect(input.moonScreenRect) ? input.moonScreenRect : null;
  const occupied: ScreenRect[] = [];

  type ScreenRay = { origin: Point2; direction: Point2; maxDistance: number };
  const rayDistance = (point: Point2, ray: ScreenRay): number | null => {
    const x = point.x - ray.origin.x;
    const y = point.y - ray.origin.y;
    const along = x * ray.direction.x + y * ray.direction.y;
    const across = x * ray.direction.y - y * ray.direction.x;
    return Math.abs(across) < 1e-5 && along >= Math.min(32, ray.maxDistance) - EPS && along <= ray.maxDistance + EPS ? along : null;
  };
  const place = (preferred: Point2, bearing: Point2 | null, ray?: ScreenRay) => {
    const bounded = (point: Point2): Point2 => ({ x: clamp(point.x, inner.x, inner.x + inner.width), y: clamp(point.y, inner.y, inner.y + inner.height) });
    const candidates: Point2[] = [bounded(preferred)];
    const alongRay = (amount: number) => {
      if (ray && amount > EPS && amount <= ray.maxDistance) candidates.push({
        x: ray.origin.x + ray.direction.x * amount, y: ray.origin.y + ray.direction.y * amount,
      });
    };
    if (ray) {
      for (const fraction of [1, 0.9, 0.75, 0.5, 0.25]) alongRay(ray.maxDistance * fraction);
      for (const amount of [24, 48, 80, 120, 180]) alongRay(ray.maxDistance - amount);
    }
    if (bearing) {
      for (const step of [24, 48, 80, 120, 180]) {
        for (const sign of [1, -1]) {
          candidates.push(bounded({ x: preferred.x + bearing.x * step * sign, y: preferred.y + bearing.y * step * sign }));
          candidates.push(bounded({ x: preferred.x - bearing.y * step * sign, y: preferred.y + bearing.x * step * sign }));
        }
      }
    }
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const x = inner.x + inner.width * fraction;
      const y = inner.y + inner.height * fraction;
      candidates.push({ x, y: inner.y }, { x, y: inner.y + inner.height }, { x: inner.x, y }, { x: inner.x + inner.width, y });
    }
    // Panel and previously placed label edges reveal narrow free bands that a
    // coarse viewport grid misses, especially between mobile View and footer.
    for (const blocked of [...reserved, ...occupied.map(rect => expand(rect, 5))]) {
      const xs = [blocked.x - 33, blocked.x + blocked.width + 33, blocked.x - 177, blocked.x + blocked.width + 177];
      const ys = [blocked.y - 33, blocked.y + blocked.height + 33];
      for (const x of xs) {
        for (const y of [preferred.y, inner.y, inner.y + inner.height]) candidates.push(bounded({ x, y }));
        if (ray && Math.abs(ray.direction.x) > EPS) alongRay((x - ray.origin.x) / ray.direction.x);
      }
      for (const y of ys) {
        for (const x of [preferred.x, inner.x, inner.x + inner.width, width / 2]) candidates.push(bounded({ x, y }));
        if (ray && Math.abs(ray.direction.y) > EPS) alongRay((y - ray.origin.y) / ray.direction.y);
      }
    }
    let best = candidates[0];
    let bestScore = Infinity;
    let bestClear = false;
    let bestOnRay = false;
    for (const candidate of candidates) {
      const { rect } = labelAt(candidate, width);
      const outside = rect.width * rect.height - overlap(rect, viewport);
      const hudOverlap = reserved.reduce((sum, rect2) => sum + overlap(rect, rect2), 0);
      const bodyOverlap = occupied.reduce((sum, rect2) => sum + overlap(rect, expand(rect2, 5)), 0);
      const moonPenalty = moonRect && overlap(rect, expand(moonRect, 5)) > 0 ? 12 : 0;
      const clear = outside < EPS && hudOverlap < EPS && bodyOverlap < EPS;
      const onRay = !!ray && rayDistance(candidate, ray) !== null;
      const score = outside * 10_000 + hudOverlap * 1000 + bodyOverlap * 1000 + moonPenalty + distance(candidate, preferred);
      if ((clear && !bestClear) || (clear === bestClear && (
        (clear && onRay && !bestOnRay) || ((!clear || onRay === bestOnRay) && score < bestScore)
      ))) {
        best = candidate;
        bestScore = score;
        bestClear = clear;
        bestOnRay = onRay;
      }
    }
    const label = labelAt(best, width);
    occupied.push(label.rect);
    return { marker: best, labelPosition: label.position, labelAnchor: label.anchor, layout: bestClear ? 'clear' as const : 'crowded' as const };
  };

  const body = (directionLocal: Vector3Like | null): OrbitalDirectionPlacement => {
    if (!finiteVector(directionLocal)) return emptyBody('unknown-direction');
    const local = new Vector3(directionLocal.x, directionLocal.y, directionLocal.z);
    if (!Number.isFinite(local.lengthSq()) || local.lengthSq() < EPS * EPS) return emptyBody('unknown-direction');
    const direction = local.transformDirection(input.moonMatrixWorld);
    if (direction.lengthSq() < EPS * EPS) return emptyBody('unprojectable');
    const cameraDirection = direction.clone().transformDirection(view);
    const directionState = cameraDirection.z < -EPS ? 'in-front' : cameraDirection.z > EPS ? 'behind-camera' : 'parallel';
    const facingViewer = direction.dot(toCamera) > 0;
    const clipDirection = new Vector4(direction.x, direction.y, direction.z, 0).applyMatrix4(viewProjection);
    // Derivative of project(P+t*d) at t=0. It cannot flip across the camera plane.
    const dx = (clipDirection.x * observerClip.w - observerClip.x * clipDirection.w) / (observerClip.w * observerClip.w) * width / 2;
    const dy = -(clipDirection.y * observerClip.w - observerClip.y * clipDirection.w) / (observerClip.w * observerClip.w) * height / 2;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) return emptyBody('unprojectable');
    const vanishingPoint = directionState === 'in-front' ? screen(clipDirection) : null;
    const offscreen = directionState !== 'in-front' || (vanishingPoint !== null ? !inside(vanishingPoint, viewport) : length >= 1e-6);
    if (length < 1e-6) {
      return {
        ...emptyBody('head-on'), ...place(observerPoint, null), directionState, facingViewer, offscreen,
      };
    }
    const bearing = { x: dx / length, y: dy / length };
    const worldScale = new Vector3().setFromMatrixScale(input.moonMatrixWorld).length() / Math.sqrt(3);
    let t = Math.max(worldScale * 2, EPS * 10);
    if (cameraDirection.z > EPS) t = Math.min(t, -cameraObserver.z / cameraDirection.z * 0.5);
    // Keep the illustrative endpoint before the actual near clip plane, not
    // merely before z=0, where perspective projection would reverse the ray.
    const nearClearance = observerClip.z + observerClip.w;
    const nearRate = clipDirection.z + clipDirection.w;
    if (nearClearance <= EPS) return emptyBody('unprojectable');
    if (nearRate < -EPS) t = Math.min(t, -nearClearance / nearRate * 0.5);
    const rayPoint = observerWorld.clone().addScaledVector(direction, t);
    const tip = screen(new Vector4(rayPoint.x, rayPoint.y, rayPoint.z, 1).applyMatrix4(viewProjection));
    if (!tip || !Number.isFinite(t) || t <= EPS) return emptyBody('unprojectable');
    const edge = rayRect(observerPoint, bearing, inner);
    const clipEdge = edge ?? rayRect(observerPoint, bearing, viewport);
    const maxDistance = clipEdge ? Math.min(distance(observerPoint, tip), clipEdge.exit) : distance(observerPoint, tip);
    const clippedTip = { x: observerPoint.x + bearing.x * maxDistance, y: observerPoint.y + bearing.y * maxDistance };
    const ray: ScreenRay = { origin: observerPoint, direction: bearing, maxDistance };
    const placed = place(clippedTip, bearing, ray);
    const collinearDistance = rayDistance(placed.marker, ray);
    // Stop at an on-ray icon instead of drawing past it and retracing a leader.
    // For an off-ray callout, choose the nearest positive point on the already
    // clipped ray. This keeps its nonphysical leader short and avoids a huge V.
    const nearest = clamp(
      (placed.marker.x - observerPoint.x) * bearing.x + (placed.marker.y - observerPoint.y) * bearing.y,
      Math.min(1, maxDistance), maxDistance,
    );
    const displayTip = collinearDistance !== null ? placed.marker : {
      x: observerPoint.x + bearing.x * nearest, y: observerPoint.y + bearing.y * nearest,
    };
    return {
      status: 'ready', ...placed, directionTip: maxDistance > EPS ? displayTip : null,
      lineStart: frontFacing && inViewport && maxDistance > EPS ? observerPoint : null,
      leaderStart: observer.status === 'visible' && maxDistance > EPS && collinearDistance === null && inside(displayTip, viewport) && distance(placed.marker, displayTip) > 2 ? displayTip : null,
      offscreen, directionState, facingViewer,
      arrowRotationDeg: offscreen ? Math.atan2(bearing.y, bearing.x) * 180 / Math.PI : null,
    };
  };
  return { observer, sun: body(input.sunDirectionLocal), earth: body(input.earthDirectionLocal) };
}
