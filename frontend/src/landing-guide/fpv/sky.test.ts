import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  computeShadowBounds,
  configureRenderer,
  createLunarSky,
  ENV_INTENSITY,
  lightBasis,
  SHADOW_HALF_DEPTH,
  SHADOW_HALF_WIDTH,
  SHADOW_MAP_SIZE,
  SKY_EXPOSURE,
  snapToShadowTexels,
  SUN_INTENSITY,
} from './sky';
import { buildEarthTexture, EARTH_ANGULAR_DIAMETER_DEG } from './skyEarth';
import { envRadiance } from './skyEnv';
import { SUN_QUAD_RADIUS_PX, sunProfile } from './skySun';

const DEG = Math.PI / 180;
const dirOf = (azDeg: number, elDeg: number) =>
  new THREE.Vector3(
    Math.cos(elDeg * DEG) * Math.sin(azDeg * DEG),
    Math.sin(elDeg * DEG),
    -Math.cos(elDeg * DEG) * Math.cos(azDeg * DEG),
  );

describe('sun sprite profile', () => {
  it('has a small saturated core and a halo that fades to black', () => {
    expect(sunProfile(0)).toBe(1);
    expect(sunProfile(4)).toBeGreaterThan(0.8);
    // Halo right outside the ~10 px core sits around 95/255 like the reference frames.
    expect(sunProfile(6.5)).toBeGreaterThan(0.3);
    expect(sunProfile(6.5)).toBeLessThan(0.42);
    expect(sunProfile(30)).toBeGreaterThan(0.08);
    expect(sunProfile(30)).toBeLessThan(0.14);
    // Long, faint tail (reference: still ~5/255 at 60 px), gone before the quad edge.
    expect(sunProfile(60)).toBeGreaterThan(0.01);
    expect(sunProfile(60)).toBeLessThan(0.035);
    expect(sunProfile(100)).toBeLessThan(0.002);
  });

  it('matches the measured reference halo along screen directions', () => {
    // Median display values (×255) measured on the reference frames t08/t12/t21/t30.
    const ref: Record<string, [number, number][]> = {
      right: [[25, 46], [40, 26], [60, 10]],
      left: [[25, 33], [40, 16], [60, 3]],
      up: [[25, 38], [40, 16], [60, 5]],
      down: [[25, 48], [40, 26], [60, 12]],
    };
    const dirs: Record<string, [number, number]> = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] };
    for (const [name, samples] of Object.entries(ref)) {
      const [dx, dy] = dirs[name];
      for (const [r, v] of samples) expect(Math.abs(sunProfile(r, dx, dy) * 255 - v)).toBeLessThan(5);
    }
    // The tail is longer toward the lower right, as in the reference.
    expect(sunProfile(40, 1, 0)).toBeGreaterThan(sunProfile(40, -1, 0) * 1.5);
    expect(sunProfile(40, 0, -1)).toBeGreaterThan(sunProfile(40, 0, 1) * 1.3);
  });

  it('keeps the inner shoulder at the level measured around the core centroid', () => {
    // Radial means (×255) around the centroid of the saturated core on the full-res reference frames
    // t08/t21/t30/t47 (min–max over the four frames). Single-row samples from a centroid polluted by
    // other bright pixels read much higher (138–229 at r 8) and are not a property of the halo.
    const ref: [number, number, number][] = [
      [7, 92, 109],
      [8, 86, 105],
      [10, 75, 93],
      [12, 65, 81],
      [16, 54, 66],
    ];
    for (const [r, lo, hi] of ref) {
      const v = sunProfile(r) * 255;
      expect(v).toBeGreaterThanOrEqual(lo - 3);
      expect(v).toBeLessThanOrEqual(hi + 3);
    }
  });

  it('decreases monotonically with radius and fits inside the quad in every direction', () => {
    for (let a = 0; a < 360; a += 15) {
      const dx = Math.cos((a * Math.PI) / 180);
      const dy = Math.sin((a * Math.PI) / 180);
      let prev = Infinity;
      for (let r = 0; r <= SUN_QUAD_RADIUS_PX; r += 0.5) {
        const v = sunProfile(r, dx, dy);
        expect(v).toBeLessThanOrEqual(prev + 1e-9);
        prev = v;
      }
      expect(sunProfile(SUN_QUAD_RADIUS_PX, dx, dy)).toBeLessThan(0.0015);
    }
  });
});

describe('camera-following sun shadows', () => {
  it('sizes the light-space box from the sun elevation', () => {
    const low = computeShadowBounds(dirOf(252, 10));
    expect(low.right - low.left).toBeCloseTo(2 * SHADOW_HALF_WIDTH);
    // Ground footprint along the sun azimuth covers ±SHADOW_HALF_DEPTH.
    const sin10 = Math.sin(10 * DEG);
    expect(-low.bottom).toBeGreaterThanOrEqual(SHADOW_HALF_DEPTH * sin10);
    expect(low.top).toBeGreaterThan(SHADOW_HALF_DEPTH * sin10);
    // A low sun gives a much flatter box than a high one (resolution is not wasted).
    const high = computeShadowBounds(dirOf(252, 60));
    expect(low.top - low.bottom).toBeLessThan((high.top - high.bottom) / 2);
  });

  it('snaps the box centre to whole shadow-map texels', () => {
    const sunDir = dirOf(252, 10);
    const b = computeShadowBounds(sunDir);
    const tx = (b.right - b.left) / SHADOW_MAP_SIZE;
    const ty = (b.top - b.bottom) / SHADOW_MAP_SIZE;
    const bx = new THREE.Vector3();
    const by = new THREE.Vector3();
    lightBasis(sunDir, bx, by);
    for (const [x, z] of [
      [0.03, -0.07],
      [12.345, 98.76],
      [-301.2, 4.4],
    ]) {
      const c = snapToShadowTexels(new THREE.Vector3(x, 1.3, z), sunDir, tx, ty);
      const u = c.dot(bx) / tx;
      const v = c.dot(by) / ty;
      expect(Math.abs(u - Math.round(u))).toBeLessThan(1e-4);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-4);
      // Moves by less than one texel diagonal.
      expect(c.distanceTo(new THREE.Vector3(x, 1.3, z))).toBeLessThan(Math.hypot(tx, ty));
    }
  });
});

describe('exposure and fill calibration', () => {
  // Khronos PBR Neutral below the compression knee (three.js NeutralToneMapping), grey input.
  const neutral = (x: number) => {
    const e = x * SKY_EXPOSURE;
    return e - (e < 0.08 ? e - 6.25 * e * e : 0.04);
  };
  const toSrgb255 = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

  it('configures the renderer with the calibrated exposure and a black clear colour', () => {
    let clear = -1;
    const renderer = {
      shadowMap: { enabled: false, type: 0 },
      setClearColor: (c: number) => {
        clear = c;
      },
    } as unknown as THREE.WebGLRenderer;
    configureRenderer(renderer, false);
    expect(renderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(renderer.toneMappingExposure).toBe(SKY_EXPOSURE);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(clear).toBe(0x000000);
    configureRenderer(renderer, true);
    expect(renderer.shadowMap.enabled).toBe(false);
  });

  it('keeps sunlit faces in the linear range and shadowed faces dark but not black', () => {
    expect(SKY_EXPOSURE).toBeGreaterThan(0.8);
    expect(SKY_EXPOSURE).toBeLessThan(0.95);
    // A neutral 0.5-albedo face lit at 60° lands mid-grey, well below the compression knee.
    const lit = toSrgb255(neutral(0.5 * Math.cos(60 * DEG)));
    expect(lit).toBeGreaterThan(110);
    expect(lit).toBeLessThan(140);
    // Vertical 0.5-albedo face turned away from the Sun: it sees half of the regolith environment
    // (radiance ≈ 0.33 · ENV_INTENSITY) plus the weak hemisphere fill (≈ 0.02).
    const groundRadiance = envRadiance(-0.4)[1];
    const shade = toSrgb255(neutral(0.5 * (0.5 * groundRadiance * ENV_INTENSITY + 0.02)));
    expect(shade).toBeGreaterThan(8);
    expect(shade).toBeLessThan(40);
  });
});

describe('createLunarSky', () => {
  const fakeRenderer = {} as THREE.WebGLRenderer;

  it('builds a black sky with a sun light that follows the camera (lowPower: no shadows)', () => {
    const scene = new THREE.Scene();
    const sky = createLunarSky({ renderer: fakeRenderer, scene, lowPower: true });
    expect((scene.background as THREE.Color).getHex()).toBe(0x000000);
    expect(scene.environment).toBeNull();
    expect(sky.sunLight.intensity).toBeCloseTo(SUN_INTENSITY);
    expect(sky.sunLight.castShadow).toBe(false);

    const sunDir = dirOf(252, 10);
    sky.setSunDirection(sunDir);
    sky.setEarthDirection(dirOf(100, -20));
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 6000);
    camera.position.set(40, 2.2, -15);
    camera.updateMatrixWorld();
    sky.update?.({ dt: 0.016, elapsed: 0, camera });

    const toLight = sky.sunLight.position.clone().sub(sky.sunLight.target.position).normalize();
    expect(toLight.dot(sunDir)).toBeGreaterThan(0.9999);
    // Earth below the horizon is not drawn; nothing in the sky group is a star field.
    const earth = sky.object.getObjectByName('earth');
    expect(earth?.visible).toBe(false);
    expect(sky.object.getObjectByName('sun-glow')).toBeTruthy();
    sky.dispose();
  });

  it('enables crisp camera-following shadows and survives a missing GPU environment', () => {
    const scene = new THREE.Scene();
    const sky = createLunarSky({ renderer: fakeRenderer, scene, lowPower: false });
    expect(sky.sunLight.castShadow).toBe(true);
    expect(sky.sunLight.shadow.mapSize.x).toBeLessThanOrEqual(2048);
    sky.setSunDirection(dirOf(252, 10));
    const cam = sky.sunLight.shadow.camera;
    expect(cam.right - cam.left).toBeCloseTo(2 * SHADOW_HALF_WIDTH);
    // With a fake renderer PMREM fails; the module must fall back to light-based fill.
    expect(scene.environment).toBeNull();
    sky.dispose();
  });

  it('keeps the Earth at its true apparent size when above the horizon', () => {
    const scene = new THREE.Scene();
    const sky = createLunarSky({ renderer: fakeRenderer, scene, lowPower: true });
    sky.setEarthDirection(dirOf(30, 25));
    const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 6000);
    camera.updateMatrixWorld();
    sky.update?.({ dt: 0.016, elapsed: 0, camera });
    const earth = sky.object.getObjectByName('earth') as THREE.Mesh;
    expect(earth.visible).toBe(true);
    const dist = earth.position.distanceTo(camera.position);
    const angularDiameter = (2 * Math.asin(earth.scale.x / dist)) / DEG;
    expect(angularDiameter).toBeCloseTo(EARTH_ANGULAR_DIAMETER_DEG, 2);
    sky.dispose();
  });
});

describe('sky textures', () => {
  it('lights the environment only from the ground (black sky)', () => {
    expect(envRadiance(0.3)).toEqual([0, 0, 0]);
    const g = envRadiance(-0.3);
    expect(g[0]).toBeGreaterThan(0.2);
    expect(g[0]).toBeLessThan(0.5);
  });

  it('builds a deterministic, varied Earth texture without a canvas', () => {
    const a = buildEarthTexture(64, 32);
    const b = buildEarthTexture(64, 32);
    const da = a.image.data as Uint8Array;
    const db = b.image.data as Uint8Array;
    expect(da.length).toBe(64 * 32 * 4);
    expect(Array.from(da.slice(0, 400))).toEqual(Array.from(db.slice(0, 400)));
    const blues = new Set<number>();
    for (let i = 2; i < da.length; i += 4) blues.add(da[i]);
    expect(blues.size).toBeGreaterThan(20);
    a.dispose();
    b.dispose();
  });
});
