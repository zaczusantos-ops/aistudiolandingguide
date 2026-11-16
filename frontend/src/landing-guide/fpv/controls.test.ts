import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBoundary,
  BOUNDARY_SOFT_ZONE_M,
  createFirstPersonController,
  PLAYER_RADIUS_M,
  resolveCollisions,
  RUN_SPEED_MPS,
  sampleGroundHeight,
  WALK_SPEED_MPS,
  type WalkerState,
} from './controls';
import { parseDebugPose } from './controlsPose';
import { EYE_HEIGHT_M, WALK_RADIUS_M } from './types';
import type { CircleCollider, ControllerModule, SpawnPose } from './types';
import { stickVector } from './uiJoystick';

const DT = 1 / 60;
const live: ControllerModule[] = [];

function makeController(opts: {
  spawn?: SpawnPose;
  colliders?: CircleCollider[];
  heightAt?: (x: number, z: number) => number;
  frozen?: boolean;
}) {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 6000);
  const domElement = document.createElement('div');
  document.body.appendChild(domElement);
  const controller = createFirstPersonController({
    camera,
    domElement,
    heightAt: opts.heightAt ?? (() => 0),
    colliders: opts.colliders ?? [],
    spawn: opts.spawn ?? { x: 0, z: 0, yawDeg: 0, pitchDeg: 0 },
    frozen: opts.frozen ?? false,
  });
  live.push(controller);
  let elapsed = 0;
  const step = (seconds: number, onFrame?: () => void) => {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      elapsed += DT;
      controller.update({ dt: DT, elapsed, camera });
      onFrame?.();
    }
  };
  return { camera, domElement, controller, step };
}

function lookDirection(camera: THREE.Camera): THREE.Vector3 {
  return camera.getWorldDirection(new THREE.Vector3());
}

afterEach(() => {
  while (live.length) live.pop()!.dispose();
  document.body.innerHTML = '';
});

describe('parseDebugPose', () => {
  it('parses x,z,yaw,pitch and defaults pitch to 0', () => {
    expect(parseDebugPose('?fpvPose=12.5,-30,45,-5')).toEqual({ x: 12.5, z: -30, yawDeg: 45, pitchDeg: -5 });
    expect(parseDebugPose('?autostart=1&view=astronaut&fpvPose=1,2,3')).toEqual({ x: 1, z: 2, yawDeg: 3, pitchDeg: 0 });
  });

  it('rejects missing or malformed poses', () => {
    expect(parseDebugPose('')).toBeNull();
    expect(parseDebugPose('?view=astronaut')).toBeNull();
    expect(parseDebugPose('?fpvPose=')).toBeNull();
    expect(parseDebugPose('?fpvPose=1,2')).toBeNull();
    expect(parseDebugPose('?fpvPose=a,b,c')).toBeNull();
    expect(parseDebugPose('?fpvPose=1,,3')).toBeNull();
    expect(parseDebugPose('?fpvPose=1,2,3,4,5')).toBeNull();
    expect(parseDebugPose('?fpvPose=1,2,Infinity')).toBeNull();
  });
});

describe('collision and boundary helpers', () => {
  it('pushes the walker out of a collider and slides along it', () => {
    const c: CircleCollider = { x: 0, z: -10, radius: 3 };
    // Inside the collider, moving straight into it (toward -Z) and a bit sideways (+X).
    const s: WalkerState = { x: 0.5, z: -8, vx: 1, vz: -4 };
    expect(resolveCollisions(s, [c])).toBe(true);
    const d = Math.hypot(s.x - c.x, s.z - c.z);
    expect(d).toBeCloseTo(c.radius + PLAYER_RADIUS_M, 6);
    // No velocity left pointing into the collider; tangential motion is kept.
    const nx = (s.x - c.x) / d;
    const nz = (s.z - c.z) / d;
    expect(s.vx * nx + s.vz * nz).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(0.5);
  });

  it('leaves the walker alone when clear of colliders and handles the exact centre', () => {
    const s: WalkerState = { x: 10, z: 10, vx: 1, vz: 0 };
    expect(resolveCollisions(s, [{ x: 0, z: 0, radius: 2 }])).toBe(false);
    expect(s).toEqual({ x: 10, z: 10, vx: 1, vz: 0 });

    const centre: WalkerState = { x: 5, z: 5, vx: 0, vz: 0 };
    resolveCollisions(centre, [{ x: 5, z: 5, radius: 1 }]);
    expect(Math.hypot(centre.x - 5, centre.z - 5)).toBeCloseTo(1 + PLAYER_RADIUS_M, 6);
  });

  it('clamps to the walk radius and fades outward speed in the soft zone', () => {
    const out: WalkerState = { x: WALK_RADIUS_M + 30, z: 0, vx: 5, vz: 2 };
    applyBoundary(out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(WALK_RADIUS_M, 6);
    expect(out.vx).toBeCloseTo(0, 6); // radial (outward) component removed at the edge
    expect(out.vz).toBeCloseTo(2, 6); // tangential component kept

    const soft: WalkerState = { x: WALK_RADIUS_M - BOUNDARY_SOFT_ZONE_M / 2, z: 0, vx: 4, vz: 0 };
    applyBoundary(soft);
    expect(soft.vx).toBeGreaterThan(0.5);
    expect(soft.vx).toBeLessThan(4);

    const deeper: WalkerState = { x: WALK_RADIUS_M - BOUNDARY_SOFT_ZONE_M / 8, z: 0, vx: 4, vz: 0 };
    applyBoundary(deeper);
    expect(deeper.vx).toBeLessThan(soft.vx);

    const inward: WalkerState = { x: WALK_RADIUS_M - 1, z: 0, vx: -4, vz: 0 };
    applyBoundary(inward);
    expect(inward.vx).toBe(-4);
  });

  it('averages ground height over a small footprint', () => {
    expect(sampleGroundHeight(() => 3, 1, 2)).toBeCloseTo(3, 9);
    expect(sampleGroundHeight((x) => x * 0.5, 4, 0)).toBeCloseTo(2, 9);
    expect(sampleGroundHeight(() => Number.NaN, 0, 0)).toBe(0);
  });
});

describe('first-person controller', () => {
  it('frozen mode holds the exact debug pose with no input or motion', () => {
    const heightAt = (x: number, z: number) => 0.01 * x - 0.02 * z;
    const spawn = { x: 12, z: -40, yawDeg: 90, pitchDeg: -5 };
    const { camera, controller, step } = makeController({ spawn, heightAt, frozen: true });
    const expectExactPose = () => {
      expect(camera.position.x).toBeCloseTo(12, 9);
      expect(camera.position.z).toBeCloseTo(-40, 9);
      expect(camera.position.y).toBeCloseTo(heightAt(12, -40) + EYE_HEIGHT_M, 9);
      const dir = lookDirection(camera);
      expect(dir.x).toBeCloseTo(Math.cos(-5 * (Math.PI / 180)), 6); // facing East (+X)
      expect(dir.y).toBeCloseTo(Math.sin(-5 * (Math.PI / 180)), 6);
      expect(dir.z).toBeCloseTo(0, 6);
      expect(camera.rotation.z).toBe(0);
    };
    expectExactPose();
    controller.setMoveVector(0, 1);
    controller.addLook(30, 10);
    controller.triggerTremor(1, 2);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    step(1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
    expectExactPose();
  });

  it('accelerates smoothly to walking speed along the heading and brakes smoothly', () => {
    const { camera, controller, step } = makeController({ spawn: { x: 0, z: 0, yawDeg: 0, pitchDeg: 0 } });
    controller.setMoveVector(0, 1);
    let prevZ = camera.position.z;
    let firstStep = 0;
    step(0.05, () => {
      firstStep = Math.max(firstStep, prevZ - camera.position.z);
      prevZ = camera.position.z;
    });
    expect(firstStep).toBeLessThan(WALK_SPEED_MPS * DT * 0.5); // no instant full speed
    step(3);
    const z0 = camera.position.z;
    step(1);
    expect(z0 - camera.position.z).toBeCloseTo(WALK_SPEED_MPS, 1); // heading North = -Z
    expect(Math.abs(camera.position.x)).toBeLessThan(1e-6);

    controller.setMoveVector(0, 0);
    const zStop = camera.position.z;
    step(0.05);
    expect(zStop - camera.position.z).toBeGreaterThan(0.05); // coasts a little, no hard stop
    step(3);
    const zRest = camera.position.z;
    step(1);
    expect(Math.abs(camera.position.z - zRest)).toBeLessThan(1e-3);
  });

  it('walks with WASD, runs with Shift and ignores keys typed into inputs', () => {
    const { camera, step } = makeController({ spawn: { x: 0, z: 0, yawDeg: 90, pitchDeg: 0 } });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    step(3);
    const x0 = camera.position.x;
    step(1);
    expect(camera.position.x - x0).toBeCloseTo(WALK_SPEED_MPS, 1); // yaw 90 = East (+X)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true }));
    step(3);
    const x1 = camera.position.x;
    step(1);
    expect(camera.position.x - x1).toBeCloseTo(RUN_SPEED_MPS, 1);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft', key: 'Shift' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w' }));
    step(4);

    const input = document.createElement('input');
    document.body.appendChild(input);
    const xBefore = camera.position.x;
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    step(1);
    expect(Math.abs(camera.position.x - xBefore)).toBeLessThan(1e-3);
  });

  it('never enters a collider and slides past it', () => {
    const colliders = [{ x: 0, z: -20, radius: 4 }];
    const { camera, controller, step } = makeController({
      spawn: { x: 0.6, z: 0, yawDeg: 0, pitchDeg: 0 },
      colliders,
    });
    controller.setMoveVector(0, 1);
    let minDist = Infinity;
    step(12, () => {
      minDist = Math.min(minDist, Math.hypot(camera.position.x - 0, camera.position.z + 20));
    });
    expect(minDist).toBeGreaterThanOrEqual(4 + PLAYER_RADIUS_M - 1e-6);
    // Slid around the obstacle and kept going North.
    expect(camera.position.z).toBeLessThan(-30);
  });

  it('pushes a spawn inside a collider out on the first frame', () => {
    const { camera } = makeController({
      spawn: { x: 1, z: 1, yawDeg: 0, pitchDeg: 0 },
      colliders: [{ x: 0, z: 0, radius: 5 }],
    });
    expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(5 + PLAYER_RADIUS_M, 6);
  });

  it('stays inside the walkable disc', () => {
    const { camera, controller, step } = makeController({
      spawn: { x: WALK_RADIUS_M - 10, z: 0, yawDeg: 90, pitchDeg: 0 },
    });
    controller.setMoveVector(0, 1);
    step(10);
    const r = Math.hypot(camera.position.x, camera.position.z);
    expect(r).toBeLessThanOrEqual(WALK_RADIUS_M + 1e-6);
    expect(r).toBeGreaterThan(WALK_RADIUS_M - 2);
  });

  it('follows the terrain smoothly without jitter', () => {
    const heightAt = (x: number) => 0.2 * x;
    const { camera, controller, step } = makeController({ spawn: { x: 0, z: 0, yawDeg: 90, pitchDeg: 0 }, heightAt });
    expect(camera.position.y).toBeCloseTo(EYE_HEIGHT_M, 6);
    controller.setMoveVector(0, 1);
    const ys: number[] = [];
    step(4, () => ys.push(camera.position.y));
    // Monotonic climb (no oscillation), and it tracks the ground closely at walking speed.
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    const ground = heightAt(camera.position.x);
    expect(Math.abs(camera.position.y - (ground + EYE_HEIGHT_M))).toBeLessThan(0.2);
  });

  it('turns smoothly toward look input and clamps pitch', () => {
    const { camera, controller, step } = makeController({});
    controller.addLook(90, 200);
    step(0.016);
    const early = lookDirection(camera);
    expect(early.x).toBeGreaterThan(0);
    expect(early.x).toBeLessThan(0.9); // eases in, not an instant snap
    step(2);
    const settled = lookDirection(camera);
    // Pitch clamped below straight up; heading East.
    expect(settled.y).toBeLessThan(0.999);
    expect(settled.y).toBeGreaterThan(0.99);
    expect(Math.atan2(settled.x, -settled.z) * (180 / Math.PI)).toBeCloseTo(90, 3);
  });

  it('plays a decaying illustrative tremor and returns to the exact rest pose', () => {
    const { camera, controller, step } = makeController({ spawn: { x: 3, z: 4, yawDeg: 0, pitchDeg: 0 } });
    step(0.1);
    const restPos = camera.position.clone();
    const restQuat = camera.quaternion.clone();
    controller.triggerTremor(1, 1.5);
    let maxAngle = 0;
    let maxOffset = 0;
    step(0.5, () => {
      maxAngle = Math.max(maxAngle, camera.quaternion.angleTo(restQuat));
      maxOffset = Math.max(maxOffset, camera.position.distanceTo(restPos));
    });
    expect(maxAngle).toBeGreaterThan(0.002);
    expect(maxAngle).toBeLessThan(0.05); // small, a couple of degrees at most
    expect(maxOffset).toBeLessThan(0.1);
    step(1.2);
    expect(camera.quaternion.angleTo(restQuat)).toBeLessThan(1e-6);
    expect(camera.position.distanceTo(restPos)).toBeLessThan(1e-6);
  });
});

describe('virtual stick vector', () => {
  it('maps pointer offsets to a clamped stick vector with a dead zone', () => {
    expect(stickVector(0, 0, 80)).toEqual({ x: 0, y: 0 });
    expect(stickVector(4, -4, 80)).toEqual({ x: 0, y: 0 }); // inside dead zone
    const up = stickVector(0, -80, 80);
    expect(up.x).toBeCloseTo(0, 9);
    expect(up.y).toBeCloseTo(1, 9); // screen up = forward
    const far = stickVector(300, 0, 80);
    expect(far.x).toBeCloseTo(1, 9);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(1);
    expect(stickVector(10, 10, 0)).toEqual({ x: 0, y: 0 });
  });
});
