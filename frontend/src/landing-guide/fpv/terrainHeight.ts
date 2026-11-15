/**
 * Pure (three.js-free) height field for the first-person lunar ground.
 *
 * The rendered ground is a static set of nested square LOD rings centred on the origin
 * (level k has spacing s0·2^k and half-extent n·s0·2^k). Vertex heights come from a
 * band-limited analytic function; the outer border of each ring is stitched to the next
 * coarser ring so there are no cracks. `heightAt` interpolates the very same triangles,
 * so feet and props agree with the rendered surface exactly (up to float rounding).
 *
 * Everything here is illustrative scenery: no real topography is implied.
 */

import { landformAt, type LandformSample } from './terrainLandform';

export interface TerrainLayout {
  /** Spacing of the innermost ring (m). */
  s0: number;
  /** Half-extent of every ring in cells (even). */
  n: number;
  /** Number of rings. */
  levels: number;
}

export const TERRAIN_LAYOUT: TerrainLayout = { s0: 2, n: 96, levels: 6 };
export const TERRAIN_LAYOUT_LOW: TerrainLayout = { s0: 4, n: 48, levels: 6 };

const MOON_RADIUS_M = 1_737_400;

export interface HeightFieldOptions {
  seed: number;
  lowPower: boolean;
  horizonElevDeg?: number[];
}

export interface TerrainMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

export interface HeightField {
  layout: TerrainLayout;
  /** Band-limited analytic surface (before triangulation). */
  analytic(x: number, z: number): number;
  /** Height of the rendered mesh at world x/z (exact triangle interpolation). */
  heightAt(x: number, z: number): number;
  /** Builds the LOD ring mesh whose triangles `heightAt` reproduces. */
  buildMesh(): TerrainMeshData;
  /** Half-extent (m) of the outermost ring. */
  extent: number;
}

// ---------------------------------------------------------------------------------------------
// Noise helpers
// ---------------------------------------------------------------------------------------------

export function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ s) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const GRAD_X = new Float64Array(256);
const GRAD_Y = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const a = ((i + 0.5) / 256) * Math.PI * 2;
  GRAD_X[i] = Math.cos(a);
  GRAD_Y[i] = Math.sin(a);
}

/** 2D gradient noise, roughly in [-1, 1]. */
export function gnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const h00 = hash2(xi, yi, s) & 255;
  const h10 = hash2(xi + 1, yi, s) & 255;
  const h01 = hash2(xi, yi + 1, s) & 255;
  const h11 = hash2(xi + 1, yi + 1, s) & 255;
  const n00 = GRAD_X[h00] * xf + GRAD_Y[h00] * yf;
  const n10 = GRAD_X[h10] * (xf - 1) + GRAD_Y[h10] * yf;
  const n01 = GRAD_X[h01] * xf + GRAD_Y[h01] * (yf - 1);
  const n11 = GRAD_X[h11] * (xf - 1) + GRAD_Y[h11] * (yf - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * 1.41;
}

/** 2D value noise in [0, 1]. */
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const k = 1 / 4294967296;
  const a = hash2(xi, yi, s) * k;
  const b = hash2(xi + 1, yi, s) * k;
  const c = hash2(xi, yi + 1, s) * k;
  const d = hash2(xi + 1, yi + 1, s) * k;
  const ab = a + u * (b - a);
  const cd = c + u * (d - c);
  return ab + v * (cd - ab);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Soft-rimmed shallow crater profile; t = distance / radius, zero beyond t = 2. */
function craterProfile(t: number): number {
  const bowl = t < 1.1 ? -(1 - smooth(0, 1.1, t)) : 0;
  const r = (t - 1.05) / 0.32;
  return bowl + 0.24 * Math.exp(-r * r);
}

function seedInt(seed: number): number {
  const s = Number.isFinite(seed) ? seed : 0;
  return hash2(Math.floor(s) | 0, Math.floor((s % 1) * 1e6) | 0, 0x5eed);
}

/** Periodic Catmull-Rom interpolation of evenly spaced azimuth knots (az in radians, clockwise from North). */
export function azKnots(values: readonly number[], azRad: number): number {
  const n = values.length;
  let f = (azRad / (2 * Math.PI)) * n;
  f = ((f % n) + n) % n;
  const i1 = Math.floor(f);
  const t = f - i1;
  const p0 = values[(i1 - 1 + n) % n];
  const p1 = values[i1 % n];
  const p2 = values[(i1 + 1) % n];
  const p3 = values[(i1 + 2) % n];
  const t2 = t * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
}

// ---------------------------------------------------------------------------------------------
// Large-scale layout (deterministic, so every site keeps the composition of the reference walk).
// The base cluster sits on a calm floor with a low bowl rim around it. W/SW of the base the
// ground falls into a broad valley toward the distant greenhouse; its western edge turns a dark
// face toward the valley, hidden from the base by a low lip (terrainLandform.ts). Knolls add
// local rises. Illustrative scenery only.
// ---------------------------------------------------------------------------------------------

/** Knots every 30° from North (clockwise): crest height (m), rise start and crest radius (m). */
export const BOWL_HEIGHT = [-0.6, 1.0, 6.3, 6.2, 6.0, 6.3, 3.0, 2.5, 1.5, 0.3, 0.3, 1.0];
export const BOWL_RISE_START = [118, 128, 121, 98, 84, 64, 56, 60, 80, 40, 46, 70];
export const BOWL_CREST = [262, 250, 196, 180, 176, 165, 152, 158, 178, 104, 110, 150];

/**
 * Keep-flat pads (m) under props standing on sloping ground (the distant greenhouse, group E's
 * crate and rover on the knoll's flank, the valley crate): inside `r` the ground is levelled to the
 * height at the pad centre, blending back to the natural relief over `blend` metres.
 */
export interface Pad {
  x: number;
  z: number;
  r: number;
  blend: number;
}
export const BASE_PADS: readonly Pad[] = [
  { x: -324.2, z: 198.1, r: 46, blend: 30 },
  // Single dark crate and rover 2 of group E (layout_round4, t41.5/t43); the row itself follows
  // the knoll's natural slope.
  { x: 73.7, z: -69.9, r: 3.5, blend: 6 },
  { x: 78.9, z: -83.3, r: 3.6, blend: 6 },
  // Lone dark crate in the valley (t47 foreground), on the valley's descent.
  { x: -74, z: 45.5, r: 3.4, blend: 5 },
];

/**
 * Local knolls (elliptical swells h·(1 − q²)²). Centre (m), semi-axes a (along `axisAz`, degrees
 * clockwise from North) and b (m), height h (m).
 */
export interface Knoll {
  x: number;
  z: number;
  a: number;
  b: number;
  axisAz: number;
  h: number;
}
export const KNOLLS: readonly Knoll[] = [
  // Rising ground on the left of the valley views toward the Sun (t37/t39/t47), facing ≈ North.
  { x: -96, z: 104, a: 92, b: 62, axisAz: 100, h: 4.8 },
  // Rise E of the second container row: the right skyline of t41.5/t43 climbs over it.
  { x: 125, z: -75, a: 66, b: 70, axisAz: 90, h: 7 },
  // Broad rise N/NE of the second row (skyline ahead of the t41.5/t43 views).
  { x: 106.5, z: -138.7, a: 73, b: 45.5, axisAz: 100, h: 5.2 },
];

// No raised mound for the t08 view: a ~47° bump right behind the spawn hurt the walk more than
// matching that single reference frame helped. t08 is framed from the floor instead.
const ALL_KNOLLS: readonly Knoll[] = KNOLLS;

// ---------------------------------------------------------------------------------------------
// Height field
// ---------------------------------------------------------------------------------------------

export function createHeightField(opts: HeightFieldOptions): HeightField {
  const layout = opts.lowPower ? TERRAIN_LAYOUT_LOW : TERRAIN_LAYOUT;
  const { s0, n, levels } = layout;
  const L0 = n * s0;
  const extent = L0 * 2 ** (levels - 1);
  const base = seedInt(opts.seed);
  const S = Array.from({ length: 20 }, (_, i) => hash2(base, i * 7919 + 13, 0x1234567));
  // Layout noise is seed-independent (the composition must not depend on the site).
  const SL = Array.from({ length: 8 }, (_, i) => hash2(0x2f1a, i * 104729 + 7, 0x7a11));

  // Subtle far-hill modulation from the site's skyline profile (illustrative only).
  const prof = opts.horizonElevDeg && opts.horizonElevDeg.length > 0 ? opts.horizonElevDeg : null;
  let profMax = 1;
  if (prof) for (const e of prof) if (Number.isFinite(e)) profMax = Math.max(profMax, e);
  const horizonFactor = (azDeg: number): number => {
    if (!prof) return 1;
    const f = (azDeg / 360) * prof.length;
    const i0 = Math.floor(f) % prof.length;
    const i1 = (i0 + 1) % prof.length;
    const w = f - Math.floor(f);
    const e = (Number.isFinite(prof[i0]) ? prof[i0] : 0) * (1 - w) + (Number.isFinite(prof[i1]) ? prof[i1] : 0) * w;
    return 0.8 + 0.4 * Math.min(1, Math.max(0, e / profMax));
  };

  /** Continuous counterpart of the ring spacing at radius r (used to band-limit features). */
  const spacingAt = (r: number): number => s0 * Math.max(1, (2 * r) / L0);
  /** Weight of a feature with wavelength `lambda` given local spacing `sc`. */
  const band = (lambda: number, sc: number): number => smooth(4 * sc, 8 * sc, lambda);

  /**
   * Cellular layer of round features (craters when `mound` is false, hummocks otherwise),
   * weighted by `gate(rc)` at the feature centre and band-limited by the local mesh spacing.
   */
  const featureLayer = (
    x: number,
    z: number,
    cell: number,
    prob: number,
    rMin: number,
    rMax: number,
    rel0: number,
    rel1: number,
    seedC: number,
    mound: boolean,
    gate: (px: number, pz: number) => number,
  ): number => {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let sum = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        const h1 = hash2(i, j, seedC);
        if ((h1 & 0xffff) > prob * 65536) continue;
        const h2 = hash2(i, j, seedC + 101);
        const u = (h1 >>> 16) / 65536;
        const R = rMin + (rMax - rMin) * u * u;
        const px = (i + (h2 & 0xffff) / 65536) * cell;
        const pz = (j + (h2 >>> 16) / 65536) * cell;
        const dx = x - px;
        const dz = z - pz;
        const d2 = dx * dx + dz * dz;
        const reach = mound ? 1.0 : 2.0;
        if (d2 >= reach * reach * R * R) continue;
        let w = gate(px, pz);
        if (w <= 0) continue;
        const rc = Math.sqrt(px * px + pz * pz);
        const scC = spacingAt(rc + R);
        w *= smooth(2 * scC, 4 * scC, R);
        if (w <= 0) continue;
        const h3 = hash2(i, j, seedC + 202);
        const amp = R * (rel0 + (rel1 - rel0) * ((h3 & 0xffff) / 65536));
        const t = Math.sqrt(d2) / R;
        if (mound) {
          const q = 1 - t * t;
          sum += w * amp * q * q;
        } else {
          sum += w * amp * craterProfile(t);
        }
      }
    }
    return sum;
  };

  const bowlWob = (x: number, z: number, sc: number): number =>
    14 * band(180, sc) * gnoise(x / 180 + 3.7, z / 180 - 1.3, SL[0]);
  const bowlRiseStart = (x: number, z: number, azR: number, sc: number): number =>
    azKnots(BOWL_RISE_START, azR) + 0.4 * bowlWob(x, z, sc);
  /** Bowl rim relief: 0 on the floor, rising to the crest, then easing back down. */
  const bowlAt = (x: number, z: number, r: number, azR: number, sc: number): number => {
    const wob = bowlWob(x, z, sc);
    const r0 = azKnots(BOWL_RISE_START, azR) + 0.4 * wob;
    const r1 = azKnots(BOWL_CREST, azR) + wob;
    const H = azKnots(BOWL_HEIGHT, azR) * (1 + 0.18 * gnoise(x / 260 - 5.5, z / 260 + 2.1, SL[1]));
    return H * (smooth(r0, r1, r) - 0.55 * smooth(r1, r1 + 260, r));
  };
  const azOf = (x: number, z: number): number => {
    const a = Math.atan2(x, -z);
    return a < 0 ? a + 2 * Math.PI : a;
  };
  /** Pad weight (1 inside a pad, 0 beyond its blend ring) and index of the dominant pad. */
  let padNearest = 0;
  const padWeight = (x: number, z: number): number => {
    let w = 0;
    for (let i = 0; i < BASE_PADS.length; i++) {
      const p = BASE_PADS[i];
      const wi = 1 - smooth(p.r, p.r + p.blend, Math.hypot(x - p.x, z - p.z));
      if (wi > w) {
        w = wi;
        padNearest = i;
      }
    }
    return w;
  };

  const knollAxes = ALL_KNOLLS.map((k) => {
    const a = (k.axisAz * Math.PI) / 180;
    return { ux: Math.sin(a), uz: -Math.cos(a) };
  });
  const knollsAt = (x: number, z: number): number => {
    let sum = 0;
    for (let i = 0; i < ALL_KNOLLS.length; i++) {
      const k = ALL_KNOLLS[i];
      const dx = x - k.x;
      const dz = z - k.z;
      const u = (dx * knollAxes[i].ux + dz * knollAxes[i].uz) / k.a;
      const v = (-dx * knollAxes[i].uz + dz * knollAxes[i].ux) / k.b;
      const q2 = u * u + v * v;
      if (q2 >= 1) continue;
      const t = 1 - q2;
      sum += k.h * t * t;
    }
    return sum;
  };

  const lf: LandformSample = { h: 0, keep: 1 };
  const rimWobble = (azR: number): number =>
    0.8 * gnoise(Math.sin(azR) * 2.3 + 1.7, -Math.cos(azR) * 2.3 - 0.9, SL[2]) +
    0.2 * gnoise(Math.sin(azR) * 9.5 - 4.1, -Math.cos(azR) * 9.5 + 2.6, SL[3]);

  const rawCore = (x: number, z: number): number => {
    const r2 = x * x + z * z;
    const r = Math.sqrt(r2);
    const sc = spacingAt(r);
    let azDeg = (Math.atan2(x, -z) * 180) / Math.PI;
    if (azDeg < 0) azDeg += 360;
    const azR = (azDeg * Math.PI) / 180;
    let h = 0;

    // --- Calm floor of the base and the low bowl rim around it -----------------------------
    const r0 = bowlRiseStart(x, z, azR, sc);
    h += bowlAt(x, z, r, azR, sc);
    h += knollsAt(x, z);
    // Valley, wall and lip (terrainLandform.ts); `keep` calms the swells/hummocks there.
    landformAt(r, azDeg, rimWobble, lf);
    h += lf.h;
    const keep = lf.keep;
    /** 0 on the calm floor (props), 1 beyond the start of the rim. */
    const rough = smooth(r0 - 8, r0 + 55, r);

    // Gentle metre-scale undulation everywhere (keeps the floor from looking ironed).
    h +=
      (0.5 + 0.5 * rough) *
      (0.5 * band(80, sc) * gnoise(x / 80, z / 80, S[0]) +
        0.26 * band(40, sc) * gnoise(x / 40 + 17.3, z / 40 - 4.1, S[1]) +
        0.11 * band(20, sc) * gnoise(x / 20 - 9.7, z / 20 + 3.3, S[2]));

    if (rough > 0) {
      // Rougher ground beyond the floor: lumpy swales, small soft craters and hummocks that
      // break the far plain into lit and shaded patches under the grazing Sun.
      const fr = rough * (1 - smooth(1800, 2600, r)) * (0.4 + 0.6 * keep);
      h +=
        fr *
        (0.55 * band(56, sc) * gnoise(x / 56 + 1.1, z / 56 + 7.9, S[13]) +
          0.28 * band(27, sc) * gnoise(x / 27 - 3.4, z / 27 + 0.7, S[14]) +
          0.12 * band(13, sc) * gnoise(x / 13 + 8.8, z / 13 - 6.2, S[15]));
      const roughGate = (px: number, pz: number): number => {
        const rr = Math.sqrt(px * px + pz * pz);
        const rs = azKnots(BOWL_RISE_START, azOf(px, pz));
        return smooth(rs + 5, rs + 45, rr) * (1 - smooth(900, 1400, rr)) * (1 - padWeight(px, pz));
      };
      h += featureLayer(x, z, 34, 0.3, 3, 9, 0.1, 0.17, S[6], false, roughGate);
      h += (0.4 + 0.6 * keep) * featureLayer(x, z, 110, 0.4, 9, 26, 0.06, 0.11, S[7], false, roughGate);
      h += keep * featureLayer(x, z, 60, 0.45, 8, 22, 0.08, 0.16, S[16], true, roughGate);
    }

    // Broad swells of the plain beyond the base.
    const fM = smooth(160, 700, r) * keep;
    if (fM > 0) {
      h +=
        fM *
        (6 * gnoise(x / 520, z / 520, S[3]) +
          2.2 * band(260, sc) * gnoise(x / 260 + 5.1, z / 260 + 1.7, S[4]) +
          1.1 * band(130, sc) * gnoise(x / 130 - 2.9, z / 130 + 8.3, S[5]));
    }

    // Hummocks on the far plain and along the skyline (lit tops, shaded Sun-averted flanks).
    if (r > 250) {
      const farGate = (px: number, pz: number): number => {
        const rr = Math.sqrt(px * px + pz * pz);
        return smooth(300, 600, rr) * (1 - smooth(3600, 4600, rr)) * (1 - padWeight(px, pz));
      };
      h += keep * featureLayer(x, z, 230, 0.55, 28, 75, 0.07, 0.15, S[17], true, farGate);
      h += keep * featureLayer(x, z, 520, 0.5, 70, 180, 0.06, 0.12, S[18], true, farGate);
    }

    // Far low rolling hills on the horizon (modest: the skyline stays within ~2°).
    const fF = smooth(500, 1800, r) * (1 - smooth(4300, 5900, r)) * keep;
    if (fF > 0) {
      const an = vnoise(x / 2600 + 3.1, z / 2600 - 7.7, S[8]);
      const amp = (14 + 46 * an * an) * horizonFactor(azDeg);
      const b =
        0.5 * gnoise(x / 1700, z / 1700, S[9]) +
        0.3 * band(850, sc) * gnoise(x / 850 + 1.3, z / 850 - 2.2, S[10]) +
        0.18 * band(425, sc) * gnoise(x / 425 - 4.4, z / 425 + 6.1, S[11]) +
        0.1 * band(212, sc) * gnoise(x / 212 + 7.7, z / 212 + 0.6, S[12]);
      const ridge = 1 - Math.abs(gnoise(x / 900 + 11.1, z / 900 - 3.3, S[19]));
      h += fF * amp * (0.6 * (b + 0.5) + 0.4 * ridge * ridge);
    }

    // Lunar curvature drop (hides the mesh edge behind a natural horizon).
    h -= r2 / (2 * MOON_RADIUS_M);
    return h;
  };

  const padHeight = BASE_PADS.map((p) => rawCore(p.x, p.z));
  const raw = (x: number, z: number): number => {
    const h = rawCore(x, z);
    const w = padWeight(x, z);
    return w > 0 ? h + w * (padHeight[padNearest] - h) : h;
  };

  const h0 = raw(0, 0);
  const analytic = (x: number, z: number): number => raw(x, z) - h0;

  const spacing = (k: number) => s0 * 2 ** k;
  const half = (k: number) => n * spacing(k);
  const N = 2 * n; // cells per side

  /** Height of vertex (i, j) of ring k, with outer-border stitching to ring k + 1. */
  const vertexHeight = (k: number, i: number, j: number): number => {
    const s = spacing(k);
    const L = half(k);
    const x = -L + i * s;
    const z = -L + j * s;
    if (k < levels - 1) {
      if ((i === 0 || i === N) && (j & 1) === 1) {
        return 0.5 * (analytic(x, z - s) + analytic(x, z + s));
      }
      if ((j === 0 || j === N) && (i & 1) === 1) {
        return 0.5 * (analytic(x - s, z) + analytic(x + s, z));
      }
    }
    return analytic(x, z);
  };

  const levelOf = (x: number, z: number): number => {
    const rho = Math.max(Math.abs(x), Math.abs(z));
    if (rho <= L0) return 0;
    const k = Math.ceil(Math.log2(rho / L0) - 1e-12);
    return Math.min(levels - 1, Math.max(0, k));
  };

  const heightAt = (x: number, z: number): number => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const rho = Math.max(Math.abs(x), Math.abs(z));
    if (rho >= extent) return analytic(x, z);
    const k = levelOf(x, z);
    const s = spacing(k);
    const L = half(k);
    const gx = (x + L) / s;
    const gz = (z + L) / s;
    const i = Math.min(N - 1, Math.max(0, Math.floor(gx)));
    const j = Math.min(N - 1, Math.max(0, Math.floor(gz)));
    const fx = gx - i;
    const fz = gz - j;
    const h00 = vertexHeight(k, i, j);
    const h11 = vertexHeight(k, i + 1, j + 1);
    if (fz >= fx) {
      const h01 = vertexHeight(k, i, j + 1);
      return h00 + fz * (h01 - h00) + fx * (h11 - h01);
    }
    const h10 = vertexHeight(k, i + 1, j);
    return h00 + fx * (h10 - h00) + fz * (h11 - h10);
  };

  const buildMesh = (): TerrainMeshData => {
    const V = N + 1;
    const perLevel = V * V;
    const positions = new Float32Array(perLevel * levels * 3);
    const normals = new Float32Array(perLevel * levels * 3);
    const quarter = n / 2;
    const inHoleCell = (k: number, i: number, j: number) =>
      k > 0 && i >= quarter && i < N - quarter && j >= quarter && j < N - quarter;
    const vertexUsed = (k: number, i: number, j: number) =>
      k === 0 || i <= quarter || i >= N - quarter || j <= quarter || j >= N - quarter;
    let triCount = 0;
    for (let k = 0; k < levels; k++) {
      const cells = k === 0 ? N * N : N * N - n * n;
      triCount += cells * 2;
    }
    const indices = new Uint32Array(triCount * 3);
    let ip = 0;
    const hg = new Float64Array(perLevel);

    for (let k = 0; k < levels; k++) {
      const s = spacing(k);
      const L = half(k);
      const off = k * perLevel;
      hg.fill(0);
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          if (!vertexUsed(k, i, j)) continue;
          hg[j * V + i] = vertexHeight(k, i, j);
        }
      }
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          if (!vertexUsed(k, i, j)) continue;
          const x = -L + i * s;
          const z = -L + j * s;
          const idx = off + j * V + i;
          positions[idx * 3] = x;
          positions[idx * 3 + 1] = hg[j * V + i];
          positions[idx * 3 + 2] = z;

          const outer = i === 0 || i === N || j === 0 || j === N;
          const inner =
            k > 0 &&
            ((i === quarter || i === N - quarter) && j >= quarter && j <= N - quarter ||
              (j === quarter || j === N - quarter) && i >= quarter && i <= N - quarter);
          let dhx: number;
          let dhz: number;
          if (outer || inner) {
            // Shared border vertices: same analytic stencil on both rings -> no shading seam.
            const e = outer && k < levels - 1 ? 2 * s : s;
            dhx = (analytic(x + e, z) - analytic(x - e, z)) / (2 * e);
            dhz = (analytic(x, z + e) - analytic(x, z - e)) / (2 * e);
          } else {
            dhx = (hg[j * V + i + 1] - hg[j * V + i - 1]) / (2 * s);
            dhz = (hg[(j + 1) * V + i] - hg[(j - 1) * V + i]) / (2 * s);
          }
          const inv = 1 / Math.sqrt(dhx * dhx + 1 + dhz * dhz);
          normals[idx * 3] = -dhx * inv;
          normals[idx * 3 + 1] = inv;
          normals[idx * 3 + 2] = -dhz * inv;
        }
      }
      // Stitched odd border vertices take the average normal of their even neighbours.
      if (k < levels - 1) {
        const avg = (a: number, b: number, c: number) => {
          let nx = normals[b * 3] + normals[c * 3];
          let ny = normals[b * 3 + 1] + normals[c * 3 + 1];
          let nz = normals[b * 3 + 2] + normals[c * 3 + 2];
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          normals[a * 3] = nx;
          normals[a * 3 + 1] = ny;
          normals[a * 3 + 2] = nz;
        };
        for (let t = 1; t < N; t += 2) {
          avg(off + t * V, off + (t - 1) * V, off + (t + 1) * V);
          avg(off + t * V + N, off + (t - 1) * V + N, off + (t + 1) * V + N);
          avg(off + t, off + t - 1, off + t + 1);
          avg(off + N * V + t, off + N * V + t - 1, off + N * V + t + 1);
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if (inHoleCell(k, i, j)) continue;
          const v00 = off + j * V + i;
          const v10 = v00 + 1;
          const v01 = v00 + V;
          const v11 = v01 + 1;
          indices[ip++] = v00;
          indices[ip++] = v01;
          indices[ip++] = v11;
          indices[ip++] = v00;
          indices[ip++] = v11;
          indices[ip++] = v10;
        }
      }
    }
    return { positions, normals, indices, triangleCount: triCount };
  };

  return { layout, analytic, heightAt, buildMesh, extent };
}
