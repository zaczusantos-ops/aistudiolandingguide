import { describe, expect, it } from 'vitest';
import { Matrix4, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { layoutOrbitalDirections, type OrbitalDirectionsInput, type Point2, type ScreenRect } from './orbitalDirections';

/** Synthetic camera geometry only; none of these inputs are lunar visibility results. */
function scene(width = 1440, height = 900, overrides: Partial<OrbitalDirectionsInput> = {}): OrbitalDirectionsInput {
  const camera = new PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return {
    observerLocal: { x: 0, y: 0, z: 1.04 }, sunDirectionLocal: { x: 1, y: 0, z: 0 },
    earthDirectionLocal: { x: -1, y: 0, z: 0 }, moonMatrixWorld: new Matrix4(), camera,
    viewport: { width, height }, ...overrides,
  };
}
function projected(point: Vector3, input: OrbitalDirectionsInput): Point2 {
  const ndc = point.clone().project(input.camera);
  return { x: (ndc.x + 1) * input.viewport.width / 2, y: (1 - ndc.y) * input.viewport.height / 2 };
}
const area = (a: ScreenRect, b: ScreenRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

describe('orbital direction projection', () => {
  it('starts the ray at the active observer and preserves the positive P+t*d bearing', () => {
    const observer = new Vector3(0.55, 0.2, 0.85);
    const direction = new Vector3(0.7, 0.2, -0.4).normalize();
    const input = scene(1440, 900, { observerLocal: observer, sunDirectionLocal: direction });
    const output = layoutOrbitalDirections(input);
    const start = projected(observer, input);
    const expectedTip = projected(observer.clone().addScaledVector(direction, 2), input);
    expect(output.observer.status).toBe('visible');
    expect(output.sun.status).toBe('ready');
    expect(output.sun.lineStart).toEqual(output.observer.point);
    expect(output.sun.lineStart!.x).toBeCloseTo(start.x, 9);
    expect(output.sun.lineStart!.y).toBeCloseTo(start.y, 9);
    expect(output.sun.directionTip!.x).toBeCloseTo(expectedTip.x, 9);
    expect(output.sun.directionTip!.y).toBeCloseTo(expectedTip.y, 9);
    const otherTip = projected(observer.clone().addScaledVector(direction, 0.2), input);
    const a = { x: output.sun.directionTip!.x - start.x, y: output.sun.directionTip!.y - start.y };
    const b = { x: otherTip.x - start.x, y: otherTip.y - start.y };
    expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 7);
    expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0);
    // A Moon-centered proxy would change the bearing and is deliberately not used.
    const wrongTip = projected(direction.clone().multiplyScalar(2), input);
    expect(Math.hypot(wrongTip.x - expectedTip.x, wrongTip.y - expectedTip.y)).toBeGreaterThan(20);
  });

  it('keeps offscreen direction hints without treating them as local obstruction', () => {
    const output = layoutOrbitalDirections(scene());
    expect(output.sun).toMatchObject({ status: 'ready', offscreen: true, directionState: 'parallel' });
    expect(output.sun.arrowRotationDeg).toBeCloseTo(0, 9);
    expect(output.earth).toMatchObject({ status: 'ready', offscreen: true, directionState: 'parallel' });
    expect(Math.abs(output.earth.arrowRotationDeg!)).toBe(180);
    expect(output.sun.marker!.x).toBeGreaterThan(output.observer.point!.x);
    expect(output.earth.marker!.x).toBeLessThan(output.observer.point!.x);
    expect(output.sun.lineStart).toEqual(output.observer.point);
  });

  it('applies the same own-axis rotation to the observer and both direction vectors', () => {
    const output = layoutOrbitalDirections(scene(1440, 900, { moonMatrixWorld: new Matrix4().makeRotationZ(Math.PI / 2) }));
    expect(output.sun.arrowRotationDeg).toBeCloseTo(-90, 9);
    expect(output.earth.arrowRotationDeg).toBeCloseTo(90, 9);
    expect(output.observer.point!.x).toBeCloseTo(720, 9);
    expect(output.sun.marker!.y).toBeLessThan(output.observer.point!.y);
  });

  it('keeps direction icons when the selected point is on the far side, but removes its connection', () => {
    const output = layoutOrbitalDirections(scene(1440, 900, { observerLocal: { x: 0.3, y: 0, z: -1 } }));
    expect(output.observer).toMatchObject({ status: 'far-side', frontFacing: false });
    expect(output.sun).toMatchObject({ status: 'ready', lineStart: null, leaderStart: null });
    expect(output.sun.marker).not.toBeNull();
    expect(output.earth.marker).not.toBeNull();
  });

  it('returns explicit head-on callouts instead of inventing an arbitrary arrow bearing', () => {
    const output = layoutOrbitalDirections(scene(1440, 900, {
      sunDirectionLocal: { x: 0, y: 0, z: 1 }, earthDirectionLocal: { x: 0, y: 0, z: -1 },
    }));
    expect(output.sun).toMatchObject({ status: 'head-on', facingViewer: true, directionState: 'behind-camera', directionTip: null, lineStart: null, arrowRotationDeg: null });
    expect(output.earth).toMatchObject({ status: 'head-on', facingViewer: false, directionState: 'in-front', directionTip: null, arrowRotationDeg: null });
    expect(output.sun.marker).not.toBeNull();
    expect(output.earth.marker).not.toBeNull();
    expect(output.sun.marker).not.toEqual(output.earth.marker);
  });

  it('keeps a toward-camera ray tip before the near plane without reversing its bearing', () => {
    const input = scene();
    input.camera.position.set(0, 0, 1.15);
    input.camera.lookAt(0, 0, 0);
    input.camera.updateMatrixWorld(true);
    input.observerLocal = { x: 0.02, y: 0, z: 1 };
    input.sunDirectionLocal = { x: 0.3, y: 0, z: 1 };
    const output = layoutOrbitalDirections(input);
    expect(output.sun).toMatchObject({ status: 'ready', directionState: 'behind-camera', offscreen: true, facingViewer: true });
    expect(output.sun.directionTip!.x).toBeGreaterThan(output.observer.point!.x);
    expect(output.sun.arrowRotationDeg).toBeCloseTo(0, 9);
    // Reconstruct the positive proxy endpoint using its projected x for this ray.
    const camera = input.camera as PerspectiveCamera;
    const d = new Vector3(0.3, 0, 1).normalize();
    const t = (0.15 - camera.near) / d.z * 0.5;
    const q = new Vector3(0.02, 0, 1).addScaledVector(d, t);
    const ndc = q.clone().project(camera);
    expect(ndc.z).toBeGreaterThan(-1);
    expect(ndc.z).toBeLessThan(1);
    expect(output.sun.directionTip!.x).toBeCloseTo(projected(q, input).x, 7);
  });

  it('distinguishes a selected point behind the camera from a locally hidden body', () => {
    const output = layoutOrbitalDirections(scene(1440, 900, { observerLocal: { x: 0, y: 0, z: 6 } }));
    expect(output.observer).toMatchObject({ status: 'behind-camera', point: null, frontFacing: null });
    expect(output.sun).toMatchObject({ status: 'observer-unavailable', marker: null });
    expect(output.earth).toMatchObject({ status: 'observer-unavailable', marker: null });
  });

  it('keeps direction hints when a front-facing selected point lies outside the viewport', () => {
    const output = layoutOrbitalDirections(scene(320, 1200, { observerLocal: { x: 0.8, y: 0, z: 0.66 } }));
    expect(output.observer).toMatchObject({ status: 'offscreen', frontFacing: true, inViewport: false });
    expect(output.sun.lineStart).toBeNull();
    expect(output.sun.marker).not.toBeNull();
    expect(output.earth.marker).not.toBeNull();
  });

  it('keeps missing, zero and nonfinite directions unavailable without a fabricated default', () => {
    for (const direction of [null, { x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 1 }, { x: Infinity, y: 0, z: 1 }]) {
      const output = layoutOrbitalDirections(scene(1440, 900, { sunDirectionLocal: direction }));
      expect(output.sun).toMatchObject({ status: 'unknown-direction', marker: null, directionTip: null, arrowRotationDeg: null });
      expect(output.earth.status).toBe('ready');
    }
  });

  it('does not mutate camera, matrices or caller vectors', () => {
    const input = scene();
    const snapshot = JSON.stringify({ matrix: input.moonMatrixWorld.elements, camera: input.camera.matrixWorld.elements, observer: input.observerLocal, sun: input.sunDirectionLocal });
    layoutOrbitalDirections(input);
    expect(JSON.stringify({ matrix: input.moonMatrixWorld.elements, camera: input.camera.matrixWorld.elements, observer: input.observerLocal, sun: input.sunDirectionLocal })).toBe(snapshot);
  });
});

describe('passive icon layout', () => {
  it.each([[320, 740], [390, 844], [1440, 900]])('keeps both icons and short two-line labels inside %sx%s', (width, height) => {
    const output = layoutOrbitalDirections(scene(width, height));
    for (const body of [output.sun, output.earth]) {
      expect(body.marker).not.toBeNull();
      expect(body.marker!.x).toBeGreaterThanOrEqual(20);
      expect(body.marker!.x).toBeLessThanOrEqual(width - 20);
      expect(body.marker!.y).toBeGreaterThanOrEqual(22);
      expect(body.marker!.y + 32).toBeLessThanOrEqual(height);
      expect(body.marker!.x - 32).toBeGreaterThanOrEqual(0);
      expect(body.marker!.x + 32).toBeLessThanOrEqual(width);
      expect(body.marker!.y - 32).toBeGreaterThanOrEqual(0);
      expect(body.marker!.y + 32).toBeLessThanOrEqual(height);
      const labelLeft = body.labelAnchor === 'start' ? body.labelPosition!.x : body.labelPosition!.x - 150;
      expect(labelLeft).toBeGreaterThanOrEqual(0);
      expect(labelLeft + 150).toBeLessThanOrEqual(width);
    }
  });

  it('avoids reserved HUD and separates icons while preferring clear positive-ray positions', () => {
    const reservedRects = [{ x: 1150, y: 300, width: 290, height: 260 }, { x: 0, y: 0, width: 290, height: 190 }];
    const moonScreenRect = { x: 480, y: 220, width: 480, height: 480 };
    const output = layoutOrbitalDirections(scene(1440, 900, {
      earthDirectionLocal: { x: 1, y: 0, z: 0 }, reservedRects, moonScreenRect,
    }));
    expect(output.sun.marker).not.toEqual(output.earth.marker);
    for (const body of [output.sun, output.earth]) {
      expect(body.layout).toBe('clear');
      expect(body.directionTip).toEqual(body.marker);
      expect(body.leaderStart).toBeNull();
      const icon = { x: body.marker!.x - 18, y: body.marker!.y - 18, width: 36, height: 36 };
      for (const blocked of reservedRects) expect(area(icon, blocked)).toBe(0);
    }
    expect(Math.hypot(output.sun.marker!.x - output.earth.marker!.x, output.sun.marker!.y - output.earth.marker!.y)).toBeGreaterThan(40);
  });

  it('reports crowded layout rather than hiding the directions when no free area exists', () => {
    const output = layoutOrbitalDirections(scene(320, 740, { reservedRects: [{ x: 0, y: 0, width: 320, height: 740 }] }));
    expect(output.sun).toMatchObject({ status: 'ready', layout: 'crowded' });
    expect(output.earth).toMatchObject({ status: 'ready', layout: 'crowded' });
    expect(output.sun.marker).not.toBeNull();
  });

  it('handles orthographic rays without pretending a parallel screen displacement has a finite vanishing point', () => {
    const camera = new OrthographicCamera(-3, 3, 2, -2, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const output = layoutOrbitalDirections(scene(1440, 900, { camera }));
    expect(output.sun).toMatchObject({ status: 'ready', offscreen: true });
    expect(output.sun.arrowRotationDeg).toBeCloseTo(0, 9);
  });

  it('returns explicit unknown for invalid viewport or observer input', () => {
    for (const input of [scene(0, 900), scene(1440, 900, { observerLocal: null }), scene(1440, 900, { observerLocal: { x: 0, y: NaN, z: 1 } })]) {
      const output = layoutOrbitalDirections(input);
      expect(output.observer.status).toBe('unknown');
      expect(output.sun.marker).toBeNull();
      expect(output.earth.marker).toBeNull();
    }
  });
});

describe('integrated orbital layout regressions', () => {
  /** Camera/directions from the reviewed Nov 15 orbital screenshot; layout fixtures are visual only. */
  function integrated(width: number, height: number): OrbitalDirectionsInput {
    const camera = new PerspectiveCamera(34, width / height, 0.1, 100);
    const narrowScale = width / height < 0.9 ? Math.max(1, 0.88 / (width / height)) : 1;
    camera.position.set(-0.72 * narrowScale, 3.15 * narrowScale, 1.08 * narrowScale);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const lat = -89.45 * Math.PI / 180;
    const lon = 222.5 * Math.PI / 180;
    return scene(width, height, {
      camera, moonMatrixWorld: new Matrix4().makeRotationX(Math.PI),
      observerLocal: { x: -Math.cos(lat) * Math.cos(lon) * 1.003, y: Math.sin(lat) * 1.003, z: Math.cos(lat) * Math.sin(lon) * 1.003 },
      sunDirectionLocal: { x: 0.4134512871745059, y: -0.02716528543296086, z: 0.9101209152640596 },
      earthDirectionLocal: { x: -0.9970358200560776, y: 0.06197149152071788, z: -0.04559723416834374 },
    });
  }
  function groupBox(marker: Point2, label: Point2, anchor: 'start' | 'end'): ScreenRect {
    const left = Math.min(marker.x - 32, anchor === 'start' ? label.x : label.x - 150);
    const right = Math.max(marker.x + 32, anchor === 'start' ? label.x + 150 : label.x);
    return { x: left, y: marker.y - 32, width: right - left, height: 64 };
  }

  it('clips offscreen proxy tips on the positive ray and avoids a huge return V in the desktop view', () => {
    const input = integrated(1440, 1024);
    input.moonScreenRect = { x: 180, y: 0, width: 1080, height: 1024 };
    input.reservedRects = [
      { x: 0, y: 0, width: 260, height: 76 }, { x: 688, y: 18, width: 64, height: 48 },
      { x: 0, y: 82, width: 470, height: 55 }, { x: 548, y: 870, width: 350, height: 130 },
      { x: 1310, y: 930, width: 120, height: 64 }, { x: 0, y: 930, width: 290, height: 64 },
    ];
    const output = layoutOrbitalDirections(input);
    for (const [body, direction] of [[output.sun, input.sunDirectionLocal!], [output.earth, input.earthDirectionLocal!]] as const) {
      expect(body.layout).toBe('clear');
      expect(body.lineStart).not.toBeNull();
      expect(body.directionTip!.x).toBeGreaterThanOrEqual(36);
      expect(body.directionTip!.x).toBeLessThanOrEqual(1404);
      expect(body.directionTip!.y).toBeGreaterThanOrEqual(36);
      expect(body.directionTip!.y).toBeLessThanOrEqual(988);
      expect(body.directionTip).toEqual(body.marker);
      expect(body.leaderStart).toBeNull();
      const p = new Vector3(input.observerLocal!.x, input.observerLocal!.y, input.observerLocal!.z).applyMatrix4(input.moonMatrixWorld);
      const d = new Vector3(direction.x, direction.y, direction.z).transformDirection(input.moonMatrixWorld);
      const q = projected(p.clone().addScaledVector(d, 0.01), input);
      const a = { x: body.directionTip!.x - body.lineStart!.x, y: body.directionTip!.y - body.lineStart!.y };
      const b = { x: q.x - body.lineStart!.x, y: q.y - body.lineStart!.y };
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 6);
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0);
    }
    // The enormous visual Moon bounds must not throw the Sun into a lateral gutter.
    expect(output.sun.marker!.x).toBeGreaterThan(500);
  });

  it.each([320, 390])('uses the narrow free band below mobile View instead of covering it at width%s', width => {
    const input = integrated(width, 844);
    const view = { x: 25, y: 174, width: width - 50, height: 450 };
    input.moonScreenRect = { x: -30, y: 180, width: width + 60, height: 620 };
    input.reservedRects = [
      { x: 0, y: 0, width, height: 52 }, { x: 0, y: 64, width, height: 48 },
      { x: 0, y: 126, width, height: 40 }, view, { x: 0, y: 800, width, height: 44 },
    ];
    const output = layoutOrbitalDirections(input);
    const boxes: ScreenRect[] = [];
    for (const body of [output.sun, output.earth]) {
      expect(body.status).toBe('ready');
      expect(body.layout).toBe('clear');
      expect(body.marker!.y).toBeGreaterThanOrEqual(662);
      expect(body.marker!.y + 32).toBeLessThan(800);
      const box = groupBox(body.marker!, body.labelPosition!, body.labelAnchor);
      for (const reserved of input.reservedRects) expect(area(box, reserved)).toBe(0);
      for (const occupied of boxes) expect(area(box, occupied)).toBe(0);
      boxes.push(box);
      if (body.lineStart && body.directionTip) {
        expect(body.directionTip.x).toBeGreaterThanOrEqual(0);
        expect(body.directionTip.x).toBeLessThanOrEqual(width);
        expect(body.directionTip.y).toBeGreaterThanOrEqual(0);
        expect(body.directionTip.y).toBeLessThanOrEqual(844);
      }
    }
  });
});
