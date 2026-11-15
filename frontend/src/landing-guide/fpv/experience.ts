import * as THREE from 'three';
import { createFirstPersonController } from './controls';
import { createMoonbase } from './props';
import {
  createAdaptiveResolution,
  pickPixelRatio,
  resetAdaptiveWindow,
  setAdaptiveMaxRatio,
  updateAdaptiveResolution,
} from './experiencePerf';
import { configureRenderer, createLunarSky } from './sky';
import { createLunarGround } from './terrain';
import type { ExperienceHandle, ExperienceOptions, FrameContext } from './types';

export { parseDebugPose } from './controlsPose';
export { MAX_PIXEL_RATIO, pickPixelRatio } from './experiencePerf';

const DEG = Math.PI / 180;
export const FPV_FOV_DEG = 60;

export function azElToDirection(azDeg: number, elDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}

/** Disposes geometries, materials and their textures still attached to a scene graph. */
function disposeTree(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of mats) {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      m.dispose();
    }
  });
  textures.forEach((t) => t.dispose());
}

/** Keep ownership as soon as a resource exists, before initialization can throw. */
function createCleanupScope() {
  const steps: Array<() => void> = [];
  let disposed = false;
  return {
    get disposed() { return disposed; },
    defer(step: () => void) { steps.push(step); },
    dispose() {
      if (disposed) return;
      disposed = true;
      while (steps.length) {
        try {
          steps.pop()!();
        } catch {
          // Attempt every remaining cleanup and preserve the initialization error.
        }
      }
    },
  };
}

/**
 * Composes terrain, sky, props and the first-person controller; owns the render loop, resizing,
 * pausing while the tab is hidden, adaptive resolution and disposal.
 */
export function createMoonbaseExperience(mount: HTMLElement, opts: ExperienceOptions): ExperienceHandle {
  const cleanup = createCleanupScope();
  try {
    return initializeMoonbaseExperience(mount, opts, cleanup);
  } catch (error) {
    cleanup.dispose();
    throw error;
  }
}

function initializeMoonbaseExperience(
  mount: HTMLElement, opts: ExperienceOptions, cleanup: ReturnType<typeof createCleanupScope>,
): ExperienceHandle {
  const sizeOf = () => ({
    w: Math.max(1, Math.round(mount.clientWidth || window.innerWidth || 1280)),
    h: Math.max(1, Math.round(mount.clientHeight || window.innerHeight || 720)),
  });
  let { w, h } = sizeOf();

  const renderer = new THREE.WebGLRenderer({
    antialias: !opts.lowPower,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: Boolean(opts.debugPose),
  });
  cleanup.defer(() => renderer.forceContextLoss());
  cleanup.defer(() => renderer.dispose());
  cleanup.defer(() => renderer.domElement.remove());
  configureRenderer(renderer, opts.lowPower);
  let basePixelRatio = pickPixelRatio(window.devicePixelRatio, opts.lowPower);
  // Adaptive resolution trades sharpness for frame rate on slow GPUs. Off for a debug pose so
  // screenshots stay deterministic.
  const adaptive = opts.debugPose ? null : createAdaptiveResolution(basePixelRatio);
  renderer.setPixelRatio(adaptive ? adaptive.ratio : basePixelRatio);
  renderer.setSize(w, h, false);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-hidden', 'true');
  mount.replaceChildren(canvas);

  const scene = new THREE.Scene();
  cleanup.defer(() => disposeTree(scene));
  const camera = new THREE.PerspectiveCamera(FPV_FOV_DEG, w / h, 0.1, 6000);

  const ground = createLunarGround({ seed: opts.seed, lowPower: opts.lowPower, horizonElevDeg: opts.horizonElevDeg });
  cleanup.defer(() => ground.dispose());
  scene.add(ground.object);

  const sky = createLunarSky({ renderer, scene, lowPower: opts.lowPower });
  cleanup.defer(() => sky.dispose());
  scene.add(sky.object);

  const base = createMoonbase({ seed: opts.seed, lowPower: opts.lowPower, heightAt: ground.heightAt });
  cleanup.defer(() => base.dispose());
  scene.add(base.object);

  const controller = createFirstPersonController({
    camera,
    domElement: canvas,
    heightAt: ground.heightAt,
    colliders: base.colliders,
    spawn: opts.debugPose ?? base.spawn,
    frozen: Boolean(opts.debugPose),
  });
  cleanup.defer(() => controller.dispose());

  const dirScratch = new THREE.Vector3();
  const setSky = (sunAz: number, sunEl: number, earthAz: number, earthEl: number) => {
    azElToDirection(sunAz, sunEl, dirScratch);
    sky.setSunDirection(dirScratch);
    ground.setSunDirection?.(dirScratch);
    sky.setEarthDirection(azElToDirection(earthAz, earthEl, dirScratch));
  };
  setSky(opts.sunAzDeg, opts.sunElDeg, opts.earthAzDeg, opts.earthElDeg);

  let last = performance.now();
  let elapsed = 0;
  let rafId = 0;
  let running = false;
  let contextLost = false;
  const frame: FrameContext = { dt: 0, elapsed: 0, camera };

  const tick = (now: number) => {
    if (!running) return;
    rafId = requestAnimationFrame(tick);
    const frameMs = now - last;
    const dt = Math.min(Math.max(frameMs / 1000, 0), 1 / 20);
    last = now;
    if (adaptive && updateAdaptiveResolution(adaptive, frameMs)) renderer.setPixelRatio(adaptive.ratio);
    elapsed += dt;
    frame.dt = dt;
    frame.elapsed = elapsed;
    controller.update(frame);
    ground.update?.(frame);
    sky.update?.(frame);
    base.update?.(frame);
    renderer.render(scene, camera);
  };

  const start = () => {
    if (running || cleanup.disposed || contextLost) return;
    running = true;
    last = performance.now();
    // Time spent hidden or without a context is not a slow frame.
    if (adaptive) resetAdaptiveWindow(adaptive);
    rafId = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(rafId);
  };
  cleanup.defer(stop);

  const onVisibility = () => {
    if (document.hidden) stop();
    else start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanup.defer(() => document.removeEventListener('visibilitychange', onVisibility));

  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    stop();
  };
  const onContextRestored = () => {
    contextLost = false;
    if (!document.hidden) start();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  cleanup.defer(() => canvas.removeEventListener('webglcontextlost', onContextLost));
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  cleanup.defer(() => canvas.removeEventListener('webglcontextrestored', onContextRestored));

  const applySize = () => {
    const next = sizeOf();
    const nextBase = pickPixelRatio(window.devicePixelRatio, opts.lowPower);
    if (next.w === w && next.h === h && nextBase === basePixelRatio) return;
    if (nextBase !== basePixelRatio) {
      basePixelRatio = nextBase;
      if (adaptive) setAdaptiveMaxRatio(adaptive, nextBase);
      // setPixelRatio() resizes the drawing buffer with the old CSS size; setSize() below fixes it.
      renderer.setPixelRatio(adaptive ? adaptive.ratio : nextBase);
    }
    // A resize changes the pixel count: measure the new size from a clean window.
    if (adaptive) resetAdaptiveWindow(adaptive);
    w = next.w;
    h = next.h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(applySize);
    cleanup.defer(() => resizeObserver?.disconnect());
    resizeObserver.observe(mount);
  } else {
    window.addEventListener('resize', applySize);
    cleanup.defer(() => window.removeEventListener('resize', applySize));
  }

  // Render one frame synchronously so the first paint already shows the scene.
  controller.update(frame);
  renderer.render(scene, camera);
  if (!document.hidden) start();

  return {
    setSky,
    setMoveVector: (x, y) => controller.setMoveVector(x, y),
    addLook: (dy, dp) => controller.addLook(dy, dp),
    triggerTremor: (i, d) => controller.triggerTremor(i, d),
    dispose: () => cleanup.dispose(),
  };
}
