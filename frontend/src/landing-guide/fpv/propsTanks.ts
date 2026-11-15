import * as THREE from 'three';
import { cylinderY, mergeAll } from './propsGeometry';

/**
 * Vertical storage tank (t15–t18.5, t41.5): plain body on a slightly wider foot ring, a ribbed
 * (threaded) band barely inset from the body, a thin lip, a truncated-cone cap with softly rounded
 * shoulders and a flat top, a small neck and a thin antenna mast. Proportions measured at full
 * resolution on t18.5 (front tank: body width 160 px, cap top 330 px above the foot ⇒ width ≈
 * 0.49 × cap height; t17 tanks 0.41–0.46): body ≈ 77 % of the cap height, band ≈ 0.16 body
 * widths, cap ≈ 0.3 body widths tall with a top ≈ 0.45 body widths across, mast ≈ 2.9 body
 * widths above the foot. Local origin at the bottom centre.
 *
 * UVs: u runs around the tank, v = height / TANK_UV_HEIGHT, so `tankDetailMap` can paint the
 * foot notches, band and cap seams at their real heights.
 */

/** Body radius (m): 0.77 m wide, width / cap height ≈ 0.43 (slimmer than round 2's 0.47). */
export const TANK_RADIUS = 0.385;
/** Height of the flat cap top (m), mast excluded. */
export const TANK_HEIGHT = 1.8;
/** Top of the antenna mast (m). */
export const TANK_MAST_TOP = 2.6;
/** v = 1 in the tank texture corresponds to this height (m). */
export const TANK_UV_HEIGHT = 2.0;

/**
 * Suggested tank paint (lavender grey) for MeshStandardMaterial with `tankDetailMap`. Round 4,
 * t18.5 at full resolution: the lit edge read 178 against the reference's 181–186 with the same
 * falloff to the terminator, so the metalness drops to 0.04 (≈ +6 % diffuse, ≈ +5 levels on the lit
 * flank; the shaded partner tanks stay at ≈ 30, reference 24–38).
 */
export const TANK_PAINT = { color: 0xcbcad4, roughness: 0.42, metalness: 0.04 } as const;

/** Profile heights (m) shared with the texture painter. */
export const TANK_PROFILE = {
  footTop: 0.07,
  bodyTop: 1.385,
  bandTop: 1.515,
  collarTop: 1.54,
  capTop: TANK_HEIGHT,
  capTopRadius: 0.45 * TANK_RADIUS,
} as const;

export function tankProfile(): THREE.Vector2[] {
  const R = TANK_RADIUS;
  const p = TANK_PROFILE;
  const pts: THREE.Vector2[] = [];
  const P = (x: number, y: number) => pts.push(new THREE.Vector2(x, y));
  P(0, 0);
  P(R + 0.012, 0);
  P(R + 0.012, p.footTop - 0.006);
  P(R + 0.004, p.footTop);
  P(R, p.footTop + 0.004);
  P(R, p.bodyTop - 0.01);
  P(R - 0.005, p.bodyTop);
  // ribbed (threaded) band, inset only ~6 % so the tank keeps a straight silhouette (t18.5)
  const rb = R * 0.94;
  P(rb, p.bodyTop + 0.004);
  const ridges = 5;
  const span = p.bandTop - p.bodyTop - 0.012;
  for (let k = 0; k < ridges; k++) {
    const y0 = p.bodyTop + 0.008 + (k / ridges) * span;
    const dy = span / ridges;
    P(rb, y0 + dy * 0.12);
    P(rb + 0.011, y0 + dy * 0.35);
    P(rb + 0.011, y0 + dy * 0.65);
    P(rb, y0 + dy * 0.88);
  }
  P(rb, p.bandTop);
  // thin lip, flush with the body (the cap base is no wider than the body in the reference)
  P(R + 0.002, p.bandTop + 0.003);
  P(R + 0.004, p.bandTop + 0.01);
  P(R + 0.004, p.collarTop - 0.006);
  P(R - 0.004, p.collarTop);
  // cap: truncated cone with slightly convex flanks and a rounded top shoulder, flat top
  const r0 = R - 0.012;
  const r1 = p.capTopRadius;
  const h0 = p.collarTop;
  const h1 = p.capTop;
  const steps = 6;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    // convex flank: steeper near the lip, flatter toward the top (x shrinks as t^1.3)
    P(r0 - (r0 - (r1 + 0.03)) * t ** 1.3, h0 + (h1 - 0.018 - h0) * t);
  }
  P(r1 + 0.012, h1 - 0.005);
  P(r1, h1);
  P(0, h1);
  return pts;
}

function heightUV(g: THREE.BufferGeometry, uFixed?: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const old = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = uFixed ?? (old ? old.getX(i) : 0);
    uv[i * 2 + 1] = Math.min(0.999, pos.getY(i) / TANK_UV_HEIGHT);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function tankGeometry(lowPower: boolean): THREE.BufferGeometry {
  const lathe = new THREE.LatheGeometry(tankProfile(), lowPower ? 16 : 30).toNonIndexed();
  heightUV(lathe);
  const top = TANK_PROFILE.capTop;
  // neck: square-ish block with a thinner upper stage, then the mast
  const neckBase = heightUV(cylinderY(0, 0, top - 0.01, top + 0.07, 0.055, 8, 0.05), 0.5);
  const neck = heightUV(cylinderY(0, 0, top + 0.07, top + 0.19, 0.036, 8, 0.03), 0.5);
  const neckCap = heightUV(cylinderY(0, 0, top + 0.19, top + 0.215, 0.022, 6, 0.016), 0.5);
  const mast = heightUV(cylinderY(0, 0, top + 0.2, TANK_MAST_TOP, 0.0085, 5, 0.0055), 0.5);
  const parts = [lathe, neckBase, neck, neckCap, mast];
  if (!lowPower) {
    // two small side lugs on the neck base (t18.5)
    for (const s of [-1, 1]) parts.push(heightUV(cylinderY(s * 0.07, 0, top + 0.01, top + 0.06, 0.018, 6), 0.5));
  }
  const g = mergeAll(parts, { uv: true });
  g.computeBoundingSphere();
  return g;
}
