import { LandingSiteEntry } from '../navigator/types';

export type SurfaceMode = 'realistic' | 'topography';

export interface LunarAtlasData {
  width: number;
  height: number;
  isRealNasa: boolean;
  heightKm: Float32Array;
  polarWidth: number;
  polarHeightKm: Float32Array | null;
  albedoRgba: Uint8Array;
  topoRgba: Uint8Array;
  normalRgba: Uint8Array;
  dispRgba: Uint8Array;
  // Native polar stereographic caps (eliminates equirectangular pinching & tangent swirl at both poles)
  southCapWidth: number;
  southCapAlbedoRgba: Uint8Array;
  southCapTopoRgba: Uint8Array;
  southCapNormalRgba: Uint8Array;
  northCapWidth: number;
  northCapAlbedoRgba: Uint8Array;
  northCapTopoRgba: Uint8Array;
  northCapNormalRgba: Uint8Array;
}

export interface TopoLegendStop {
  elevKm: number;
  label: string;
  hex: string;
}

export const TOPO_LEGEND_STOPS: TopoLegendStop[] = [
  { elevKm: -9.0, label: '-9 km', hex: '#1d1459' },
  { elevKm: -5.5, label: '-5.5', hex: '#2563eb' },
  { elevKm: -2.0, label: '-2', hex: '#06b6d4' },
  { elevKm: 0.0, label: '0', hex: '#22c55e' },
  { elevKm: 2.5, label: '+2.5', hex: '#eab308' },
  { elevKm: 5.5, label: '+5.5', hex: '#ef4444' },
  { elevKm: 8.5, label: '+8.5 km', hex: '#fce7f3' },
];

const DEG = Math.PI / 180;
export const MIN_ELEV_KM = -9.5;
export const MAX_ELEV_KM = 11.0;
const LUNAR_REF_RADIUS_M = 1_737_400.0;
const POLAR_PATCH_SIZE = 1024;
const POLAR_MAP_SCALE_M = 80.0 * (7600.0 / POLAR_PATCH_SIZE);
const POLAR_PROJ_OFFSET = (POLAR_PATCH_SIZE - 1) / 2.0;

// Native LDEM_80S_80M stereographic span: (1024 * 593.75 m) / (2 * R_moon) ≈ 0.17497
export const POLAR_STEREO_SPAN =
  (POLAR_PATCH_SIZE * POLAR_MAP_SCALE_M) / (2.0 * LUNAR_REF_RADIUS_M);

// Extended isotropic Polar Stereographic cap span covering ±62.8° .. ±90° (eliminates 63°–80° equirectangular streaks)
export const POLAR_CAP_OUTER_SPAN = 0.48;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function normalizeLon(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

/**
 * Signed longitude in [-180, +180) centered on 0° prime meridian (matching NASA SVS CGI Moon Kit).
 */
export function toSignedLon(lonEastDeg: number): number {
  return ((lonEastDeg + 180) % 360 + 360) % 360 - 180;
}

/**
 * Unit sphere coordinates in Three.js object space:
 *   x = -cos(lat) * cos(lonEastDeg)
 *   y =  sin(lat)
 *   z =  cos(lat) * sin(lonEastDeg)
 * Prime meridian (0° E) maps to (-1, 0, 0). South pole (-90°) maps to (0, -1, 0).
 */
export function latLonToSphereUnit(
  latDeg: number,
  lonEastDeg: number,
): { x: number; y: number; z: number } {
  const phi = latDeg * DEG;
  const lam = normalizeLon(lonEastDeg) * DEG;
  const cosPhi = Math.cos(phi);
  return {
    x: -cosPhi * Math.cos(lam),
    y: Math.sin(phi),
    z: cosPhi * Math.sin(lam),
  };
}

export function sphereUnitToLatLon(
  x: number,
  y: number,
  z: number,
): { latDeg: number; lonEastDeg: number } {
  const len = Math.hypot(x, y, z) || 1;
  const nx = x / len;
  const ny = clamp(y / len, -1, 1);
  const nz = z / len;
  const latDeg = Math.asin(ny) / DEG;
  const lonEastDeg = normalizeLon(Math.atan2(nz, -nx) / DEG);
  return { latDeg, lonEastDeg };
}

/**
 * Convert (latDeg, lonEastDeg) to NASA SVS 0°-centered equirectangular UV:
 *   u in [0, 1): 0 = -180°, 0.5 = 0°, 1 = +180°
 *   v in [0, 1]: 0 = -90° (bottom), 1 = +90° (top)
 */
export function latLonToNasaSvsUv(latDeg: number, lonEastDeg: number): { u: number; v: number } {
  const lonS = toSignedLon(lonEastDeg);
  return {
    u: (lonS + 180) / 360,
    v: clamp((latDeg + 90) / 180, 0, 1),
  };
}

/**
 * Singularity-free Polar Stereographic UV within a cap of full stereographic width `span`.
 */
export function sphereUnitToPolarCapUv(
  x: number,
  y: number,
  z: number,
  southPole: boolean,
  span = POLAR_CAP_OUTER_SPAN,
): { u: number; v: number; xs: number; ys: number } {
  const denom = southPole ? Math.max(0.05, 1.0 - y) : Math.max(0.05, 1.0 + y);
  const xs = z / denom;
  const ys = -x / denom;
  return {
    xs,
    ys,
    u: 0.5 + xs / span,
    v: 0.5 - ys / span,
  };
}

/**
 * Exact singularity-free South Polar Stereographic coordinates matching LDEM_80S_80M.
 */
export function sphereUnitToSouthStereoUv(
  x: number,
  y: number,
  z: number,
): { u: number; v: number; xs: number; ys: number } {
  return sphereUnitToPolarCapUv(x, y, z, true, POLAR_STEREO_SPAN);
}

/**
 * Exact North Polar Stereographic coordinates symmetric to South Pole.
 */
export function sphereUnitToNorthStereoUv(
  x: number,
  y: number,
  z: number,
): { u: number; v: number; xs: number; ys: number } {
  return sphereUnitToPolarCapUv(x, y, z, false, POLAR_STEREO_SPAN);
}

/**
 * Inverse stereographic map from normalized UV (u, v in [0,1]) back to unit sphere direction.
 */
export function polarStereoUvToSphereUnit(
  u: number,
  v: number,
  southPole: boolean,
  span = POLAR_STEREO_SPAN,
): { x: number; y: number; z: number } {
  const xs = (u - 0.5) * span;
  const ys = (0.5 - v) * span;
  const r2 = xs * xs + ys * ys;
  const invD = 1.0 / (1.0 + r2);
  return {
    x: -2.0 * ys * invD,
    y: southPole ? (r2 - 1.0) * invD : (1.0 - r2) * invD,
    z: 2.0 * xs * invD,
  };
}

/**
 * Hypsometric NASA LOLA elevation color ramp (-9 km .. +8.5 km).
 */
export function elevationToTopoRgb(elevKm: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [-9.0, [29, 20, 89]],
    [-5.5, [37, 99, 235]],
    [-2.0, [6, 182, 212]],
    [0.0, [34, 197, 94]],
    [2.5, [234, 179, 8]],
    [5.5, [239, 68, 68]],
    [8.5, [252, 231, 243]],
  ];
  if (elevKm <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (elevKm >= last[0]) return last[1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [e0, c0] = stops[i];
    const [e1, c1] = stops[i + 1];
    if (elevKm >= e0 && elevKm <= e1) {
      const t = (elevKm - e0) / (e1 - e0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return last[1];
}

function samplePolarPatchKmBilinear(
  polarHeightKm: Float32Array,
  polarWidth: number,
  latDeg: number,
  lonEastDeg: number,
): number {
  const rM = 2.0 * LUNAR_REF_RADIUS_M * Math.tan(((latDeg + 90.0) * 0.5) * DEG);
  const lam = normalizeLon(lonEastDeg) * DEG;
  const xM = rM * Math.sin(lam);
  const yM = rM * Math.cos(lam);

  const colF = clamp(xM / POLAR_MAP_SCALE_M + POLAR_PROJ_OFFSET, 0, polarWidth - 1.0001);
  const rowF = clamp(-yM / POLAR_MAP_SCALE_M + POLAR_PROJ_OFFSET, 0, polarWidth - 1.0001);

  const c0 = Math.floor(colF);
  const r0 = Math.floor(rowF);
  const c1 = Math.min(polarWidth - 1, c0 + 1);
  const r1 = Math.min(polarWidth - 1, r0 + 1);
  const fc = colF - c0;
  const fr = rowF - r0;

  const h00 = polarHeightKm[r0 * polarWidth + c0];
  const h10 = polarHeightKm[r0 * polarWidth + c1];
  const h01 = polarHeightKm[r1 * polarWidth + c0];
  const h11 = polarHeightKm[r1 * polarWidth + c1];

  return (h00 * (1 - fc) + h10 * fc) * (1 - fr) + (h01 * (1 - fc) + h11 * fc) * fr;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

function sampleGlobalEquirectKmBicubic(
  heightKm: Float32Array,
  w: number,
  h: number,
  latDeg: number,
  lonEastDeg: number,
): number {
  const { u, v } = latLonToNasaSvsUv(latDeg, lonEastDeg);
  const pxF = u * w - 0.5;
  const pyF = (1 - v) * (h - 1);

  const pxBase = Math.floor(pxF);
  const pyBase = Math.floor(pyF);
  const fx = pxF - pxBase;
  const fy = pyF - pyBase;

  const xIdx = [
    ((pxBase - 1) % w + w) % w,
    ((pxBase % w) + w) % w,
    ((pxBase + 1) % w + w) % w,
    ((pxBase + 2) % w + w) % w,
  ];
  const yIdx = [
    clamp(pyBase - 1, 0, h - 1),
    clamp(pyBase, 0, h - 1),
    clamp(pyBase + 1, 0, h - 1),
    clamp(pyBase + 2, 0, h - 1),
  ];

  const rowVals = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    const rOff = yIdx[j] * w;
    rowVals[j] = catmullRom(
      heightKm[rOff + xIdx[0]],
      heightKm[rOff + xIdx[1]],
      heightKm[rOff + xIdx[2]],
      heightKm[rOff + xIdx[3]],
      fx,
    );
  }
  return catmullRom(rowVals[0], rowVals[1], rowVals[2], rowVals[3], fy);
}

function sampleGlobalEquirectKmBilinear(
  heightKm: Float32Array,
  w: number,
  h: number,
  latDeg: number,
  lonEastDeg: number,
): number {
  const { u, v } = latLonToNasaSvsUv(latDeg, lonEastDeg);
  const pxF = u * w - 0.5;
  const pyF = (1 - v) * (h - 1);

  const px0 = ((Math.floor(pxF) % w) + w) % w;
  const px1 = (px0 + 1) % w;
  const py0 = Math.max(0, Math.min(h - 1, Math.floor(pyF)));
  const py1 = Math.max(0, Math.min(h - 1, py0 + 1));

  const fx = pxF - Math.floor(pxF);
  const fy = pyF - py0;

  const h00 = heightKm[py0 * w + px0];
  const h10 = heightKm[py0 * w + px1];
  const h01 = heightKm[py1 * w + px0];
  const h11 = heightKm[py1 * w + px1];

  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

function sampleRgbaBilinearBottomSouth(
  rgba: Uint8Array,
  w: number,
  h: number,
  latDeg: number,
  lonEastDeg: number,
): [number, number, number] {
  const { u, v } = latLonToNasaSvsUv(latDeg, lonEastDeg);
  const pxF = u * w - 0.5;
  const pyF = clamp(v * (h - 1), 0, h - 1);

  const px0 = ((Math.floor(pxF) % w) + w) % w;
  const px1 = (px0 + 1) % w;
  const py0 = Math.max(0, Math.min(h - 1, Math.floor(pyF)));
  const py1 = Math.max(0, Math.min(h - 1, py0 + 1));

  const fx = pxF - Math.floor(pxF);
  const fy = pyF - py0;

  const i00 = (py0 * w + px0) * 4;
  const i10 = (py0 * w + px1) * 4;
  const i01 = (py1 * w + px0) * 4;
  const i11 = (py1 * w + px1) * 4;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  return [
    Math.round(rgba[i00] * w00 + rgba[i10] * w10 + rgba[i01] * w01 + rgba[i11] * w11),
    Math.round(rgba[i00 + 1] * w00 + rgba[i10 + 1] * w10 + rgba[i01 + 1] * w01 + rgba[i11 + 1] * w11),
    Math.round(rgba[i00 + 2] * w00 + rgba[i10 + 2] * w10 + rgba[i01 + 2] * w01 + rgba[i11 + 2] * w11),
  ];
}

/**
 * Sample elevation in km from atlas, fusing the genuine LRO LOLA 80m-derived polar stereographic patch
 * cleanly inside the valid 80°S–90°S disk with the global LOLA DEM everywhere else.
 */
export function sampleAtlasElevationKmBilinear(
  atlas: LunarAtlasData,
  latDeg: number,
  lonEastDeg: number,
): number {
  const globalKm = sampleGlobalEquirectKmBilinear(
    atlas.heightKm,
    atlas.width,
    atlas.height,
    latDeg,
    lonEastDeg,
  );
  if (atlas.polarHeightKm && latDeg <= -80.1) {
    const polarKm = samplePolarPatchKmBilinear(
      atlas.polarHeightKm,
      atlas.polarWidth,
      clamp(latDeg, -90, -80.05),
      lonEastDeg,
    );
    const blend = smoothstep(-80.1, -81.4, latDeg);
    return globalKm * (1 - blend) + polarKm * blend;
  }
  return globalKm;
}

/**
 * Builds crisp isotropic Polar Stereographic Albedo, Topography, and physical-unit 3x3 Sobel Normal maps
 * covering ±62.8° .. ±90° with ZERO cos(lat) stretching, radial spoke artifacts, or polar pinwheel swirl.
 */
function buildPolarCapTextures(params: {
  capWidth: number;
  southPole: boolean;
  globalWidth: number;
  globalHeight: number;
  globalHeightKmTopNorth: Float32Array;
  globalAlbedoBottomSouth: Uint8Array;
  hasRealAlbedo: boolean;
  polarHeightKm: Float32Array | null;
  polarWidth: number;
}): {
  albedoRgba: Uint8Array;
  topoRgba: Uint8Array;
  normalRgba: Uint8Array;
} {
  const {
    capWidth,
    southPole,
    globalWidth,
    globalHeight,
    globalHeightKmTopNorth,
    globalAlbedoBottomSouth,
    hasRealAlbedo,
    polarHeightKm,
    polarWidth,
  } = params;

  const count = capWidth * capWidth;
  const hGrid = new Float32Array(count);
  const latGrid = new Float32Array(count);
  const albedoRgba = new Uint8Array(count * 4);
  const topoRgba = new Uint8Array(count * 4);
  const normalRgba = new Uint8Array(count * 4);

  const halfSpan = POLAR_CAP_OUTER_SPAN * 0.5;
  const stereoRatio = POLAR_CAP_OUTER_SPAN / POLAR_STEREO_SPAN;

  // 1. Populate isotropic stereographic height field & base regional albedo
  for (let row = 0; row < capWidth; row++) {
    const v = (row + 0.5) / capWidth;
    for (let col = 0; col < capWidth; col++) {
      const u = (col + 0.5) / capWidth;
      const idx = row * capWidth + col;
      const dir = polarStereoUvToSphereUnit(u, v, southPole, POLAR_CAP_OUTER_SPAN);
      const { latDeg, lonEastDeg } = sphereUnitToLatLon(dir.x, dir.y, dir.z);
      latGrid[idx] = latDeg;

      let elevKm =
        globalWidth >= 512
          ? sampleGlobalEquirectKmBicubic(
              globalHeightKmTopNorth,
              globalWidth,
              globalHeight,
              latDeg,
              lonEastDeg,
            )
          : sampleGlobalEquirectKmBilinear(
              globalHeightKmTopNorth,
              globalWidth,
              globalHeight,
              latDeg,
              lonEastDeg,
            );

      if (southPole && polarHeightKm && latDeg <= -79.7) {
        // Direct stereographic coordinate transform into 1024x1024 LDEM_80S_80M (0% distortion)
        const uCore = 0.5 + (u - 0.5) * stereoRatio;
        const vCore = 0.5 + (v - 0.5) * stereoRatio;
        const cF = clamp(uCore * polarWidth - 0.5, 0, polarWidth - 1.0001);
        const rF = clamp(vCore * polarWidth - 0.5, 0, polarWidth - 1.0001);
        const c0 = Math.floor(cF);
        const r0 = Math.floor(rF);
        const c1 = Math.min(polarWidth - 1, c0 + 1);
        const r1 = Math.min(polarWidth - 1, r0 + 1);
        const fc = cF - c0;
        const fr = rF - r0;
        const p00 = polarHeightKm[r0 * polarWidth + c0];
        const p10 = polarHeightKm[r0 * polarWidth + c1];
        const p01 = polarHeightKm[r1 * polarWidth + c0];
        const p11 = polarHeightKm[r1 * polarWidth + c1];
        const nativeKm = (p00 * (1 - fc) + p10 * fc) * (1 - fr) + (p01 * (1 - fc) + p11 * fc) * fr;
        const wInDisk = smoothstep(-79.7, -80.9, latDeg);
        elevKm = elevKm * (1 - wInDisk) + nativeKm * wInDisk;
      }

      hGrid[idx] = elevKm;

      const [ar, ag, ab] = sampleRgbaBilinearBottomSouth(
        globalAlbedoBottomSouth,
        globalWidth,
        globalHeight,
        latDeg,
        lonEastDeg,
      );
      const p = idx * 4;
      // Softly normalize polar LROC brightness where equirectangular mosaic blurs near ±80°..±90°
      if (hasRealAlbedo && Math.abs(latDeg) > 76) {
        const wPolarNorm = smoothstep(76, 84, Math.abs(latDeg)) * 0.45;
        const baseLum = 136;
        albedoRgba[p] = Math.round(ar * (1 - wPolarNorm) + baseLum * wPolarNorm);
        albedoRgba[p + 1] = Math.round(ag * (1 - wPolarNorm) + baseLum * wPolarNorm);
        albedoRgba[p + 2] = Math.round(ab * (1 - wPolarNorm) + (baseLum + 1) * wPolarNorm);
      } else {
        albedoRgba[p] = ar;
        albedoRgba[p + 1] = ag;
        albedoRgba[p + 2] = ab;
      }
      albedoRgba[p + 3] = 255;
    }
  }

  // Exact metric spacing on the stereographic plane: ds/du * (2 R_moon / (1 + r^2)) / capWidth
  const basePlaneKm = (POLAR_CAP_OUTER_SPAN * 2.0 * (LUNAR_REF_RADIUS_M / 1000)) / capWidth;

  // 2. Physical-unit 3x3 Sobel normal & omnidirectional multi-scale LOLA micro-contrast
  for (let row = 0; row < capWidth; row++) {
    const rUp = Math.max(0, row - 1);
    const rDn = Math.min(capWidth - 1, row + 1);
    const rUp3 = Math.max(0, row - 3);
    const rDn3 = Math.min(capWidth - 1, row + 3);
    const ys = halfSpan - ((row + 0.5) / capWidth) * POLAR_CAP_OUTER_SPAN;

    for (let col = 0; col < capWidth; col++) {
      const cL = Math.max(0, col - 1);
      const cR = Math.min(capWidth - 1, col + 1);
      const cL3 = Math.max(0, col - 3);
      const cR3 = Math.min(capWidth - 1, col + 3);
      const xs = ((col + 0.5) / capWidth) * POLAR_CAP_OUTER_SPAN - halfSpan;

      const idx = row * capWidth + col;
      const pIdx = idx * 4;

      // Exact conformal scale factor at (xs, ys): 1 / (1 + xs^2 + ys^2)
      const cellKm = basePlaneKm / (1.0 + xs * xs + ys * ys);
      const absLat = Math.abs(latGrid[idx]);
      // Smooth gain transition matching global (2.05x) outside 80° and crisp (1.42x) inside 80m LOLA core
      const slopeMult =
        southPole && polarHeightKm ? 2.05 - 0.63 * smoothstep(79.5, 81.2, absLat) : 2.05;
      const reliefGain = slopeMult / Math.max(0.25, cellKm);

      const hTL = hGrid[rUp * capWidth + cL];
      const hT = hGrid[rUp * capWidth + col];
      const hTR = hGrid[rUp * capWidth + cR];
      const hL = hGrid[row * capWidth + cL];
      const hC = hGrid[idx];
      const hR = hGrid[row * capWidth + cR];
      const hBL = hGrid[rDn * capWidth + cL];
      const hB = hGrid[rDn * capWidth + col];
      const hBR = hGrid[rDn * capWidth + cR];

      // 3x3 Sobel wrt (+col, +row)
      const dH_dCol = (hTR + 2 * hR + hBR - (hTL + 2 * hL + hBL)) * 0.125;
      const dH_dRow = (hBL + 2 * hB + hBR - (hTL + 2 * hT + hTR)) * 0.125;

      let nx = -dH_dCol * reliefGain;
      let ny = -dH_dRow * reliefGain;
      let nz = 1.0;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      normalRgba[pIdx] = clamp(Math.round((nx * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 1] = clamp(Math.round((ny * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 2] = clamp(Math.round((nz * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 3] = 255;

      // Omnidirectional 1-px + 3-px LOLA rim & crater cavity micro-albedo (zero directional shadow bias)
      const avg1 = (hTL + hT + hTR + hL + hR + hBL + hB + hBR) * 0.125;
      const avg3 =
        (hGrid[rUp3 * capWidth + col] +
          hGrid[rDn3 * capWidth + col] +
          hGrid[row * capWidth + cL3] +
          hGrid[row * capWidth + cR3]) *
        0.25;
      const detailKm = (hC - avg1) * 0.65 + (hC - avg3) * 0.35;

      if (hasRealAlbedo) {
        const wDetail = smoothstep(74, 81, absLat);
        const microContrast = clamp(1.0 + detailKm * (0.04 + 0.16 * wDetail), 0.84, 1.18);
        albedoRgba[pIdx] = clamp(Math.round(albedoRgba[pIdx] * microContrast), 12, 246);
        albedoRgba[pIdx + 1] = clamp(Math.round(albedoRgba[pIdx + 1] * microContrast), 12, 246);
        albedoRgba[pIdx + 2] = clamp(Math.round(albedoRgba[pIdx + 2] * microContrast), 12, 246);
      }

      const [tr, tg, tb] = elevationToTopoRgb(hC);
      const topoShade = clamp(0.96 + detailKm * 0.12, 0.86, 1.1);
      topoRgba[pIdx] = clamp(Math.round(tr * topoShade), 0, 255);
      topoRgba[pIdx + 1] = clamp(Math.round(tg * topoShade), 0, 255);
      topoRgba[pIdx + 2] = clamp(Math.round(tb * topoShade), 0, 255);
      topoRgba[pIdx + 3] = 255;
    }
  }

  return { albedoRgba, topoRgba, normalRgba };
}

/**
 * Populate derived global topography RGBA, physical-unit 3x3 Sobel normal map RGBA, packed height RGBA,
 * and dedicated extended North & South Polar Stereographic caps.
 */
function buildDerivedAtlasMaps(
  width: number,
  height: number,
  heightKmTopNorth: Float32Array,
  polarWidth: number,
  polarHeightKm: Float32Array | null,
  albedoBottomSouth?: Uint8Array,
): {
  heightKmBottomSouth: Float32Array;
  albedoRgba: Uint8Array;
  topoRgba: Uint8Array;
  normalRgba: Uint8Array;
  dispRgba: Uint8Array;
  southCapWidth: number;
  southCapAlbedoRgba: Uint8Array;
  southCapTopoRgba: Uint8Array;
  southCapNormalRgba: Uint8Array;
  northCapWidth: number;
  northCapAlbedoRgba: Uint8Array;
  northCapTopoRgba: Uint8Array;
  northCapNormalRgba: Uint8Array;
} {
  const count = width * height;
  const heightKmBottomSouth = new Float32Array(count);
  const topoRgba = new Uint8Array(count * 4);
  const normalRgba = new Uint8Array(count * 4);
  const dispRgba = new Uint8Array(count * 4);
  const hasRealAlbedo = Boolean(albedoBottomSouth);
  const albedoRgba = albedoBottomSouth ?? new Uint8Array(count * 4);

  // Build unified heightKmBottomSouth (py=0 -> -90°, py=height-1 -> +90°, u=0 -> -180°, u=0.5 -> 0°)
  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const latDeg = v * 180 - 90;
    const srcRow = Math.max(0, Math.min(height - 1, Math.round((1 - v) * (height - 1))));

    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / width;
      const lonEastDeg = normalizeLon(u * 360 - 180);
      let elevKm = heightKmTopNorth[srcRow * width + px];

      if (polarHeightKm && latDeg <= -80.1) {
        const polarKm = samplePolarPatchKmBilinear(
          polarHeightKm,
          polarWidth,
          clamp(latDeg, -90, -80.05),
          lonEastDeg,
        );
        const wBlend = smoothstep(-80.1, -81.4, latDeg);
        elevKm = elevKm * (1 - wBlend) + polarKm * wBlend;
      }
      heightKmBottomSouth[py * width + px] = elevKm;
    }
  }

  // Global physical-unit 3x3 Sobel normal map (true rise/run km/km scaled consistently at 2.05x)
  const eqCellKm = (Math.PI * (LUNAR_REF_RADIUS_M / 1000)) / height;
  for (let py = 0; py < height; py++) {
    const v = (py + 0.5) / height;
    const latDeg = v * 180 - 90;
    const cosLat = Math.max(0.45, Math.cos(latDeg * DEG));
    const pyUp = Math.min(height - 1, py + 1);
    const pyDn = Math.max(0, py - 1);

    for (let px = 0; px < width; px++) {
      const pxL = (px - 1 + width) % width;
      const pxR = (px + 1) % width;
      const idx = py * width + px;
      const pIdx = idx * 4;

      const hTL = heightKmBottomSouth[pyUp * width + pxL];
      const hT = heightKmBottomSouth[pyUp * width + px];
      const hTR = heightKmBottomSouth[pyUp * width + pxR];
      const hL = heightKmBottomSouth[py * width + pxL];
      const hC = heightKmBottomSouth[idx];
      const hR = heightKmBottomSouth[py * width + pxR];
      const hBL = heightKmBottomSouth[pyDn * width + pxL];
      const hB = heightKmBottomSouth[pyDn * width + px];
      const hBR = heightKmBottomSouth[pyDn * width + pxR];

      // Exact 3x3 Sobel derivative (* 0.125) wrt (+East px, +North py)
      const dH_dPx = (hTR + 2 * hR + hBR - (hTL + 2 * hL + hBL)) * 0.125;
      const dH_dPy = (hTL + 2 * hT + hTR - (hBL + 2 * hB + hBR)) * 0.125;

      const dxSlope = (dH_dPx / (eqCellKm * cosLat)) * 2.05;
      const dySlope = (dH_dPy / eqCellKm) * 2.05;
      let nx = -dxSlope;
      let ny = -dySlope;
      let nz = 1.0;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      normalRgba[pIdx] = clamp(Math.round((nx * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 1] = clamp(Math.round((ny * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 2] = clamp(Math.round((nz * 0.5 + 0.5) * 255), 0, 255);
      normalRgba[pIdx + 3] = 255;

      const dispNorm = clamp((hC - MIN_ELEV_KM) / (MAX_ELEV_KM - MIN_ELEV_KM), 0, 1);
      const disp16 = Math.round(dispNorm * 65535);
      dispRgba[pIdx] = (disp16 >> 8) & 0xff;
      dispRgba[pIdx + 1] = disp16 & 0xff;
      dispRgba[pIdx + 2] = (disp16 >> 8) & 0xff;
      dispRgba[pIdx + 3] = 255;

      const avgN = (hTL + hT + hTR + hL + hR + hBL + hB + hBR) * 0.125;
      const [tr, tg, tb] = elevationToTopoRgb(hC);
      const shade = clamp(0.96 + (hC - avgN) * 0.08, 0.88, 1.08);
      topoRgba[pIdx] = clamp(Math.round(tr * shade), 0, 255);
      topoRgba[pIdx + 1] = clamp(Math.round(tg * shade), 0, 255);
      topoRgba[pIdx + 2] = clamp(Math.round(tb * shade), 0, 255);
      topoRgba[pIdx + 3] = 255;

      if (!hasRealAlbedo) {
        const lum = clamp(Math.round(138 + hC * 7.5 + nx * 10), 45, 225);
        albedoRgba[pIdx] = lum;
        albedoRgba[pIdx + 1] = lum;
        albedoRgba[pIdx + 2] = lum + 2;
        albedoRgba[pIdx + 3] = 255;
      } else {
        // Subtle omnidirectional LOLA rim micro-clarity across the whole Moon
        const microAlb = clamp(1.0 + (hC - avgN) * 0.035, 0.92, 1.08);
        albedoRgba[pIdx] = clamp(Math.round(albedoRgba[pIdx] * microAlb), 10, 248);
        albedoRgba[pIdx + 1] = clamp(Math.round(albedoRgba[pIdx + 1] * microAlb), 10, 248);
        albedoRgba[pIdx + 2] = clamp(Math.round(albedoRgba[pIdx + 2] * microAlb), 10, 248);
      }
    }
  }

  const southCapWidth = polarHeightKm ? 2048 : Math.max(64, Math.min(128, height));
  const northCapWidth = polarHeightKm ? 1024 : Math.max(64, Math.min(128, height));

  const southCap = buildPolarCapTextures({
    capWidth: southCapWidth,
    southPole: true,
    globalWidth: width,
    globalHeight: height,
    globalHeightKmTopNorth: heightKmTopNorth,
    globalAlbedoBottomSouth: albedoRgba,
    hasRealAlbedo,
    polarHeightKm,
    polarWidth,
  });

  const northCap = buildPolarCapTextures({
    capWidth: northCapWidth,
    southPole: false,
    globalWidth: width,
    globalHeight: height,
    globalHeightKmTopNorth: heightKmTopNorth,
    globalAlbedoBottomSouth: albedoRgba,
    hasRealAlbedo,
    polarHeightKm: null,
    polarWidth,
  });

  return {
    heightKmBottomSouth,
    albedoRgba,
    topoRgba,
    normalRgba,
    dispRgba,
    southCapWidth,
    southCapAlbedoRgba: southCap.albedoRgba,
    southCapTopoRgba: southCap.topoRgba,
    southCapNormalRgba: southCap.normalRgba,
    northCapWidth,
    northCapAlbedoRgba: northCap.albedoRgba,
    northCapTopoRgba: northCap.topoRgba,
    northCapNormalRgba: northCap.normalRgba,
  };
}

/**
 * Fast synchronous baseline atlas anchored on real LOLA landing site elevations.
 * Used in headless JSDOM unit tests and as the instantaneous placeholder before NASA 2K textures decode.
 */
export function buildLunarAtlasData(
  sites: LandingSiteEntry[] = [],
  width = 256,
  height = 128,
): LunarAtlasData {
  const count = width * height;
  const heightKmTopNorth = new Float32Array(count);

  for (const site of sites) {
    const sLat = site.center.latitude_deg;
    const sLon = site.center.longitude_east_deg;
    const elevKm = clamp(site.center.elevation_m / 1000, -7, 8);
    const { u, v } = latLonToNasaSvsUv(sLat, sLon);
    const cx = Math.floor(u * width) % width;
    const cy = Math.max(0, Math.min(height - 1, Math.floor((1 - v) * height)));
    for (let dy = -2; dy <= 2; dy++) {
      const py = clamp(cy + dy, 0, height - 1);
      for (let dx = -3; dx <= 3; dx++) {
        const px = ((cx + dx) % width + width) % width;
        const w = Math.exp(-(dx * dx + dy * dy) / 3.5);
        heightKmTopNorth[py * width + px] =
          heightKmTopNorth[py * width + px] * (1 - w) + elevKm * w;
      }
    }
  }

  const derived = buildDerivedAtlasMaps(width, height, heightKmTopNorth, POLAR_PATCH_SIZE, null);
  return {
    width,
    height,
    isRealNasa: false,
    heightKm: heightKmTopNorth,
    polarWidth: POLAR_PATCH_SIZE,
    polarHeightKm: null,
    albedoRgba: derived.albedoRgba,
    topoRgba: derived.topoRgba,
    normalRgba: derived.normalRgba,
    dispRgba: derived.dispRgba,
    southCapWidth: derived.southCapWidth,
    southCapAlbedoRgba: derived.southCapAlbedoRgba,
    southCapTopoRgba: derived.southCapTopoRgba,
    southCapNormalRgba: derived.southCapNormalRgba,
    northCapWidth: derived.northCapWidth,
    northCapAlbedoRgba: derived.northCapAlbedoRgba,
    northCapTopoRgba: derived.northCapTopoRgba,
    northCapNormalRgba: derived.northCapNormalRgba,
  };
}

/** Decoded RGBA pixels of one bundled image. */
export interface DecodedImagePixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const REAL_ATLAS_URLS = [
  '/assets/lunar/lroc_color_2k.jpg',
  '/assets/lunar/ldem_global_2k.png',
  '/assets/lunar/ldem_south_pole_1k.png',
] as const;

function loadImagePixels(url: string): Promise<DecodedImagePixels> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error(`Could not allocate 2D canvas context for ${url}`));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      resolve({ width: w, height: h, data: imageData.data });
    };
    img.onerror = () => reject(new Error(`Failed to load NASA lunar asset: ${url}`));
    img.src = url;
  });
}

function decodePackedElevationKm(rgba: Uint8ClampedArray, len: number): Float32Array {
  const out = new Float32Array(len);
  const range = MAX_ELEV_KM - MIN_ELEV_KM;
  for (let i = 0; i < len; i++) {
    const p = i * 4;
    const q16 = (rgba[p] << 8) | rgba[p + 1];
    out[i] = MIN_ELEV_KM + (q16 / 65535) * range;
  }
  return out;
}

/** Derives the real NASA atlas from decoded pixels, shared by the main thread and the atlas worker. */
export function deriveRealNasaAtlas(
  albedoImg: DecodedImagePixels,
  globalDemImg: DecodedImagePixels,
  polarDemImg: DecodedImagePixels,
): LunarAtlasData {
  const w = globalDemImg.width;
  const h = globalDemImg.height;
  const heightKmTopNorth = decodePackedElevationKm(globalDemImg.data, w * h);
  const polarHeightKm = decodePackedElevationKm(
    polarDemImg.data,
    polarDemImg.width * polarDemImg.height,
  );

  const albedoBottomSouth = new Uint8Array(w * h * 4);
  for (let py = 0; py < h; py++) {
    const srcY = Math.min(
      albedoImg.height - 1,
      Math.max(0, Math.round(((h - 1 - py) / (h - 1)) * (albedoImg.height - 1))),
    );
    for (let px = 0; px < w; px++) {
      const srcX = Math.min(
        albedoImg.width - 1,
        Math.round((px / w) * albedoImg.width),
      );
      const sIdx = (srcY * albedoImg.width + srcX) * 4;
      const dIdx = (py * w + px) * 4;
      albedoBottomSouth[dIdx] = albedoImg.data[sIdx];
      albedoBottomSouth[dIdx + 1] = albedoImg.data[sIdx + 1];
      albedoBottomSouth[dIdx + 2] = albedoImg.data[sIdx + 2];
      albedoBottomSouth[dIdx + 3] = 255;
    }
  }

  const derived = buildDerivedAtlasMaps(
    w,
    h,
    heightKmTopNorth,
    polarDemImg.width,
    polarHeightKm,
    albedoBottomSouth,
  );

  return {
    width: w,
    height: h,
    isRealNasa: true,
    heightKm: heightKmTopNorth,
    polarWidth: polarDemImg.width,
    polarHeightKm,
    albedoRgba: derived.albedoRgba,
    topoRgba: derived.topoRgba,
    normalRgba: derived.normalRgba,
    dispRgba: derived.dispRgba,
    southCapWidth: derived.southCapWidth,
    southCapAlbedoRgba: derived.southCapAlbedoRgba,
    southCapTopoRgba: derived.southCapTopoRgba,
    southCapNormalRgba: derived.southCapNormalRgba,
    northCapWidth: derived.northCapWidth,
    northCapAlbedoRgba: derived.northCapAlbedoRgba,
    northCapTopoRgba: derived.northCapTopoRgba,
    northCapNormalRgba: derived.northCapNormalRgba,
  };
}

/** Distinct buffers backing an atlas, for transferring it out of a worker without copies. */
export function atlasTransferables(atlas: LunarAtlasData): ArrayBuffer[] {
  const arrays = [
    atlas.heightKm,
    atlas.polarHeightKm,
    atlas.albedoRgba,
    atlas.topoRgba,
    atlas.normalRgba,
    atlas.dispRgba,
    atlas.southCapAlbedoRgba,
    atlas.southCapTopoRgba,
    atlas.southCapNormalRgba,
    atlas.northCapAlbedoRgba,
    atlas.northCapTopoRgba,
    atlas.northCapNormalRgba,
  ];
  const buffers = new Set<ArrayBuffer>();
  for (const array of arrays) {
    if (array) buffers.add(array.buffer as ArrayBuffer);
  }
  return [...buffers];
}

/** Decodes and derives the atlas on the calling thread, the original path and the worker fallback. */
export function loadRealNasaLunarAtlasOnMainThread(): Promise<LunarAtlasData> {
  return Promise.all(REAL_ATLAS_URLS.map(loadImagePixels)).then(([albedoImg, globalDemImg, polarDemImg]) =>
    deriveRealNasaAtlas(albedoImg, globalDemImg, polarDemImg),
  );
}

/** Decodes and derives the atlas in a module worker so the page stays responsive meanwhile. */
export function loadRealNasaLunarAtlasInWorker(): Promise<LunarAtlasData> {
  if (
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined' ||
    typeof createImageBitmap === 'undefined'
  ) {
    return Promise.reject(new Error('Worker image decoding is unavailable'));
  }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./atlasWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    worker.onmessage = (event: MessageEvent<{ atlas?: LunarAtlasData; error?: string }>) => {
      worker.terminate();
      if (event.data.atlas) resolve(event.data.atlas);
      else reject(new Error(event.data.error ?? 'Atlas worker failed'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Atlas worker failed'));
    };
    worker.postMessage({ urls: REAL_ATLAS_URLS.map((url) => new URL(url, window.location.href).href) });
  });
}

let cachedRealAtlasPromise: Promise<LunarAtlasData> | null = null;
let cachedRealAtlasSync: LunarAtlasData | null = null;

export function getLoadedRealAtlasSync(): LunarAtlasData | null {
  return cachedRealAtlasSync;
}

/**
 * Loads official bundled NASA LRO WAC & LRO LOLA elevation assets:
 *   - /assets/lunar/lroc_color_2k.jpg (NASA SVS CGI Moon Kit 2048x1024 LROC global mosaic)
 *   - /assets/lunar/ldem_global_2k.png (NASA LRO LOLA 16-px/deg global DEM, packed 2048x1024)
 *   - /assets/lunar/ldem_south_pole_1k.png (NASA PDS LOLA LDEM_80S_80M polar stereographic 80°S-90°S)
 */
export function loadRealNasaLunarAtlas(): Promise<LunarAtlasData> {
  if (cachedRealAtlasPromise) return cachedRealAtlasPromise;
  // A failed load clears the shared cache so a later mount (orbital or astronaut) can retry.
  const job: Promise<LunarAtlasData> = loadRealNasaLunarAtlasInWorker()
    .catch(() => loadRealNasaLunarAtlasOnMainThread())
    .then(
      (atlas) => {
        if (cachedRealAtlasPromise === job) cachedRealAtlasSync = atlas;
        return atlas;
      },
      (error: unknown) => {
        if (cachedRealAtlasPromise === job) cachedRealAtlasPromise = null;
        throw error;
      },
    );
  cachedRealAtlasPromise = job;
  return job;
}

/** Starts the atlas early when it can be built off the main thread, so startup is not blocked. */
export function prefetchRealNasaLunarAtlas(): void {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
  loadRealNasaLunarAtlas().catch(() => undefined);
}
