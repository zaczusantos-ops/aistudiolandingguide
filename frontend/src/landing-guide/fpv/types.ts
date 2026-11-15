import type * as THREE from 'three';

/**
 * Shared contracts for the first-person moonbase walk (Astronaut view).
 *
 * World convention (do not change without updating every module):
 * - Y is up, units are meters.
 * - -Z points to local North, +X to local East. Azimuth is measured clockwise from North,
 *   so a horizontal direction at azimuth `az` is (sin az, 0, -cos az).
 * - The player spawns near the origin; the walkable area is a disc of WALK_RADIUS_M.
 */

export const WALK_RADIUS_M = 420;
export const EYE_HEIGHT_M = 1.7;

export interface FrameContext {
  /** Seconds since previous frame (clamped). */
  dt: number;
  /** Seconds since the experience started. */
  elapsed: number;
  camera: THREE.PerspectiveCamera;
}

export interface SceneModule {
  object: THREE.Object3D;
  update?(frame: FrameContext): void;
  dispose(): void;
}

export interface GroundOptions {
  seed: number;
  lowPower: boolean;
  /** Optional 360° skyline elevation profile (deg) from the active site; may shape far hills. */
  horizonElevDeg?: number[];
}

export interface GroundModule extends SceneModule {
  /** Terrain surface height (m) at world x/z. Must be cheap: called every frame by controls and at build time by props. */
  heightAt(x: number, z: number): number;
  /** Optional: receives the same unit Sun direction as the sky (e.g. for forward-scatter glare). */
  setSunDirection?(dir: THREE.Vector3): void;
}

export interface SkyOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  lowPower: boolean;
}

export interface SkyModule extends SceneModule {
  sunLight: THREE.DirectionalLight;
  /** Unit vector (world space) pointing from the ground toward the Sun. */
  setSunDirection(dir: THREE.Vector3): void;
  /** Unit vector (world space) pointing from the ground toward the Earth. */
  setEarthDirection(dir: THREE.Vector3): void;
}

/** Circle collider on the XZ plane; the player cannot enter it. */
export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
}

export interface SpawnPose {
  x: number;
  z: number;
  /** Heading in degrees, clockwise from North (-Z). */
  yawDeg: number;
  /** Degrees, positive looks up. */
  pitchDeg: number;
}

export interface PropsOptions {
  seed: number;
  lowPower: boolean;
  heightAt(x: number, z: number): number;
}

export interface PropsModule extends SceneModule {
  colliders: CircleCollider[];
  spawn: SpawnPose;
}

export interface ControllerOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  heightAt(x: number, z: number): number;
  colliders: CircleCollider[];
  spawn: SpawnPose;
  /** When true (debug pose / screenshots), stay exactly at the spawn pose: no bob, no input. */
  frozen: boolean;
}

export interface ControllerModule {
  update(frame: FrameContext): void;
  /** Virtual joystick input, each axis in [-1, 1]; x = strafe right, y = forward. */
  setMoveVector(x: number, y: number): void;
  /** Look delta in degrees (from touch/virtual stick). */
  addLook(dYawDeg: number, dPitchDeg: number): void;
  /** Illustrative camera tremor; intensity in [0, 1], duration in seconds. */
  triggerTremor(intensity: number, durationS: number): void;
  dispose(): void;
}

export interface ExperienceOptions {
  seed: number;
  lowPower: boolean;
  horizonElevDeg?: number[];
  sunAzDeg: number;
  sunElDeg: number;
  earthAzDeg: number;
  earthElDeg: number;
  /** Optional fixed pose (debug/screenshot), usually parsed from `?fpvPose=x,z,yaw,pitch`. */
  debugPose?: SpawnPose | null;
}

export interface ExperienceHandle {
  setSky(sunAzDeg: number, sunElDeg: number, earthAzDeg: number, earthElDeg: number): void;
  setMoveVector(x: number, y: number): void;
  addLook(dYawDeg: number, dPitchDeg: number): void;
  triggerTremor(intensity: number, durationS: number): void;
  dispose(): void;
}
