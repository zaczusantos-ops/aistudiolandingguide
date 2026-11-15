import { Quaternion, Vector3, type Camera, type Object3D } from 'three';

/**
 * Manual rotation through the Moon's center. The original hero deliberately
 * looks away from that center, so its camera and controls target must stay put.
 * Horizontal input spins the Moon's local pole axis; vertical input tilts the
 * body around the camera's right axis without orbiting or translating it.
 */
export function rotateMoonOnOwnAxes(body: Object3D, camera: Camera, horizontalRad: number, verticalRad: number): void {
  if (horizontalRad) body.rotateY(horizontalRad);
  if (verticalRad) {
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new Quaternion())).normalize();
    body.rotateOnWorldAxis(right, verticalRad);
  }
  body.updateMatrixWorld(true);
}

/** Explicit camera presets use the original, south-up model registration. */
export function resetMoonOrientation(body: Object3D): void {
  body.rotation.set(Math.PI, 0, 0);
  body.updateMatrixWorld(true);
}
