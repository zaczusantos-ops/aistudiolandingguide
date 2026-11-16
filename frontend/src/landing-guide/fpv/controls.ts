import * as THREE from 'three';
import { EYE_HEIGHT_M, WALK_RADIUS_M } from './types';
import type { CircleCollider, ControllerModule, ControllerOptions, FrameContext } from './types';

/**
 * First-person walking controller for the Astronaut view.
 *
 * - WASD / ↑↓ walk, A/D strafe, ←/→ turn, Shift runs; smooth acceleration and braking.
 * - Mouse look through Pointer Lock (click the canvas, Esc releases). When Pointer Lock is not
 *   available (or for touch/pen), dragging on the canvas looks around instead.
 * - Terrain following on `heightAt` with a footprint average + exponential smoothing (no jitter).
 * - Circle colliders push the player out and slide the velocity along them.
 * - Soft boundary: outward speed fades inside the last metres before WALK_RADIUS_M, then a hard clamp.
 * - No head bob (the reference video has none): only a ~6 mm sway while walking.
 * - `frozen` (debug pose / screenshots): exact pose, no listeners, no motion.
 */

export const WALK_SPEED_MPS = 3.7;
export const RUN_SPEED_MPS = 5.5;
/** Added to every collider radius so the near plane never clips into a prop. */
export const PLAYER_RADIUS_M = 0.35;
/** Width of the ring inside WALK_RADIUS_M where outward motion fades out. */
export const BOUNDARY_SOFT_ZONE_M = 16;
export const PITCH_LIMIT_DEG = 85;

const DEG = Math.PI / 180;
const MOUSE_SENS_DEG_PER_PX = 0.085;
const DRAG_SENS_DEG_PER_PX = 0.16;
/** Pointer Lock occasionally reports huge spikes (browser bugs); ignore anything beyond this. */
const MAX_MOUSE_DELTA_PX = 220;
const KEY_TURN_RATE_DEG_S = 120;
const KEY_TURN_RESPONSE = 9;
const ACCEL_RESPONSE = 6.5;
const BRAKE_RESPONSE = 8.5;
const LOOK_RESPONSE = 22;
const HEIGHT_RESPONSE = 9;
const FOOTPRINT_M = 0.3;
const SWAY_AMPLITUDE_M = 0.006;
const STRIDE_M = 1.7;

const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

/** Mutable horizontal state of the walker (metres, metres/second). */
export interface WalkerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** Frame-rate independent exponential approach of `current` toward `target`. */
export function damp(current: number, target: number, response: number, dt: number): number {
  return target + (current - target) * Math.exp(-response * dt);
}

/**
 * Pushes the walker out of every collider (radius + playerRadius) and removes the velocity
 * component pointing into it, so the player slides along props instead of sticking.
 * Returns true when at least one collider was touched.
 */
export function resolveCollisions(
  s: WalkerState,
  colliders: readonly CircleCollider[],
  playerRadius = PLAYER_RADIUS_M,
  iterations = 3,
): boolean {
  let touched = false;
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (const c of colliders) {
      const minD = c.radius + playerRadius;
      const dx = s.x - c.x;
      const dz = s.z - c.z;
      if (Math.abs(dx) >= minD || Math.abs(dz) >= minD) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      let d = Math.sqrt(d2);
      let nx: number;
      let nz: number;
      if (d > 1e-6) {
        nx = dx / d;
        nz = dz / d;
      } else {
        // Exactly at the centre: leave against the current velocity (or toward +X).
        const sp = Math.hypot(s.vx, s.vz);
        nx = sp > 1e-6 ? -s.vx / sp : 1;
        nz = sp > 1e-6 ? -s.vz / sp : 0;
        d = 0;
      }
      s.x = c.x + nx * minD;
      s.z = c.z + nz * minD;
      const vn = s.vx * nx + s.vz * nz;
      if (vn < 0) {
        s.vx -= vn * nx;
        s.vz -= vn * nz;
      }
      moved = true;
      touched = true;
    }
    if (!moved) break;
  }
  return touched;
}

/**
 * Soft boundary, part 1: inside the last `softZone` metres before `radius`, scales down the
 * outward component of a (target) velocity — smoothly to zero at the edge. Tangential motion is kept.
 */
export function softLimitOutward(
  x: number,
  z: number,
  v: { vx: number; vz: number },
  radius = WALK_RADIUS_M,
  softZone = BOUNDARY_SOFT_ZONE_M,
): void {
  const r = Math.hypot(x, z);
  if (r <= radius - softZone || r < 1e-6) return;
  const nx = x / r;
  const nz = z / r;
  const vr = v.vx * nx + v.vz * nz;
  if (vr <= 0) return;
  const keep = Math.sqrt(THREE.MathUtils.clamp((radius - r) / Math.max(1e-6, softZone), 0, 1));
  const cut = vr * (1 - keep);
  v.vx -= cut * nx;
  v.vz -= cut * nz;
}

/** Soft boundary, part 2: hard clamp to `radius`, dropping any remaining outward velocity. */
export function clampToBoundary(s: WalkerState, radius = WALK_RADIUS_M): void {
  const r = Math.hypot(s.x, s.z);
  if (r <= radius) return;
  const nx = s.x / r;
  const nz = s.z / r;
  s.x = nx * radius;
  s.z = nz * radius;
  const vr = s.vx * nx + s.vz * nz;
  if (vr > 0) {
    s.vx -= vr * nx;
    s.vz -= vr * nz;
  }
}

/** Both boundary steps applied to a walker state. */
export function applyBoundary(s: WalkerState, radius = WALK_RADIUS_M, softZone = BOUNDARY_SOFT_ZONE_M): void {
  softLimitOutward(s.x, s.z, s, radius, softZone);
  clampToBoundary(s, radius);
}

/** Ground height under the player averaged over a small footprint (hides micro-relief jitter). */
export function sampleGroundHeight(heightAt: (x: number, z: number) => number, x: number, z: number): number {
  const c = heightAt(x, z);
  const f = FOOTPRINT_M;
  const ring = heightAt(x + f, z) + heightAt(x - f, z) + heightAt(x, z + f) + heightAt(x, z - f);
  const h = c * 0.4 + ring * 0.15;
  return Number.isFinite(h) ? h : 0;
}

/** Smooth pseudo-random signal in [-1, 1] built from two incommensurate sines. */
function wobble(t: number, f1: number, f2: number, phase: number): number {
  return 0.62 * Math.sin(2 * Math.PI * f1 * t + phase) + 0.38 * Math.sin(2 * Math.PI * f2 * t + phase * 1.7 + 0.4);
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    return false;
  }
}

interface TremorState {
  start: number;
  duration: number;
  intensity: number;
}

export function createFirstPersonController(opts: ControllerOptions): ControllerModule {
  const { camera, domElement, heightAt, colliders, spawn, frozen } = opts;

  const walker: WalkerState = { x: spawn.x, z: spawn.z, vx: 0, vz: 0 };
  const targetVel = { vx: 0, vz: 0 };
  let yawTarget = spawn.yawDeg;
  let pitchTarget = frozen ? spawn.pitchDeg : THREE.MathUtils.clamp(spawn.pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  let yaw = yawTarget;
  let pitch = pitchTarget;
  let turnVel = 0;
  let eyeY = Number.NaN;
  let stride = 0;
  let time = 0;
  let tremor: TremorState | null = null;
  const motionScale = prefersReducedMotion() ? 0.3 : 1;

  const keys = new Set<string>();
  let shiftHeld = false;
  const stick = { x: 0, y: 0 };

  const addLookTarget = (dYawDeg: number, dPitchDeg: number) => {
    if (!Number.isFinite(dYawDeg) || !Number.isFinite(dPitchDeg)) return;
    yawTarget += dYawDeg;
    pitchTarget = THREE.MathUtils.clamp(pitchTarget + dPitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
  };

  const placeCamera = (offX = 0, offY = 0, offZ = 0, dYaw = 0, dPitch = 0, roll = 0) => {
    camera.position.set(walker.x + offX, eyeY + offY, walker.z + offZ);
    camera.rotation.set((pitch + dPitch) * DEG, -(yaw + dYaw) * DEG, roll * DEG, 'YXZ');
    camera.updateMatrixWorld();
  };

  // ---------------------------------------------------------------- frozen (debug pose)
  if (frozen) {
    const update = () => {
      eyeY = heightAt(walker.x, walker.z) + EYE_HEIGHT_M;
      if (!Number.isFinite(eyeY)) eyeY = EYE_HEIGHT_M;
      placeCamera();
    };
    update();
    return {
      update,
      setMoveVector() {},
      addLook() {},
      triggerTremor() {},
      dispose() {},
    };
  }

  // ---------------------------------------------------------------- keyboard
  const onKeyDown = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!MOVE_CODES.has(e.code) || isTextEntryTarget(e.target)) return;
    keys.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    keys.delete(e.code);
  };
  const clearInput = () => {
    keys.clear();
    shiftHeld = false;
    pendingLock = null;
    endDrag();
  };

  // ---------------------------------------------------------------- pointer lock + drag look
  const doc = domElement.ownerDocument ?? document;
  const canLock = typeof domElement.requestPointerLock === 'function';
  let locked = false;
  let dragId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const beginDrag = (e: PointerEvent) => {
    dragId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    try {
      domElement.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };
  function endDrag() {
    if (dragId !== null) {
      try {
        if (domElement.hasPointerCapture?.(dragId)) domElement.releasePointerCapture(dragId);
      } catch {
        /* ignore */
      }
    }
    dragId = null;
  }

  /** Mouse press waiting for the Pointer Lock answer; drag-look takes over if the lock is refused. */
  let pendingLock: PointerEvent | null = null;
  const fallBackToDrag = () => {
    if (!locked && dragId === null && pendingLock) beginDrag(pendingLock);
    pendingLock = null;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (locked) return;
    if (e.pointerType === 'mouse' && canLock) {
      pendingLock = e;
      try {
        const result = domElement.requestPointerLock() as unknown;
        if (result && typeof (result as Promise<void>).catch === 'function') {
          // Refused (e.g. re-lock too soon after Esc, sandboxed iframe): drag-look instead.
          (result as Promise<void>).catch(fallBackToDrag);
        }
      } catch {
        fallBackToDrag();
      }
      return;
    }
    if (dragId === null) beginDrag(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (locked || dragId === null || e.pointerId !== dragId) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    addLookTarget(dx * DRAG_SENS_DEG_PER_PX, -dy * DRAG_SENS_DEG_PER_PX);
  };
  const onPointerUp = (e: PointerEvent) => {
    if (pendingLock && e.pointerId === pendingLock.pointerId) pendingLock = null;
    if (e.pointerId === dragId) endDrag();
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!locked) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (Math.abs(dx) > MAX_MOUSE_DELTA_PX || Math.abs(dy) > MAX_MOUSE_DELTA_PX) return;
    addLookTarget(dx * MOUSE_SENS_DEG_PER_PX, -dy * MOUSE_SENS_DEG_PER_PX);
  };
  const onLockChange = () => {
    locked = doc.pointerLockElement === domElement;
    if (locked) {
      pendingLock = null;
      endDrag();
    }
  };
  const onLockError = () => {
    locked = false;
    fallBackToDrag();
  };
  const onContextMenu = (e: Event) => e.preventDefault();
  const onVisibility = () => {
    if (doc.hidden) clearInput();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInput);
  doc.addEventListener('visibilitychange', onVisibility);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  doc.addEventListener('mousemove', onMouseMove);
  doc.addEventListener('pointerlockchange', onLockChange);
  doc.addEventListener('pointerlockerror', onLockError);

  // ---------------------------------------------------------------- per-frame update
  const update = (frame: FrameContext) => {
    const dt = THREE.MathUtils.clamp(Number.isFinite(frame.dt) ? frame.dt : 0, 0, 0.1);
    time += dt;

    // Look: keyboard turning ramps up/down smoothly; the camera eases toward the look target.
    const turnInput = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    turnVel = damp(turnVel, turnInput * KEY_TURN_RATE_DEG_S, KEY_TURN_RESPONSE, dt);
    if (Math.abs(turnVel) < 1e-3) turnVel = 0;
    yawTarget += turnVel * dt;
    yaw = damp(yaw, yawTarget, LOOK_RESPONSE, dt);
    pitch = damp(pitch, pitchTarget, LOOK_RESPONSE, dt);

    // Move: keyboard + virtual stick, relative to the current heading.
    let fwd = stick.y;
    let side = stick.x;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyD')) side += 1;
    if (keys.has('KeyA')) side -= 1;
    const mag = Math.hypot(fwd, side);
    if (mag > 1) {
      fwd /= mag;
      side /= mag;
    }
    const speed = shiftHeld || keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN_SPEED_MPS : WALK_SPEED_MPS;
    const h = yaw * DEG;
    const sinH = Math.sin(h);
    const cosH = Math.cos(h);
    targetVel.vx = (sinH * fwd + cosH * side) * speed;
    targetVel.vz = (-cosH * fwd + sinH * side) * speed;
    softLimitOutward(walker.x, walker.z, targetVel);
    const { vx: tvx, vz: tvz } = targetVel;
    const accelerating = tvx * tvx + tvz * tvz >= walker.vx * walker.vx + walker.vz * walker.vz;
    const response = accelerating ? ACCEL_RESPONSE : BRAKE_RESPONSE;
    walker.vx = damp(walker.vx, tvx, response, dt);
    walker.vz = damp(walker.vz, tvz, response, dt);
    if (Math.abs(walker.vx) < 1e-4) walker.vx = 0;
    if (Math.abs(walker.vz) < 1e-4) walker.vz = 0;
    walker.x += walker.vx * dt;
    walker.z += walker.vz * dt;
    resolveCollisions(walker, colliders);
    clampToBoundary(walker);

    // Terrain following.
    const ground = sampleGroundHeight(heightAt, walker.x, walker.z);
    const targetEye = ground + EYE_HEIGHT_M;
    eyeY = Number.isFinite(eyeY) ? damp(eyeY, targetEye, HEIGHT_RESPONSE, dt) : targetEye;
    eyeY = Math.max(eyeY, targetEye - 0.3);

    // Barely perceptible sway (the reference has no head bob).
    const planar = Math.hypot(walker.vx, walker.vz);
    stride += planar * dt;
    const sway = SWAY_AMPLITUDE_M * Math.min(1, planar / WALK_SPEED_MPS) * Math.sin((stride / STRIDE_M) * 2 * Math.PI);

    // Illustrative tremor: decaying small rotations + offsets, purely visual.
    let offX = 0;
    let offY = sway;
    let offZ = 0;
    let dYaw = 0;
    let dPitch = 0;
    let roll = 0;
    if (tremor) {
      const t = time - tremor.start;
      if (t >= tremor.duration) {
        tremor = null;
      } else {
        const decay = 1 - t / tremor.duration;
        const env = tremor.intensity * Math.min(1, t / 0.12) * decay * decay;
        roll = env * 0.9 * wobble(t, 6.3, 10.7, 0.3);
        dPitch = env * 0.6 * wobble(t, 7.9, 13.1, 1.1);
        dYaw = env * 0.35 * wobble(t, 5.1, 9.3, 2.0);
        offY += env * 0.025 * wobble(t, 8.7, 15.3, 0.7);
        offX = env * 0.02 * wobble(t, 6.9, 11.9, 2.6);
        offZ = env * 0.02 * wobble(t, 7.4, 12.6, 4.1);
      }
    }

    placeCamera(offX, offY, offZ, dYaw, dPitch, roll);
  };

  // Place the camera at the spawn pose immediately (before the first frame).
  update({ dt: 0, elapsed: 0, camera });

  return {
    update,
    setMoveVector(x: number, y: number) {
      stick.x = Number.isFinite(x) ? THREE.MathUtils.clamp(x, -1, 1) : 0;
      stick.y = Number.isFinite(y) ? THREE.MathUtils.clamp(y, -1, 1) : 0;
    },
    addLook(dYawDeg: number, dPitchDeg: number) {
      addLookTarget(dYawDeg, dPitchDeg);
    },
    triggerTremor(intensity: number, durationS: number) {
      const i = THREE.MathUtils.clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1) * motionScale;
      const d = THREE.MathUtils.clamp(Number.isFinite(durationS) ? durationS : 0, 0.2, 12);
      if (i <= 0) return;
      tremor = { start: time, duration: d, intensity: i };
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearInput);
      doc.removeEventListener('visibilitychange', onVisibility);
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('pointerlockchange', onLockChange);
      doc.removeEventListener('pointerlockerror', onLockError);
      endDrag();
      if (doc.pointerLockElement === domElement) {
        try {
          doc.exitPointerLock();
        } catch {
          /* ignore */
        }
      }
      keys.clear();
    },
  };
}
