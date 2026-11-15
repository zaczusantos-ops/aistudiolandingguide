/**
 * Procedural, tileable regolith detail map (pure typed arrays, no DOM/canvas needed).
 *
 * One square tile is generated at startup and sampled by the ground shader at several
 * world scales. Channels (RGBA8, linear data):
 *   R, G  surface slope dh/du, dh/dv encoded as 128 + 64·slope (range ≈ ±2)
 *   B     cavity / occlusion (1 = open, lower inside pits and craterlets)
 *   A     albedo variation around 0.5
 * Heights are kept in texel units so the slopes stay the same at every sampling scale.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Adds periodic value-noise octaves (cells per tile) with the given amplitudes (texels). */
function addPeriodicNoise(
  dst: Float32Array,
  size: number,
  octaves: Array<{ cells: number; amp: number; billow?: boolean }>,
  rnd: () => number,
): void {
  const lat = octaves.map((o) => {
    const a = new Float32Array(o.cells * o.cells);
    for (let i = 0; i < a.length; i++) a[i] = rnd() * 2 - 1;
    return a;
  });
  // Per-octave x lookup tables.
  const xi0 = octaves.map(() => new Int32Array(size));
  const xi1 = octaves.map(() => new Int32Array(size));
  const xt = octaves.map(() => new Float32Array(size));
  octaves.forEach((o, k) => {
    const shift = rnd() * o.cells;
    for (let x = 0; x < size; x++) {
      const f = (x / size) * o.cells + shift;
      const i = Math.floor(f);
      const t = f - i;
      xi0[k][x] = i % o.cells;
      xi1[k][x] = (i + 1) % o.cells;
      xt[k][x] = t * t * (3 - 2 * t);
    }
  });
  const yShift = octaves.map((o) => rnd() * o.cells);
  const rows = octaves.map((o) => new Float32Array(o.cells));
  for (let y = 0; y < size; y++) {
    for (let k = 0; k < octaves.length; k++) {
      const c = octaves[k].cells;
      const f = (y / size) * c + yShift[k];
      const i = Math.floor(f);
      let t = f - i;
      t = t * t * (3 - 2 * t);
      const r0 = (i % c) * c;
      const r1 = ((i + 1) % c) * c;
      const la = lat[k];
      const row = rows[k];
      const amp = octaves[k].amp;
      for (let x = 0; x < c; x++) row[x] = amp * (la[r0 + x] + t * (la[r1 + x] - la[r0 + x]));
    }
    const base = y * size;
    for (let k = 0; k < octaves.length; k++) {
      const row = rows[k];
      const a0 = xi0[k];
      const a1 = xi1[k];
      const tt = xt[k];
      if (octaves[k].billow) {
        // Rounded lumps: |noise| re-centred, reads as clods under a grazing sun.
        const off = 0.45 * octaves[k].amp;
        for (let x = 0; x < size; x++) {
          const v0 = row[a0[x]];
          const v = v0 + tt[x] * (row[a1[x]] - v0);
          dst[base + x] += off - (v < 0 ? -v : v);
        }
      } else {
        for (let x = 0; x < size; x++) {
          const v0 = row[a0[x]];
          dst[base + x] += v0 + tt[x] * (row[a1[x]] - v0);
        }
      }
    }
  }
}

const LUT_N = 512;
function makeLut(f: (t: number) => number, tMax: number): Float32Array {
  // Indexed by (t / tMax)^2 to avoid square roots while stamping.
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) lut[i] = f(Math.sqrt(i / LUT_N) * tMax);
  return lut;
}

const FRESH_CRATER = makeLut((t) => {
  const bowl = t < 1 ? t * t - 1 : 0;
  const soft = t < 1 ? bowl * (1 - 0.35 * smooth(0.75, 1, t)) : 0;
  const r = (t - 1.0) / 0.22;
  return soft + 0.32 * Math.exp(-r * r);
}, 2);
const OLD_CRATER = makeLut((t) => {
  const bowl = -(1 - smooth(0, 1.15, t));
  const r = (t - 1.05) / 0.38;
  return bowl + 0.14 * Math.exp(-r * r);
}, 2);
const CLOD = makeLut((t) => Math.exp(-t * t * 2.2), 2);
const DIMPLE = makeLut((t) => {
  const r = (t - 1.02) / 0.2;
  return -(1 - smooth(0.45, 1.0, t)) + 0.08 * Math.exp(-r * r);
}, 1.6);
/** Steeper-walled pit with a raised rim (footprint-like clusters). */
const PIT = makeLut((t) => {
  const r = (t - 1.0) / 0.16;
  return -(1 - smooth(0.6, 1.0, t)) + 0.22 * Math.exp(-r * r);
}, 1.6);

interface Stamp {
  cx: number;
  cy: number;
  /** Radius along the major axis (texels). */
  a: number;
  /** Minor/major axis ratio (1 = round). */
  ratio: number;
  angle: number;
  lutA: Float32Array;
  lutB: Float32Array | null;
  tMax: number;
  ampA: number;
  ampB: number;
  albedo: number;
}

function stamp(h: Float32Array, alb: Float32Array, size: number, s: Stamp): void {
  const reach = s.a * s.tMax;
  const x0 = Math.floor(s.cx - reach);
  const x1 = Math.ceil(s.cx + reach);
  const y0 = Math.floor(s.cy - reach);
  const y1 = Math.ceil(s.cy + reach);
  const ca = Math.cos(s.angle);
  const sa = Math.sin(s.angle);
  const invA = 1 / s.a;
  const invB = 1 / (s.a * s.ratio);
  // Quadratic form q = A dx^2 + 2B dx dy + C dy^2 (ellipse in texel space).
  const qa = ca * ca * invA * invA + sa * sa * invB * invB;
  const qb = ca * sa * (invA * invA - invB * invB);
  const qc = sa * sa * invA * invA + ca * ca * invB * invB;
  const k = LUT_N / (s.tMax * s.tMax);
  const lutA = s.lutA;
  const lutB = s.lutB;
  const ampA = s.ampA;
  const ampB = s.ampB;
  const albedo = s.albedo;
  for (let y = y0; y <= y1; y++) {
    const wy = y < 0 ? y + size : y >= size ? y - size : y;
    const dy = y - s.cy;
    const row = wy * size;
    const cy2 = qc * dy * dy;
    const cyx = 2 * qb * dy;
    let wx = x0 < 0 ? x0 + size : x0 >= size ? x0 - size : x0;
    for (let x = x0; x <= x1; x++, wx++) {
      if (wx >= size) wx -= size;
      const dx = x - s.cx;
      const q = qa * dx * dx + cyx * dx + cy2;
      const li = q * k;
      if (li >= LUT_N) continue;
      const idx = li | 0;
      const p = row + wx;
      h[p] += lutB ? ampA * lutA[idx] + ampB * lutB[idx] : ampA * lutA[idx];
      if (albedo !== 0) alb[p] += q < 1 ? albedo : 0.5 * albedo;
    }
  }
}

/** Separable periodic box blur (radius r), in place via a scratch buffer. */
function boxBlur(src: Float32Array, size: number, r: number, tmp: Float32Array): void {
  const w = 1 / (2 * r + 1);
  const addI = new Int32Array(size);
  const subI = new Int32Array(size);
  for (let x = 0; x < size; x++) {
    addI[x] = (x + r + 1) % size;
    subI[x] = (x - r + size) % size;
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[row + ((i + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = acc * w;
      acc += src[row + addI[x]] - src[row + subI[x]];
    }
  }
  const acc = new Float32Array(size);
  for (let i = -r; i <= r; i++) {
    const row = ((i + size) % size) * size;
    for (let x = 0; x < size; x++) acc[x] += tmp[row + x];
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const ra = addI[y] * size;
    const rs = subI[y] * size;
    for (let x = 0; x < size; x++) {
      src[row + x] = acc[x] * w;
      acc[x] += tmp[ra + x] - tmp[rs + x];
    }
  }
}

export interface RegolithTexture {
  size: number;
  data: Uint8Array;
}

/**
 * Generates the RGBA detail tile. `size` must be a power of two (512 for software GL,
 * 2048 otherwise). Deterministic for a given seed.
 */
export function generateRegolithTexture(size: number, seed: number): RegolithTexture {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const n = size * size;
  const h = new Float32Array(n);
  const alb = new Float32Array(n);
  const q = size / 2048; // texel scale relative to the 2048 reference

  // 1. Lumpy grain: periodic value noise, slope ≈ k per octave.
  const octaves: Array<{ cells: number; amp: number; billow?: boolean }> = [];
  const grain: Array<[number, number]> = [
    [23, 0.1],
    [47, 0.16],
    [97, 0.26],
    [193, 0.3],
    [389, 0.26],
  ];
  for (const [cells, slope] of grain) {
    if (cells > size / 3) continue;
    octaves.push({ cells, amp: (slope * size) / (2 * Math.PI * cells) });
  }
  const lumps: Array<[number, number]> = [
    [37, 0.22],
    [71, 0.3],
    [139, 0.34],
    [277, 0.3],
  ];
  for (const [cells, slope] of lumps) {
    if (cells > size / 3) continue;
    octaves.push({ cells, amp: (slope * size) / (2 * Math.PI * cells), billow: true });
  }
  addPeriodicNoise(h, size, octaves, rnd);

  // 2. Craterlets with a power-law size distribution.
  const rMinF = 0.0009;
  const rMaxF = 0.032;
  const nCraters = 22000;
  const ratio2 = (rMinF / rMaxF) ** 2;
  for (let c = 0; c < nCraters; c++) {
    const u = rnd();
    const rf = rMinF / Math.sqrt(1 - u * (1 - ratio2));
    const R = rf * size;
    if (R < 0.9) {
      rnd();
      rnd();
      rnd();
      continue;
    }
    const fresh = rnd() ** 2.2;
    const cx = rnd() * size;
    const cy = rnd() * size;
    const ratio = 0.72 + 0.28 * rnd();
    const angle = rnd() * Math.PI;
    // Small pits are deep and crisp; larger ones shallower and softened.
    const big = smooth(0.004, 0.03, rf);
    const depth = R * (0.22 + 0.28 * fresh) * (1 - 0.45 * big);
    stamp(h, alb, size, {
      cx,
      cy,
      a: R,
      ratio,
      angle,
      lutA: FRESH_CRATER,
      lutB: OLD_CRATER,
      tMax: 2,
      ampA: depth * fresh,
      ampB: depth * (1 - fresh),
      albedo: 0.035 * fresh * (1 - big) - 0.012,
    });
  }

  // 3. Clods / small lumps.
  const nClods = 24000;
  for (let c = 0; c < nClods; c++) {
    const rf = 0.0006 + 0.0038 * rnd() ** 2;
    const R = rf * size;
    const cx = rnd() * size;
    const cy = rnd() * size;
    const hgt = R * (0.45 + 0.6 * rnd());
    if (R < 0.7) continue;
    stamp(h, alb, size, {
      cx,
      cy,
      a: R,
      ratio: 0.6 + 0.4 * rnd(),
      angle: rnd() * Math.PI,
      lutA: CLOD,
      lutB: null,
      tMax: 2,
      ampA: hgt,
      ampB: 0,
      albedo: 0.06,
    });
  }

  // 4. Footprint-like elongated dimples: loose singles plus clusters of 3–7 pits with crisp,
  //    slightly raised rims (they read as small dark crescents with a lit far edge).
  const nDimples = 120;
  for (let c = 0; c < nDimples; c++) {
    const rf = 0.008 + 0.024 * rnd() ** 1.5;
    const A = rf * size;
    const ratio = 0.38 + 0.3 * rnd();
    const depth = A * ratio * (0.14 + 0.18 * rnd());
    stamp(h, alb, size, {
      cx: rnd() * size,
      cy: rnd() * size,
      a: A,
      ratio,
      angle: rnd() * Math.PI,
      lutA: DIMPLE,
      lutB: null,
      tMax: 1.6,
      ampA: depth,
      ampB: 0,
      albedo: -0.01,
    });
  }
  const nClusters = 70;
  for (let c = 0; c < nClusters; c++) {
    const cx0 = rnd() * size;
    const cy0 = rnd() * size;
    const dir = rnd() * Math.PI * 2;
    const count = 3 + Math.floor(rnd() * 5);
    const rf = 0.009 + 0.012 * rnd();
    const step = rf * size * (1.9 + 1.2 * rnd());
    for (let k = 0; k < count; k++) {
      const side = (k & 1 ? 1 : -1) * rf * size * (0.6 + 0.5 * rnd());
      const along = k * step + (rnd() - 0.5) * step * 0.5;
      const A = rf * size * (0.8 + 0.4 * rnd());
      const ratio = 0.42 + 0.25 * rnd();
      stamp(h, alb, size, {
        cx: cx0 + Math.cos(dir) * along - Math.sin(dir) * side,
        cy: cy0 + Math.sin(dir) * along + Math.cos(dir) * side,
        a: A,
        ratio,
        angle: dir + (rnd() - 0.5) * 0.6,
        lutA: PIT,
        lutB: null,
        tMax: 1.6,
        ampA: A * ratio * (0.3 + 0.15 * rnd()),
        ampB: 0,
        albedo: -0.015,
      });
    }
  }

  // 5. Albedo mottling (low frequency + fine speckle).
  addPeriodicNoise(
    alb,
    size,
    [
      { cells: 3, amp: 0.06 },
      { cells: 11, amp: 0.05 },
      ...(size >= 1024 ? [{ cells: 211, amp: 0.06 }] : []),
      ...(size >= 2048 ? [{ cells: 509, amp: 0.07 }] : [{ cells: Math.floor(size / 4) + 1, amp: 0.07 }]),
    ],
    rnd,
  );

  // 6. Cavity from local relative height.
  const blurred = new Float32Array(h);
  const tmp = new Float32Array(n);
  const br = Math.max(2, Math.round(9 * q));
  boxBlur(blurred, size, br, tmp);
  boxBlur(blurred, size, br, tmp);

  // Clamped array: assignment rounds and clamps to 0..255 for free.
  const out = new Uint8ClampedArray(n * 4);
  const cavK = 0.11 / q;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xm = x === 0 ? size - 1 : x - 1;
      const xp = x === size - 1 ? 0 : x + 1;
      const gx = (h[row + xp] - h[row + xm]) * 0.5;
      const gy = (h[yp + x] - h[ym + x]) * 0.5;
      const p = row + x;
      const o = p * 4;
      out[o] = 128 + gx * 64;
      out[o + 1] = 128 + gy * 64;
      const occ = 1 + (h[p] - blurred[p]) * cavK;
      out[o + 2] = (occ < 0.25 ? 0.25 : occ) * 255;
      out[o + 3] = (0.5 + alb[p]) * 255;
    }
  }
  return { size, data: new Uint8Array(out.buffer) };
}
