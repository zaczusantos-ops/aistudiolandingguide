import { describe, expect, it } from 'vitest';
import { BASE_PADS, KNOLLS, createHeightField } from './terrainHeight';
import { buildDetailGLSL, type RegolithScale } from './terrainShader';
import { generateRegolithTexture } from './terrainTexture';

/** Height of the mesh triangle under (x, z) computed directly from the built mesh data. */
function meshHeight(
  mesh: ReturnType<ReturnType<typeof createHeightField>['buildMesh']>,
  x: number,
  z: number,
): number | null {
  const p = mesh.positions;
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const minX = Math.min(p[a], p[b], p[c]);
    const maxX = Math.max(p[a], p[b], p[c]);
    const minZ = Math.min(p[a + 2], p[b + 2], p[c + 2]);
    const maxZ = Math.max(p[a + 2], p[b + 2], p[c + 2]);
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const v0x = p[b] - p[a];
    const v0z = p[b + 2] - p[a + 2];
    const v1x = p[c] - p[a];
    const v1z = p[c + 2] - p[a + 2];
    const v2x = x - p[a];
    const v2z = z - p[a + 2];
    const den = v0x * v1z - v1x * v0z;
    const u = (v2x * v1z - v1x * v2z) / den;
    const v = (v0x * v2z - v2x * v0z) / den;
    if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
    return p[a + 1] + u * (p[b + 1] - p[a + 1]) + v * (p[c + 1] - p[a + 1]);
  }
  return null;
}

describe('lunar ground height field', () => {
  it('is deterministic and finite', () => {
    const a = createHeightField({ seed: 42, lowPower: false });
    const b = createHeightField({ seed: 42, lowPower: false });
    for (let i = 0; i < 400; i++) {
      const x = Math.sin(i * 12.9898) * 3000;
      const z = Math.cos(i * 78.233) * 3000;
      const h = a.heightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBe(b.heightAt(x, z));
    }
    expect(Number.isFinite(a.heightAt(Number.NaN, 0))).toBe(true);
    expect(Number.isFinite(a.heightAt(1e7, -1e7))).toBe(true);
  });

  const D = Math.PI / 180;
  const at = (azDeg: number, r: number): [number, number] => [Math.sin(azDeg * D) * r, -Math.cos(azDeg * D) * r];
  const slopeAt = (f: ReturnType<typeof createHeightField>, x: number, z: number) =>
    Math.hypot(f.heightAt(x + 0.5, z) - f.heightAt(x - 0.5, z), f.heightAt(x, z + 0.5) - f.heightAt(x, z - 0.5));

  // Round-4 viewpoints (fpvPose x, z): base poses, the valley pose (t37/t39/t47) and the t41.5 view.
  const BASE_VIEWS: Array<[number, number]> = [
    [-8.34, -1.35], // t21 / t30
    [-9.24, 11.21], // t12
    [2.7, -12.11], // t05
  ];
  const VALLEY_VIEW: [number, number] = [-77.5, 45.8];

  it('keeps the base floor and the prop footprints nearly flat', () => {
    for (const seed of [7, 1234]) {
      const f = createHeightField({ seed, lowPower: false });
      expect(Math.abs(f.heightAt(0, 0))).toBeLessThan(0.05);
      // Prop footprints of the round-4 layout (+2 m): ship + group A, groups B/C, D + rover 1,
      // sunward group F, base camera spots, group E's crate and rover 2, the valley crate.
      const discs: Array<[number, number, number]> = [
        [-4.0, -35.5, 15.6],
        [-13.8, -39.4, 3.8],
        [-3.6, -25.9, 3.7],
        [0.4, -26.9, 4],
        [4.9, -22.7, 4.8],
        [-5.3, -8.1, 6.7],
        [-34.4, 15.7, 3.7],
        [-28.6, 10, 4.8],
        [-8.34, -1.35, 3],
        [2.7, -12.11, 2],
        [7, 1, 1.5],
        [73.7, -69.9, 3],
        [78.9, -83.3, 3],
        [-74, 45.5, 3],
      ];
      for (const [cx, cz, R] of discs) {
        let min = Infinity;
        let max = -Infinity;
        let maxSlope = 0;
        for (let x = cx - R; x <= cx + R; x += 1) {
          for (let z = cz - R; z <= cz + R; z += 1) {
            if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
            const h = f.heightAt(x, z);
            min = Math.min(min, h);
            max = Math.max(max, h);
            maxSlope = Math.max(maxSlope, slopeAt(f, x, z));
          }
        }
        expect(max - min).toBeLessThan(0.8);
        expect(maxSlope).toBeLessThan(Math.tan((R < 5 ? 5.5 : 2) * D));
      }
      // Keep-flat pads are level.
      for (const p of BASE_PADS) {
        const h0 = f.heightAt(p.x, p.z);
        for (let a = 0; a < 360; a += 30) {
          const [dx, dz] = at(a, p.r * 0.85);
          expect(Math.abs(f.heightAt(p.x + dx, p.z + dz) - h0)).toBeLessThan(0.08);
        }
      }
    }
  });

  /** Highest elevation (deg) of the terrain seen from (x, z) at eye height along `az`. */
  const skyline = (f: ReturnType<typeof createHeightField>, x: number, z: number, az: number, eyeH = 1.7): number => {
    const eye = f.heightAt(x, z) + eyeH;
    let best = -90;
    for (let d = 3; d < 6000; d *= 1.01) {
      const [dx, dz] = at(az, d);
      best = Math.max(best, Math.atan2(f.heightAt(x + dx, z + dz) - eye, d) / D);
    }
    return best;
  };

  /**
   * Angular height (deg) of the visible ground turned away from the illustrative Sun (azimuth 252°,
   * elevation 10°) right below the skyline along `az`: the "dark band" seen from (x, z).
   */
  const darkBand = (f: ReturnType<typeof createHeightField>, x: number, z: number, az: number, eyeH = 1.7): number => {
    const sun = [Math.cos(10 * D) * Math.sin(252 * D), Math.sin(10 * D), -Math.cos(10 * D) * Math.cos(252 * D)];
    const eye = f.heightAt(x, z) + eyeH;
    let best = -90;
    let band = 0;
    let run = 0;
    for (let d = 3; d < 6000; d *= 1.005) {
      const [dx, dz] = at(az, d);
      const px = x + dx;
      const pz = z + dz;
      const e = Math.atan2(f.heightAt(px, pz) - eye, d) / D;
      if (e <= best) continue;
      const s = Math.max(1, d / 200);
      const hx = (f.heightAt(px + s, pz) - f.heightAt(px - s, pz)) / (2 * s);
      const hz = (f.heightAt(px, pz + s) - f.heightAt(px, pz - s)) / (2 * s);
      const mu = (-hx * sun[0] + sun[1] - hz * sun[2]) / Math.hypot(hx, 1, hz);
      run = mu < 0 ? run + (e - best) : 0;
      band = Math.max(band, run);
      best = e;
    }
    return band;
  };

  it('hides the valley and its dark wall from the base, and shows them from the valley', () => {
    for (const seed of [7, 1234]) {
      const f = createHeightField({ seed, lowPower: false });
      // Base views toward the Sun side (W/NW and SW): skyline near eye level, no dark band.
      for (const [x, z] of BASE_VIEWS) {
        for (let az = 205; az <= 305; az += 5) {
          expect(darkBand(f, x, z, az)).toBeLessThan(0.75);
          expect(skyline(f, x, z, az)).toBeLessThan(1.6);
        }
      }
      // The valley floor lies well below the base floor...
      const [vx, vz] = VALLEY_VIEW;
      expect(f.heightAt(vx, vz)).toBeLessThan(-5);
      // ...the wall right of the Sun shows a dark band capped by a rim just above eye level...
      let bands = 0;
      for (let az = 265; az <= 290; az += 5) {
        const sky = skyline(f, vx, vz, az);
        expect(sky).toBeGreaterThan(0.5);
        expect(sky).toBeLessThan(2.5);
        if (darkBand(f, vx, vz, az) > 1.2) bands++;
      }
      expect(bands).toBeGreaterThanOrEqual(5);
      // ...and the ground rises on the left (S/SW) of the views toward the Sun.
      for (const az of [200, 215, 225]) expect(skyline(f, vx, vz, az)).toBeGreaterThan(2.5);
    }
  });

  it('keeps knolls gently sloped and the spawn / sunward cameras on the floor', () => {
    const f = createHeightField({ seed: 7, lowPower: false });
    for (const k of KNOLLS) {
      // Max slope of h(1-q^2)^2 is ~1.54 h / min(a, b): keep it under ~10.5° so the flanks stay lit.
      expect(Math.atan((1.54 * k.h) / Math.min(k.a, k.b)) / D).toBeLessThan(10.5);
    }
    // Ahead of the t41.5 viewpoint the skyline climbs a few degrees (knolls N/NE and E).
    expect(skyline(f, 70, -70, 42)).toBeGreaterThan(2.5);
    expect(skyline(f, 70, -70, 88)).toBeGreaterThan(4);
    // No mound behind the spawn: the spawn, t08 and t12 cameras all stand on the floor.
    expect(Math.abs(f.heightAt(-2.37, 10.77))).toBeLessThan(0.3);
    expect(Math.abs(f.heightAt(7, 1))).toBeLessThan(0.3);
    expect(Math.abs(f.heightAt(-9.24, 11.21))).toBeLessThan(0.3);
  });

  it('heightAt matches the rendered triangles (low-power mesh)', () => {
    const f = createHeightField({ seed: 11, lowPower: true });
    const mesh = f.buildMesh();
    expect(mesh.triangleCount).toBe(mesh.indices.length / 3);
    const pts: Array<[number, number]> = [
      [0.3, 0.7],
      [13.1, -57.9],
      [191.7, 3.2], // ring border (stitched)
      [-192.2, 100.5],
      [250.4, -300.6],
      [-383.9, 384.1],
      [700.2, -10.5],
    ];
    for (const [x, z] of pts) {
      const hm = meshHeight(mesh, x, z);
      expect(hm).not.toBeNull();
      expect(Math.abs(f.heightAt(x, z) - (hm as number))).toBeLessThan(0.01);
    }
  });

  it('builds a mesh within the triangle budget', () => {
    const f = createHeightField({ seed: 1, lowPower: false });
    const t0 = performance.now();
    const mesh = f.buildMesh();
    const dt = performance.now() - t0;
    expect(mesh.triangleCount).toBeLessThan(400_000);
    expect(f.extent).toBeGreaterThan(3000);
    for (let i = 0; i < mesh.positions.length; i += 997) expect(Number.isFinite(mesh.positions[i])).toBe(true);
    console.info(`terrain mesh: ${mesh.triangleCount} tris in ${dt.toFixed(0)} ms`);
  });
});

describe('regolith shader', () => {
  it('samples every detail scale with an explicit, footprint-widened gradient', () => {
    const scales: RegolithScale[] = [
      { tile: 1.15, angle: 0.37, offset: [0.13, 0.71], slope: 0.6, cavity: 0.3, albedo: 0.1, fade: [8, 22] },
      { tile: 37, angle: 4.13, offset: [0.8, 0.4], slope: 0.4, cavity: 0.3, albedo: 0.3, fade: null, damp: [4, 24, 1], tintFadeIn: [3, 15] },
    ];
    const glsl = buildDetailGLSL(scales);
    expect(glsl.match(/textureGrad\(uDetail/g)?.length).toBe(2);
    expect(glsl).toContain('dFdx(xz)');
    expect(glsl).toContain('uIsoK');
    expect(glsl).not.toMatch(/texture2D\(/);
  });
});

describe('regolith detail texture', () => {
  it('is deterministic RGBA with neutral mean slope', () => {
    const t0 = performance.now();
    const a = generateRegolithTexture(512, 5);
    const dt = performance.now() - t0;
    const b = generateRegolithTexture(512, 5);
    expect(a.data.length).toBe(512 * 512 * 4);
    expect(a.data).toEqual(b.data);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      sx += a.data[i] - 128;
      sy += a.data[i + 1] - 128;
    }
    const n = a.data.length / 4;
    expect(Math.abs(sx / n)).toBeLessThan(2);
    expect(Math.abs(sy / n)).toBeLessThan(2);
    console.info(`regolith 512: ${dt.toFixed(0)} ms`);
  });
});
