import * as THREE from 'three';
import { applyUV, beam, chamferBox, hull, mergeAll, V, type UVMapper } from './propsGeometry';
import type { CrateStyle } from './propsTextures';

/**
 * Cargo containers / crates. Each style is one geometry whose faces map into a single atlas
 * texture (see propsKitPaint.ts for the atlas layout) so a whole family renders as one
 * InstancedMesh. Local origin: centre of the bottom face; long axis along +X.
 *
 * The relief is real geometry (bevelled corner pillars standing proud of the faces and rising above
 * the rim, stepped stripe channels, framed recessed panels, raised top rim and deck with long
 * handle bars, base skid). UVs are a box projection by face normal:
 * every face samples the atlas at its own (x, y) / (z, y) / (x, z) position, so the painter
 * paints a flat 2D layout computed from the same `containerLayout` / `moduleLayout` numbers.
 */

export interface CrateSpec {
  w: number;
  h: number;
  d: number;
  chamfer: number;
  /** 'container' = hazard family (white or dark); 'module' = white row module with square panels. */
  kind?: 'container' | 'module';
  /** Kept for compatibility; unused by the current builders. */
  post?: { size: number; protrude: number };
  /** Corner pillars rise `t` above the core top: crates stack at `h + t`. */
  lid?: { inset: number; t: number };
  /** Plain colour used when canvas textures are unavailable. */
  fallbackColor: number;
  roughness: number;
  metalness: number;
}

/**
 * Sizes measured on the reference frames against the 1.7 m eye height and the horizon (t18.5:
 * ground tanks ≈ 1.75 m; t41.5/t43: row modules ≈ 0.6 × tank height). Hazard containers, round 4:
 * at full resolution in t18.5 the front container's pillar tops stand ≈ 1.0–1.13 m over a labelled
 * face ≈ 1.7–2.06 m long once perspective is undone (vanishing points of its top / bottom edges),
 * i.e. height / length ≈ 0.55–0.6, and its faces read 0.58 (t18.5) – 0.69 (t15) on screen; the
 * round-3 box (1.17 / 2.35 = 0.5) read low and long. Now 1.21 / 1.9 ≈ 0.64.
 */
export const CRATE_SPECS: Record<CrateStyle, CrateSpec> = {
  // dirty-white hazard containers next to the ship (t12–t18.5)
  hazard: { kind: 'container', w: 1.9, h: 1.14, d: 1.3, chamfer: 0.05, lid: { inset: 0.42, t: 0.07 }, fallbackColor: 0xd2cac6, roughness: 0.6, metalness: 0.02 },
  // white modular containers with dark diagonal panels (t41.5/t43 row, greenhouse ring)
  row: { kind: 'module', w: 2.4, h: 1.05, d: 1.1, chamfer: 0.09, fallbackColor: 0xd6d5d2, roughness: 0.55, metalness: 0.04 },
  // charcoal crates of the same family with worn white edges and ochre stripes (t01, f_041)
  dark: { kind: 'container', w: 2.4, h: 1.13, d: 1.35, chamfer: 0.05, lid: { inset: 0.42, t: 0.07 }, fallbackColor: 0x26272a, roughness: 0.5, metalness: 0.12 },
};

// ---------------------------------------------------------------------------------------------
// layouts (metres). Face coordinates: front x ∈ [-w/2, w/2], end z ∈ [-d/2, d/2], y up from 0.

export interface ContainerLayout {
  w: number;
  h: number;
  d: number;
  /** Total height = top of the corner pillars (texture t = y / H). */
  H: number;
  /** Corner pillar size on each face, the 45° bevel of its outer vertical edge, its top bevel. */
  cb: number;
  cc: number;
  ct: number;
  /** Width of the stripe channel next to each pillar (front faces) and its depth behind the pillar face. */
  sc: number;
  scD: number;
  /** Plate plane inset from the outer envelope (= pillar protrusion), and recess depth behind the plates. */
  pi: number;
  rd: number;
  /** Pillar rise above the core top (= spec lid.t), top of the raised rim, top of the inner deck. */
  rim: number;
  rimTop: number;
  deckTop: number;
  rimW: number;
  base: number;
  /** Front main face half width (between the stripe channels). */
  m: number;
  /** Lower recessed panel on the front faces. */
  win: { x: number; y0: number; y1: number };
  /** Warning label rectangle on the front faces. */
  label: { x: number; y0: number; y1: number };
  /** End main face half width (between corner blocks) and its recessed window. */
  endM: number;
  endWin: { z: number; y0: number; y1: number };
  /** Diagonal bar width in the end window. */
  bar: number;
  /** Handle bar on the top, parallel to each long rim. */
  handle: { x: number; z0: number; z1: number };
  /** Raised lid plate on top (dark crates); `t` = its top above the core top. */
  lid: { x: number; z: number; t: number } | null;
}

export function containerLayout(spec: CrateSpec, style: CrateStyle): ContainerLayout {
  const { w, h, d } = spec;
  const rim = spec.lid?.t ?? 0.07;
  // measured on t18.5: corner pillar ≈ 12–13 % of the length, stripe channel ≈ 6–7 %, main face ≈
  // 60 %; the pillars stand proud of the face plates and rise above the rim (stacking posts). Capped
  // at the round-3 sizes, so the 2.4 m dark crates keep their look.
  const cb = Math.min(0.27, 0.13 * w);
  const sc = Math.min(0.14, 0.07 * w);
  const pi = 0.06;
  const base = 0.05;
  const m = w / 2 - cb - sc;
  const endM = d / 2 - cb;
  const rimW = 0.1;
  const inner = d / 2 - pi - rimW;
  return {
    w,
    h,
    d,
    H: h + rim,
    cb,
    cc: 0.085,
    ct: 0.024,
    sc,
    scD: 0.026,
    pi,
    rd: 0.032,
    rim,
    rimTop: h + rim * 0.45,
    deckTop: h + rim * 0.28,
    rimW,
    base,
    m,
    win: { x: m * 0.76, y0: h * 0.15, y1: h * 0.48 },
    label: { x: Math.min(0.34, m * 0.45), y0: h * 0.55, y1: h * 0.85 },
    endM,
    endWin: { z: endM - 0.05, y0: base + 0.1, y1: h - 0.11 },
    bar: 0.075,
    // long handle bar in a wide dark slot along each long rim (t18.5 top)
    handle: { x: Math.min(0.46, m * 0.6), z0: inner - 0.14, z1: inner - 0.095 },
    lid: style === 'dark' ? { x: w / 2 - cb - 0.1, z: inner - 0.2, t: rim * 0.72 } : null,
  };
}

export interface ModuleLayout {
  w: number;
  h: number;
  d: number;
  H: number;
  c: number;
  /** Recess depth of the panels (plates protrude this much in front of the core). */
  rd: number;
  /** Square panel size, panel centres along x, and the panel bottom. */
  ps: number;
  px: number[];
  py0: number;
  /** End faces: two vertical slots. */
  slotZ: number[];
  slotW: number;
  slotY0: number;
  slotY1: number;
  bar: number;
}

export function moduleLayout(spec: CrateSpec): ModuleLayout {
  const { w, h, d } = spec;
  const ps = Math.min(0.6, h * 0.58);
  const gap = (w - 3 * ps) / 4;
  const px = [-1, 0, 1].map((k) => k * (ps + gap));
  const py0 = (h - ps) * 0.45;
  return {
    w,
    h,
    d,
    H: h,
    c: spec.chamfer,
    rd: 0.035,
    ps,
    px,
    py0,
    slotZ: [-d * 0.2, d * 0.2],
    slotW: d * 0.26,
    slotY0: h * 0.16,
    slotY1: h * 0.84,
    bar: 0.07,
  };
}

// ---------------------------------------------------------------------------------------------
// UV mapping into the atlas (canvas flipped: v = 1 - y/1024)

const clamp01 = (v: number) => Math.min(0.994, Math.max(0.006, v));
const front = (s: number, t: number): [number, number] => [clamp01(s), 0.5 + 0.5 * clamp01(t)];
const end = (s: number, t: number): [number, number] => [0.5 * clamp01(s), 0.5 * clamp01(t)];
const top = (s: number, t: number): [number, number] => [0.5 + 0.5 * clamp01(s), 0.25 + 0.25 * clamp01(t)];
const bottom = (s: number, t: number): [number, number] => [0.5 + 0.5 * clamp01(s), 0.25 * clamp01(t)];

/** Box projection of a w × H × d crate into the atlas; both long faces / both ends read left → right. */
export function crateMapper(w: number, H: number, d: number): UVMapper {
  return (p, _n, axis, sign) => {
    const sx = (p.x + w / 2) / w;
    const sz = (p.z + d / 2) / d;
    const t = p.y / H;
    if (axis === 2) return front(sign > 0 ? sx : 1 - sx, t);
    if (axis === 0) return end(sign > 0 ? 1 - sz : sz, t);
    return sign > 0 ? top(sx, 1 - sz) : bottom(sx, 1 - sz);
  };
}

/** Atlas pixel helpers for the painter (1024 design units, canvas y down). */
export function atlasPx(w: number, H: number, d: number) {
  return {
    fx: (x: number) => ((x + w / 2) / w) * 1024,
    fy: (y: number) => (1 - y / H) * 512,
    ez: (z: number) => ((z + d / 2) / d) * 512,
    ey: (y: number) => 512 + (1 - y / H) * 512,
    tx: (x: number) => 512 + ((x + w / 2) / w) * 512,
    tz: (z: number) => 512 + ((z + d / 2) / d) * 256,
  };
}

// ---------------------------------------------------------------------------------------------
// geometry

function box(parts: THREE.BufferGeometry[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0) {
  parts.push(chamferBox(Math.min(x0, x1), Math.max(x0, x1), y0, y1, Math.min(z0, z1), Math.max(z0, z1), c));
}

/**
 * Corner pillar: square post of side `cb` at corner (sx, sz) with a 45° bevel `cc` on its outer
 * vertical edge, small bevels at the foot and a `ct` bevel around the top (convex hull).
 */
function pillar(parts: THREE.BufferGeometry[], L: ContainerLayout, sx: number, sz: number) {
  const hx = L.w / 2;
  const hz = L.d / 2;
  const ring = (y: number, outIn: number, inIn: number): THREE.Vector3[] => {
    const xo = sx * (hx - outIn);
    const zo = sz * (hz - outIn);
    const xi = sx * (hx - L.cb + inIn);
    const zi = sz * (hz - L.cb + inIn);
    const c = L.cc + outIn * 0.4;
    return [V(xi, y, zi), V(xo, y, zi), V(xo, y, zo - sz * c), V(xo - sx * c, y, zo), V(xi, y, zo)];
  };
  const cf = 0.012;
  parts.push(hull([...ring(0, cf, 0), ...ring(cf, 0, 0), ...ring(L.H - L.ct, 0, 0), ...ring(L.H, L.ct, L.ct * 0.6)]));
}

function containerGeometry(spec: CrateSpec, L: ContainerLayout): THREE.BufferGeometry {
  const { w, h, d, cb, sc, scD, pi, rd, rimTop, deckTop, rimW, base, m, win, endM, endWin } = L;
  const parts: THREE.BufferGeometry[] = [];
  const hx = w / 2;
  const hz = d / 2;
  const plateX = hx - pi;
  const plateZ = hz - pi;
  const coreX = plateX - rd;
  const coreZ = plateZ - rd;
  // base skid (dark line under the body) and core
  box(parts, -hx + 0.14, hx - 0.14, 0, base + 0.01, -hz + 0.14, hz - 0.14);
  box(parts, -coreX, coreX, base, h, -coreZ, coreZ);
  // bevelled corner pillars, proud of every face plate and rising above the rim
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) pillar(parts, L, sx, sz);
  // front / back plates framing the lower recessed panel
  const zb = coreZ - 0.01;
  for (const sz of [-1, 1]) {
    const z1 = sz * plateZ;
    const z0 = sz * zb;
    box(parts, -m, -win.x, base, h, z0, z1);
    box(parts, win.x, m, base, h, z0, z1);
    box(parts, -win.x, win.x, base, win.y0, z0, z1);
    box(parts, -win.x, win.x, win.y1, h, z0, z1);
    // striped channel: the pillar's inner step, between the pillar face and the plates
    for (const sx of [-1, 1]) box(parts, sx * m, sx * (hx - cb + 0.004), base, rimTop, z0, sz * (hz - scD), 0.008);
  }
  // end plates around the recessed window + diagonal bar (the "N" panel)
  const xb = coreX - 0.01;
  for (const sx of [-1, 1]) {
    const x1 = sx * plateX;
    const x0 = sx * xb;
    box(parts, x0, x1, endWin.y1, h, -endM, endM);
    box(parts, x0, x1, base, endWin.y0, -endM, endM);
    for (const sz of [-1, 1]) box(parts, x0, x1, endWin.y0, endWin.y1, sz * endWin.z, sz * endM);
    const zTop = sx > 0 ? endWin.z - 0.03 : -endWin.z + 0.03;
    const xm = sx * (coreX + rd * 0.5);
    parts.push(beam(V(xm, endWin.y1 - 0.03, zTop), V(xm, endWin.y0 + 0.03, -zTop), rd, L.bar));
  }
  // raised top rim between the pillars, flush with the plates, and the inner deck
  for (const sz of [-1, 1]) box(parts, -(hx - cb) - 0.01, hx - cb + 0.01, h - 0.012, rimTop, sz * plateZ, sz * (plateZ - rimW), 0.014);
  for (const sx of [-1, 1]) box(parts, sx * plateX, sx * (plateX - rimW), h - 0.012, rimTop, -(hz - cb) - 0.01, hz - cb + 0.01, 0.014);
  box(parts, -(plateX - rimW) - 0.005, plateX - rimW + 0.005, h - 0.01, deckTop, -(plateZ - rimW) - 0.005, plateZ - rimW + 0.005);
  // long handle bars over painted dark slots
  for (const sz of [-1, 1]) box(parts, -L.handle.x, L.handle.x, deckTop - 0.01, rimTop + 0.004, sz * L.handle.z0, sz * L.handle.z1, 0.012);
  if (L.lid) box(parts, -L.lid.x, L.lid.x, deckTop - 0.01, h + L.lid.t, -L.lid.z, L.lid.z, 0.02);
  const mapper = crateMapper(w, L.H, d);
  return mergeAll(
    parts.map((g) => applyUV(g, mapper)),
    { uv: true },
  );
}

function moduleGeometry(spec: CrateSpec, L: ModuleLayout): THREE.BufferGeometry {
  const { w, h, d, c, rd, ps, px, py0, slotZ, slotW, slotY0, slotY1 } = L;
  const parts: THREE.BufferGeometry[] = [];
  const hx = w / 2;
  const hz = d / 2;
  // core, inset front/back and at the ends so the frame plates stand proud of it
  box(parts, -hx + rd, hx - rd, 0, h, -hz + rd, hz - rd, c * 0.6);
  // plates reach well into the core so their outer edges can carry a large bevel
  const zf = hz - 0.13;
  const xf = hx - 0.13;
  for (const sz of [-1, 1]) {
    const z1 = sz * hz;
    const z0 = sz * zf;
    // full-width bottom and top bands, vertical separators, all bevelled
    box(parts, -hx + 0.004, hx - 0.004, 0.0, py0, z0, z1, c);
    box(parts, -hx + 0.004, hx - 0.004, py0 + ps, h, z0, z1, c);
    const edges = [-hx + 0.004, px[0] - ps / 2, px[0] + ps / 2, px[1] - ps / 2, px[1] + ps / 2, px[2] - ps / 2, px[2] + ps / 2, hx - 0.004];
    for (let k = 0; k < 4; k++) box(parts, edges[k * 2], edges[k * 2 + 1], py0 - 0.02, py0 + ps + 0.02, z0, z1, k === 0 || k === 3 ? c : 0.025);
    // diagonal bars across the outer panels (mirrored), a raised badge plate in the middle one
    const zm = sz * (hz - rd * 0.55);
    for (const k of [0, 2]) {
      const dir = k === 0 ? 1 : -1; // same in both faces' atlas space (s flips with the face)
      const a = ps / 2 - 0.05;
      parts.push(beam(V(px[k] - dir * a, py0 + ps - 0.05, zm), V(px[k] + dir * a, py0 + 0.05, zm), rd * 0.9, L.bar));
    }
    box(parts, px[1] - ps * 0.3, px[1] + ps * 0.3, py0 + ps * 0.36, py0 + ps * 0.68, z0, sz * (hz - rd * 0.35), 0.03);
  }
  // ends: bands + three separators framing two vertical slots
  for (const sx of [-1, 1]) {
    const x1 = sx * hx;
    const x0 = sx * xf;
    box(parts, x0, x1, 0, slotY0, -hz + 0.004, hz - 0.004, c);
    box(parts, x0, x1, slotY1, h, -hz + 0.004, hz - 0.004, c);
    const zs = [-hz + 0.004, slotZ[0] - slotW / 2, slotZ[0] + slotW / 2, slotZ[1] - slotW / 2, slotZ[1] + slotW / 2, hz - 0.004];
    for (let k = 0; k < 3; k++) box(parts, x0, x1, slotY0 - 0.02, slotY1 + 0.02, zs[k * 2], zs[k * 2 + 1], k === 1 ? 0.02 : c);
  }
  const mapper = crateMapper(w, h, d);
  return mergeAll(
    parts.map((g) => applyUV(g, mapper)),
    { uv: true },
  );
}

export function crateGeometry(spec: CrateSpec): THREE.BufferGeometry {
  const style = (Object.keys(CRATE_SPECS) as CrateStyle[]).find((k) => CRATE_SPECS[k] === spec);
  if (spec.kind === 'module') return moduleGeometry(spec, moduleLayout(spec));
  return containerGeometry(spec, containerLayout(spec, style ?? (spec.fallbackColor < 0x808080 ? 'dark' : 'hazard')));
}

export interface CratePlacement {
  style: CrateStyle;
  matrix: THREE.Matrix4;
  tint: number;
}
