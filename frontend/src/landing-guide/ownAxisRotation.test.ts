import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { latLonToSphereUnit, sphereUnitToLatLon } from './lunarTerrainEngine';
import { resetMoonOrientation, rotateMoonOnOwnAxes } from './ownAxisRotation';

function originalHero(aspect: number, position: [number, number, number], look: [number, number, number]) {
  const element = document.createElement('div');
  const camera = new PerspectiveCamera(34, aspect, 0.1, 100);
  camera.position.set(...position);
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.target.set(...look);
  controls.update();
  camera.updateMatrixWorld(true);
  const body = new Group();
  // The original renderer's lunar registration has this half-turn.
  body.rotation.x = Math.PI;
  body.updateMatrixWorld(true);
  return { camera, controls, body };
}

describe('original Moon own-axis rotation', () => {
  it.each([
    { name: 'desktop', aspect: 16 / 9, position: [-1.82, 2.28, 3.72] as [number, number, number], look: [-0.78, 0, 0] as [number, number, number] },
    { name: 'narrow', aspect: 0.6, position: [-1.1, 2.8, 7.6] as [number, number, number], look: [0, -0.34, 0] as [number, number, number] },
  ])('keeps the $name hero framing fixed while a drag turns the actual body', ({ aspect, position, look }) => {
    const { camera, controls, body } = originalHero(aspect, position, look);
    const centerBefore = body.getWorldPosition(new Vector3()).project(camera);
    const cameraPosition = camera.position.toArray();
    const cameraOrientation = camera.quaternion.toArray();
    const orbitTarget = controls.target.toArray();
    const orientationBefore = body.quaternion.clone();

    // Exercise the same helper used by original-renderer pointer/keyboard input,
    // with a deliberately offset camera target that used to cause orbital drift.
    rotateMoonOnOwnAxes(body, camera, 0.65, -0.2);
    const centerAfter = body.getWorldPosition(new Vector3()).project(camera);
    expect(body.quaternion.angleTo(orientationBefore)).toBeGreaterThan(0.1);
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    expect(centerAfter.distanceTo(centerBefore)).toBeLessThan(1e-12);
    expect(camera.position.toArray()).toEqual(cameraPosition);
    expect(camera.quaternion.toArray()).toEqual(cameraOrientation);
    expect(controls.target.toArray()).toEqual(orbitTarget);
    controls.dispose();
  });

  it('turns horizontally around the registered lunar pole axis without moving that axis', () => {
    const { camera, controls, body } = originalHero(16 / 9, [-1.82, 2.28, 3.72], [-0.78, 0, 0]);
    const poleBefore = body.localToWorld(new Vector3(0, 1, 0));
    const landmarkBefore = body.localToWorld(new Vector3(-1, 0, 0));

    rotateMoonOnOwnAxes(body, camera, 1.2, 0);
    const poleAfter = body.localToWorld(new Vector3(0, 1, 0));
    const landmarkAfter = body.localToWorld(new Vector3(-1, 0, 0));
    expect(poleAfter.distanceTo(poleBefore)).toBeLessThan(1e-12);
    expect(landmarkAfter.distanceTo(landmarkBefore)).toBeGreaterThan(0.5);
    expect(landmarkAfter.length()).toBeCloseTo(landmarkBefore.length(), 12);
    controls.dispose();
  });

  it('preserves lunar picking registration after turning the body in the offset hero view', () => {
    const { camera, controls, body } = originalHero(16 / 9, [-1.82, 2.28, 3.72], [-0.78, 0, 0]);
    const geometry = new SphereGeometry(1, 128, 64);
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(geometry, material);
    body.add(mesh);
    rotateMoonOnOwnAxes(body, camera, 0.35, -0.17);

    const point = latLonToSphereUnit(-30, 300);
    const worldLandmark = body.localToWorld(new Vector3(point.x, point.y, point.z));
    expect(worldLandmark.clone().normalize().dot(camera.position.clone().sub(worldLandmark).normalize())).toBeGreaterThan(0);
    const projection = worldLandmark.clone().project(camera);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(projection.x, projection.y), camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    expect(hit).toBeDefined();
    // The original viewport resolves clicks through this exact world-to-local
    // registration, so a visual landmark must retain its lunar coordinates.
    const localHit = body.worldToLocal(hit.point.clone());
    const selected = sphereUnitToLatLon(localHit.x, localHit.y, localHit.z);
    expect(selected.latDeg).toBeCloseTo(-30, 1);
    expect(selected.lonEastDeg).toBeCloseTo(300, 1);
    controls.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('does not change the body for a stationary pointer', () => {
    const { camera, controls, body } = originalHero(16 / 9, [-1.82, 2.28, 3.72], [-0.78, 0, 0]);
    const before = body.quaternion.clone();
    rotateMoonOnOwnAxes(body, camera, 0, 0);
    expect(body.quaternion.angleTo(before)).toBeLessThan(1e-12);
    expect(body.position.toArray()).toEqual([0, 0, 0]);
    controls.dispose();
  });

  it('restores the original pole, orientation and framing before a camera preset', () => {
    const { camera, controls, body } = originalHero(16 / 9, [-1.82, 2.28, 3.72], [-0.78, 0, 0]);
    const initialOrientation = body.quaternion.clone();
    const initialPole = body.localToWorld(new Vector3(0, 1, 0));
    const initialCenter = body.getWorldPosition(new Vector3()).project(camera);
    const initialCamera = camera.position.toArray();
    const initialTarget = controls.target.toArray();

    rotateMoonOnOwnAxes(body, camera, 1.1, -0.45);
    expect(body.quaternion.angleTo(initialOrientation)).toBeGreaterThan(0.1);
    resetMoonOrientation(body);

    expect(body.quaternion.angleTo(initialOrientation)).toBeLessThan(1e-12);
    expect(body.localToWorld(new Vector3(0, 1, 0)).distanceTo(initialPole)).toBeLessThan(1e-12);
    expect(body.getWorldPosition(new Vector3()).project(camera).distanceTo(initialCenter)).toBeLessThan(1e-12);
    expect(camera.position.toArray()).toEqual(initialCamera);
    expect(controls.target.toArray()).toEqual(initialTarget);
    controls.dispose();
  });
});
