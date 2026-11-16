import * as THREE from 'three';
import { applyUV, chamferBox, hull, lerp, mergeAll, V, worldUV } from './propsGeometry';

/**
 * The landed ship (hero prop, t01/t05/t12–t18.5), authored directly in metres from a side
 * profile measured on the reference frame t15 (eye 1.7 m): a chamfered "head" block with a
 * chevron nose and a dark recessed lower side panel, a roof pod floating above the head on a
 * dark gap, a segmented spine, a mid hull with a slanted side groove, a solid segmented lower
 * skid on a front sled, and a long rear sweep (rounded shoulder, then ≈ 35° down) ending in a
 * small chamfered tip at the ground.
 *
 * Local frame: +X from nose (x = -L/2) to tail (x = +L/2), +Y up (y = 0 is nominal ground),
 * +Z / -Z are the two flanks. Parts that touch the ground extend `groundDrop` metres below 0.
 * Geometry is authored with x measured from the nose and shifted by -L/2 at the end.
 */

export const SHIP_LENGTH = 25.0;
export const SHIP_HALF_WIDTH = 3.15;
/** Top of the roof pod (m above nominal ground). */
export const SHIP_HEIGHT = 7.45;

// ------------------------------------------------------------------------------------ profile
const HEAD_TOP = 5.83;
const HEAD_PANEL_TOP = 4.05;
const HEAD_BOTTOM = 2.4;
const HEAD_HW = 2.9;
const POD_TOP = SHIP_HEIGHT;
const POD_BOTTOM = 6.15;
const SPINE_TOP = 5.9;
const SPINE_BOTTOM = 5.15;
const SKID_TOP = 2.12;
const SKID_BOTTOM = 1.25;
const SWEEP_START = 15.0;
const TIP_X = SHIP_LENGTH;
const TIP_TOP = 0.42;
const SWEEP_EXP = 1.5;

/**
 * Rear sweep: top height at x. Starts level at SWEEP_START (60 % of the length, a rounded shoulder)
 * and steepens to ≈ 35° near the tip, as in the reference side view (t15).
 */
export function sweepTop(x: number): number {
  const t = THREE.MathUtils.clamp((x - SWEEP_START) / (TIP_X - SWEEP_START), 0, 1);
  return SPINE_BOTTOM - (SPINE_BOTTOM - TIP_TOP) * Math.pow(t, SWEEP_EXP);
}

interface Sec {
  x: number;
  yB: number;
  yT: number;
  hw: number;
  cB?: number;
  cT?: number;
  /** Vertical drop of the top chamfer when it differs from its horizontal inset `cT`. */
  cTy?: number;
}

function ring(s: Sec): THREE.Vector3[] {
  const span = s.yT - s.yB;
  const cB = Math.min(s.cB ?? 0, s.hw * 0.9, span * 0.45);
  const cT = Math.min(s.cT ?? 0, s.hw * 0.9);
  const cTy = Math.min(s.cTy ?? cT, span * 0.45);
  const pts: THREE.Vector3[] = [];
  for (const sz of [-1, 1]) {
    pts.push(V(s.x, s.yB, sz * (s.hw - cB)));
    if (cB > 0) pts.push(V(s.x, s.yB + cB, sz * s.hw));
    if (cT > 0) pts.push(V(s.x, s.yT - cTy, sz * s.hw));
    pts.push(V(s.x, s.yT, sz * (s.hw - cT)));
  }
  return pts;
}

const loft = (secs: Sec[]) => hull(secs.flatMap(ring));

interface BlockOpts {
  x0: number;
  x1: number;
  yB: number;
  yT: number;
  hw: number;
  c?: number;
  cB?: number;
  cT?: number;
  /** Chamfer of the end faces (front / back). */
  e0?: number;
  e1?: number;
  yB1?: number;
  yT1?: number;
  hw1?: number;
}

function block(o: BlockOpts): THREE.BufferGeometry {
  const cB = o.cB ?? o.c ?? 0;
  const cT = o.cT ?? o.c ?? 0;
  const len = o.x1 - o.x0;
  const at = (x: number): Sec => {
    const t = (x - o.x0) / len;
    return { x, yB: lerp(o.yB, o.yB1 ?? o.yB, t), yT: lerp(o.yT, o.yT1 ?? o.yT, t), hw: lerp(o.hw, o.hw1 ?? o.hw, t), cB, cT };
  };
  const secs: Sec[] = [];
  const e0 = o.e0 ?? 0;
  const e1 = o.e1 ?? 0;
  if (e0 > 0) {
    const s = at(o.x0);
    secs.push({ ...s, yB: s.yB + e0, yT: s.yT - e0, hw: s.hw - e0 }, at(o.x0 + e0));
  } else secs.push(at(o.x0));
  if (e1 > 0) {
    const s = at(o.x1);
    secs.push(at(o.x1 - e1), { ...s, yB: s.yB + e1, yT: s.yT - e1, hw: s.hw - e1 });
  } else secs.push(at(o.x1));
  return loft(secs);
}

/** Convex prism: polygon (x, y) extruded to ±hw, with the side edges chamfered by `c`. */
function prism(poly: [number, number][], hw: number, c: number): THREE.BufferGeometry {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x / poly.length;
    cy += y / poly.length;
  }
  const pts: THREE.Vector3[] = [];
  for (const [x, y] of poly) {
    const dx = cx - x;
    const dy = cy - y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(c * 1.25, d * 0.4) / d;
    for (const sz of [-1, 1]) {
      pts.push(V(x, y, sz * (hw - c)));
      pts.push(V(x + dx * k, y + dy * k, sz * hw));
    }
  }
  return hull(pts);
}

/** Thin plate on both flanks: x0..x1, y0..y1, from |z| = zIn to zOut. */
function flankPlates(out: THREE.BufferGeometry[], x0: number, x1: number, y0: number, y1: number, zIn: number, zOut: number, c = 0.03) {
  for (const sz of [-1, 1]) out.push(chamferBox(x0, x1, y0, y1, Math.min(sz * zIn, sz * zOut), Math.max(sz * zIn, sz * zOut), c));
}

export interface ShipGeometry {
  /** Painted hull (uv + per-vertex shading colour). */
  hull: THREE.BufferGeometry;
  /** Window panes and the recessed head panels: near-black. */
  dark: THREE.BufferGeometry;
  /** Recessed / shadowed surfaces (side groove, undercuts, pylons): mid-dark grey. */
  shade: THREE.BufferGeometry;
  /** Collider circles in local XZ (x along the hull). */
  colliders: { x: number; z: number; r: number }[];
  /** Footprint rectangles (local, x0..x1 × ±hw) used for contact darkening. */
  footprint: { x0: number; x1: number; hw: number }[];
}

/**
 * Per-vertex shading baked into the hull colour: downward faces darker (the underside only sees
 * the faint fill), chamfers a little lighter so the bevels read as thin highlights.
 */
function bakeFaceShading(g: THREE.BufferGeometry, tone = 1): THREE.BufferGeometry {
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const count = nrm.count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i + 2 < count; i += 3) {
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    let k = 1;
    if (ny < -0.3) k = 0.55 + 0.25 * (1 + ny);
    else if (m < 0.96 && ny > -0.1) k = 1.13;
    // the tone only scales vertical faces (side panels); chamfers keep their highlight
    const t = Math.abs(ny) < 0.2 && m > 0.96 ? tone : 1;
    for (let j = 0; j < 3; j++) {
      col[(i + j) * 3] = k * t;
      col[(i + j) * 3 + 1] = k * t;
      col[(i + j) * 3 + 2] = k * t;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Bakes the face shading of one part now, with a tone factor on its vertical faces. */
const tone = (g: THREE.BufferGeometry, k: number) => bakeFaceShading(g, k);

export function buildShipGeometry(groundDrop: number): ShipGeometry {
  const G = -Math.max(0.4, groundDrop);
  const H: THREE.BufferGeometry[] = [];
  const D: THREE.BufferGeometry[] = [];
  const S: THREE.BufferGeometry[] = [];

  // ---------------------------------------------------------------- head
  // upper block: chevron nose (upper bevel + short nose strip), chamfered side edges
  H.push(
    prism(
      [
        [0.47, HEAD_TOP],
        [4.1, HEAD_TOP],
        [4.1, HEAD_PANEL_TOP],
        [0.06, HEAD_PANEL_TOP],
        [0.0, 4.42],
        [0.0, 4.7],
      ],
      HEAD_HW,
      0.24,
    ),
  );
  // lower block, recessed: lit front bevel sloping back to the bottom edge
  H.push(
    prism(
      [
        [0.06, HEAD_PANEL_TOP],
        [4.35, HEAD_PANEL_TOP],
        [4.45, HEAD_BOTTOM],
        [1.2, HEAD_BOTTOM],
      ],
      HEAD_HW - 0.28,
      0.12,
    ),
  );
  // large dark side panel in the recess, with a thin lighter frame line across it
  flankPlates(D, 1.05, 4.2, HEAD_BOTTOM + 0.1, HEAD_PANEL_TOP - 0.04, HEAD_HW - 0.29, HEAD_HW - 0.22, 0.02);
  flankPlates(S, 1.2, 4.2, 3.0, 3.06, HEAD_HW - 0.22, HEAD_HW - 0.2, 0.0);

  // ---------------------------------------------------------------- roof pod (floats on a dark gap)
  // pod side faces read darker than the head in the reference (top chamfer light, side mid grey)
  H.push(tone(block({ x0: 0.1, x1: 5.9, yB: POD_BOTTOM, yT: POD_TOP, hw: 2.35, cT: 0.3, cB: 0.36, e0: 0.16 }), 0.8));
  // second pod segment: same section, squared chamfered end (no tapering tip)
  H.push(tone(block({ x0: 5.95, x1: 9.3, yB: POD_BOTTOM + 0.12, yT: POD_TOP - 0.12, hw: 2.25, cT: 0.28, cB: 0.3, e0: 0.12, e1: 0.14 }), 0.76));
  S.push(block({ x0: 3.3, x1: 4.6, yB: HEAD_TOP - 0.2, yT: POD_BOTTOM + 0.05, hw: 1.3, c: 0.08 }));
  S.push(block({ x0: 7.0, x1: 7.9, yB: SPINE_TOP - 0.05, yT: POD_BOTTOM + 0.1, hw: 1.15, c: 0.08 }));

  // ---------------------------------------------------------------- neck with window slots
  H.push(block({ x0: 4.0, x1: 5.75, yB: HEAD_BOTTOM, yT: SPINE_BOTTOM + 0.05, hw: 2.42, c: 0.1 }));
  for (let k = 0; k < 4; k++) {
    const x0 = 4.18 + k * 0.38;
    flankPlates(D, x0, x0 + 0.26, 2.66, 4.15, 2.3, 2.47, 0.02);
  }

  // ---------------------------------------------------------------- spine (segmented with collars)
  const spineSegs: [number, number, number, number][] = [
    [4.1, 7.4, 0.14, 0],
    [7.8, 10.6, 0, 0],
    [11.0, 13.4, 0, 0],
    [13.8, 15.25, 0, 0.16],
  ];
  for (const [x0, x1, e0, e1] of spineSegs) H.push(block({ x0, x1, yB: SPINE_BOTTOM, yT: SPINE_TOP, hw: 3.0, cT: 0.22, cB: 0.14, e0, e1 }));
  for (const x0 of [7.42, 10.62, 13.42]) H.push(block({ x0, x1: x0 + 0.36, yB: SPINE_BOTTOM - 0.06, yT: SPINE_TOP + 0.07, hw: 3.12, cT: 0.2, cB: 0.12 }));
  // low equipment deck on the spine behind the pod (t01)
  H.push(block({ x0: 10.2, x1: 13.6, yB: SPINE_TOP - 0.05, yT: SPINE_TOP + 0.42, hw: 1.5, c: 0.16, e0: 0.25, e1: 0.25 }));

  // ---------------------------------------------------------------- mid hull
  // plain front part tucked under the spine (dark undercut above it)
  H.push(block({ x0: 5.7, x1: 7.9, yB: SKID_TOP, yT: 4.42, hw: 2.9, cT: 0.32, cB: 0.1 }));
  S.push(block({ x0: 5.7, x1: 16.2, yB: SKID_TOP, yT: SPINE_BOTTOM + 0.02, hw: 2.42 }));
  // upper band above the slanted groove, lower band below it
  const gx0 = 7.9;
  const gx1 = 16.3;
  const grooveTop = (x: number) => lerp(3.45, 2.85, (x - gx0) / (gx1 - gx0));
  const grooveBot = (x: number) => grooveTop(x) - 0.52;
  H.push(
    hull(
      [-1, 1].flatMap((sz) => [
        V(gx0, grooveTop(gx0), sz * 2.9),
        V(gx1, grooveTop(gx1), sz * 2.9),
        V(gx0, SPINE_BOTTOM - 0.2, sz * 2.9),
        V(gx1, SPINE_BOTTOM - 0.2, sz * 2.9),
        V(gx0, SPINE_BOTTOM, sz * 2.72),
        V(gx1, SPINE_BOTTOM, sz * 2.72),
        V(gx0, grooveTop(gx0) - 0.08, sz * 2.8),
        V(gx1, grooveTop(gx1) - 0.08, sz * 2.8),
      ]),
    ),
  );
  H.push(
    hull(
      [-1, 1].flatMap((sz) => [
        V(gx0, grooveBot(gx0), sz * 2.62),
        V(gx1, grooveBot(gx1), sz * 2.62),
        V(gx0, grooveBot(gx0) - 0.1, sz * 2.84),
        V(gx1, grooveBot(gx1) - 0.1, sz * 2.84),
        V(gx0, SKID_TOP, sz * 2.84),
        V(gx1, SKID_TOP, sz * 2.84),
      ]),
    ),
  );
  // window at the aft end of the groove (t15) and its frame
  flankPlates(D, 15.75, 16.25, grooveBot(16) + 0.02, 3.86, 2.84, 2.98, 0.02);
  flankPlates(H, 15.6, 16.4, 3.86, 4.0, 2.82, 3.0, 0.02);

  // ---------------------------------------------------------------- lower skid band (segmented)
  const skidSegs: [number, number, number][] = [
    [1.05, 4.5, 0.36],
    [4.85, 8.15, 0],
    [8.5, 11.45, 0],
    [11.8, 14.0, 0],
  ];
  for (const [x0, x1, e0] of skidSegs) H.push(block({ x0, x1, yB: SKID_BOTTOM, yT: SKID_TOP, hw: 3.05, c: 0.17, e0, e1: x1 === 14.0 ? 0.25 : 0 }));
  for (const x0 of [4.5, 8.15, 11.45]) H.push(block({ x0, x1: x0 + 0.35, yB: SKID_BOTTOM - 0.06, yT: SKID_TOP + 0.06, hw: 3.14, c: 0.14 }));

  // ---------------------------------------------------------------- front sled resting on the ground
  H.push(
    hull(
      [-1, 1].flatMap((sz) => [
        V(1.42, SKID_BOTTOM, sz * 2.82),
        V(1.42, G, sz * 2.82),
        V(1.55, SKID_BOTTOM, sz * 2.95),
        V(1.55, G, sz * 2.95),
        V(7.1, SKID_BOTTOM, sz * 2.95),
        V(5.72 + 0.6 * G, G, sz * 2.95),
      ]),
    ),
  );
  flankPlates(S, 1.6, 6.3, 0.58, 0.63, 2.94, 2.97, 0);
  // solid but deeply recessed undercut behind the sled (reads as a dark contact gap, not see-through)
  S.push(block({ x0: 5.5, x1: 14.3, yB: G, yT: SKID_BOTTOM + 0.05, hw: 2.15 }));
  // service block at the foot of the rear section (t15/t17)
  H.push(block({ x0: 13.9, x1: 16.6, yB: G, yT: 1.92, hw: 3.0, c: 0.12 }));
  flankPlates(S, 15.0, 15.08, 0.15, 1.75, 2.99, 3.02, 0);

  // ---------------------------------------------------------------- rear sweep down to the ground
  const xs = [15.0, 16.0, 17.1, 18.2, 19.3, 20.3, 21.3, 22.2, 23.0, 23.7, 24.3];
  const secs: Sec[] = xs.map((x) => {
    const t = (x - SWEEP_START) / (TIP_X - SWEEP_START);
    // the top chamfer shrinks toward the tip so the thin end keeps a flat top
    const yT = sweepTop(x);
    return { x, yB: x < 16.5 ? SKID_TOP : G, yT, hw: lerp(2.92, 2.6, t), cT: lerp(0.55, 0.5, t), cTy: Math.min(lerp(0.3, 0.24, t), (yT - G) * 0.3), cB: 0 };
  });
  for (let i = 0; i < secs.length - 1; i++) H.push(loft([secs[i], { ...secs[i + 1], x: secs[i + 1].x - 0.03 }]));
  // small chamfered tip: a short face leaning back from the top edge into the ground
  {
    const s = secs[secs.length - 1];
    const pts = ring(s);
    for (const sz of [-1, 1]) {
      pts.push(V(TIP_X, TIP_TOP, sz * 2.1), V(TIP_X - 0.08, TIP_TOP - 0.1, sz * 2.4));
      pts.push(V(TIP_X - 0.3, 0.0, sz * 2.4), V(TIP_X - 0.3 + 0.35 * G, G, sz * 2.4));
    }
    H.push(hull(pts));
  }
  // two rib seams on the rear flanks
  for (const xr of [18.4, 21.4]) {
    const top = sweepTop(xr) - 0.4;
    const hw = lerp(2.92, 2.6, (xr - SWEEP_START) / (TIP_X - SWEEP_START));
    flankPlates(S, xr, xr + 0.09, 0.05, top, hw - 0.03, hw + 0.04, 0);
  }

  // shift so the hull is centred on the origin along X
  const shift = new THREE.Matrix4().makeTranslation(-SHIP_LENGTH / 2, 0, 0);
  const uv = worldUV(6);
  const hullGeo = mergeAll(
    H.map((g) => applyUV((g.getAttribute('color') ? g : bakeFaceShading(g)).applyMatrix4(shift), uv)),
    { uv: true, color: true },
  );
  const darkGeo = mergeAll(D.map((g) => g.applyMatrix4(shift)), { uv: false });
  const shadeGeo = mergeAll(S.map((g) => g.applyMatrix4(shift)), { uv: false });

  const colliders: { x: number; z: number; r: number }[] = [];
  for (let x = 1.8; x <= 24.0; x += 2.6) colliders.push({ x: x - SHIP_LENGTH / 2, z: 0, r: x > 22.5 ? 2.9 : 3.35 });

  const footprint = [
    { x0: 1.4 - SHIP_LENGTH / 2, x1: 7.1 - SHIP_LENGTH / 2, hw: 2.95 },
    { x0: 5.5 - SHIP_LENGTH / 2, x1: 14.3 - SHIP_LENGTH / 2, hw: 2.4 },
    { x0: 13.9 - SHIP_LENGTH / 2, x1: 24.6 - SHIP_LENGTH / 2, hw: 2.9 },
  ];

  return { hull: hullGeo, dark: darkGeo, shade: shadeGeo, colliders, footprint };
}
