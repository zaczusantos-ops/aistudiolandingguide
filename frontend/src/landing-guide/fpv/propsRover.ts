import * as THREE from 'three';
import { beam, chamferBox, colorize, cylinderY, hull, mergeAll, V } from './propsGeometry';

/**
 * Small 4-wheel rover/buggy (t01, t03–t04, t41.5): an open buggy, not a box. Four big chunky
 * lugged wheels on wide swing arms (track ≈ 2.1 wheel diameters, wheelbase ≈ 1.9), a narrow
 * central chassis, an open tubular frame (posts, side rails, diagonal braces, shocks) holding a
 * thin dark wedge-shaped tray (top ≈ 1.45 wheel diameters above the ground, flanks sloping in
 * toward the bottom) with a black/white hazard lip, white panels on its sloped ends, a white deck
 * panel on top, a light equipment box and two thin masts close together near the rear (≈ 0.3 wheel
 * diameters above the tray).
 * Everything below the tray is see-through between the wheels, as in the reference. Proportions
 * measured on t04 / t41.5. Vertex-coloured, one material. Local origin: ground centre; +X forward.
 */

export const ROVER_WHEEL_RADIUS = 0.46;
export const ROVER_WHEEL_WIDTH = 0.38;
/** Wheel centre offsets along X (wheelbase / 2) and Z (track / 2). */
export const ROVER_WHEEL_X = 0.86;
export const ROVER_WHEEL_Z = 0.8;
/** Half extents of the whole buggy footprint (wheels included). */
export const ROVER_HALF_LENGTH = ROVER_WHEEL_X + ROVER_WHEEL_RADIUS;
export const ROVER_HALF_WIDTH = ROVER_WHEEL_Z + ROVER_WHEEL_WIDTH / 2 + 0.04; // incl. hub caps
/** Height of the antenna tips. */
export const ROVER_HEIGHT = 1.74;
/** Small beacon on the tip of the rear antenna. */
export const ROVER_BEACON = V(-0.5, ROVER_HEIGHT + 0.012, 0.11);
export const ROVER_BEACON_RADIUS = 0.02;

const TYRE = 0x29292d;
const LUG = 0x434349;
const HUB = 0x34353a;
const RIM = 0x9c9ea4;
const FRAME = 0x55575d;
const TUBE = 0x6c6e74;
const CHASSIS = 0x2c2d31;
const TRAY = 0x2f3035;
const DECK = 0x3b3c42;
const WHITE = 0xe2e2de;
const STRIPE_DARK = 0x1d1d20;
const SPRING = 0x8a8c92;
/** Light paint of the deck panel (a touch below WHITE: horizontal, it mostly sees the black sky). */
const DECK_WHITE = 0xe6e6e2;

/** Tray (upper body) shape: wedge, wider/longer at the top than at the bottom. */
const TRAY_SHAPE = {
  y0: 1.04,
  y1: 1.34,
  top: { x0: -0.92, x1: 0.96, z: 0.46 },
  bottom: { x0: -0.7, x1: 0.72, z: 0.37 },
} as const;

/**
 * White deck panel on top of the tray (rear two thirds), inset inside the dark tray rim and raised
 * ≈ 8 cm so its bevelled white sides still show from eye level at 10–16 m (t01, t05).
 */
export const ROVER_DECK_PANEL = { x0: -0.82, x1: 0.33, z: 0.35, top: TRAY_SHAPE.y1 + 0.085 } as const;
/** Top of the tray (the deck plate sits on it). */
export const ROVER_TRAY_TOP = TRAY_SHAPE.y1;

function wheel(cx: number, cz: number, side: number, lowPower: boolean): THREE.BufferGeometry[] {
  const R = ROVER_WHEEL_RADIUS;
  const W = ROVER_WHEEL_WIDTH;
  const parts: THREE.BufferGeometry[] = [];
  // tyre: lathe around the axle with rounded shoulders (profile x = radius, y = across width)
  const prof: THREE.Vector2[] = [];
  const P = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
  P(0.25, -W / 2);
  P(R - 0.09, -W / 2);
  P(R - 0.05, -W / 2 + 0.015);
  P(R - 0.028, -W / 2 + 0.05);
  P(R - 0.028, W / 2 - 0.05);
  P(R - 0.05, W / 2 - 0.015);
  P(R - 0.09, W / 2);
  P(0.25, W / 2);
  const tyre = new THREE.LatheGeometry(prof, lowPower ? 12 : 22).toNonIndexed();
  tyre.deleteAttribute('uv');
  tyre.rotateX(Math.PI / 2);
  tyre.translate(cx, R, cz);
  parts.push(colorize(tyre, TYRE));
  // chunky staggered lugs (chevron tread)
  const lugs = lowPower ? 10 : 15;
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    for (const half of [-1, 1]) {
      const z0 = half < 0 ? -W / 2 + 0.01 : 0.01;
      const z1 = half < 0 ? -0.01 : W / 2 - 0.01;
      const g = chamferBox(-0.05, 0.05, R - 0.045, R + 0.004, z0, z1, 0.016);
      g.rotateZ(a + (half > 0 ? Math.PI / lugs : 0));
      g.translate(cx, R, cz);
      parts.push(colorize(g, LUG));
    }
  }
  // dark hub disc with a light rim ring on the outer face and a small cap
  const hub = new THREE.CylinderGeometry(0.26, 0.26, W - 0.03, lowPower ? 10 : 16, 1).toNonIndexed();
  hub.deleteAttribute('uv');
  hub.rotateX(Math.PI / 2);
  hub.translate(cx, R, cz);
  parts.push(colorize(hub, HUB));
  const ring = new THREE.CylinderGeometry(0.235, 0.235, 0.025, lowPower ? 10 : 18, 1, true).toNonIndexed();
  ring.deleteAttribute('uv');
  ring.rotateX(Math.PI / 2);
  ring.translate(cx, R, cz + side * (W / 2 - 0.012));
  parts.push(colorize(ring, RIM));
  const cap = new THREE.CylinderGeometry(0.07, 0.1, 0.06, 8, 1).toNonIndexed();
  cap.deleteAttribute('uv');
  cap.rotateX((side * Math.PI) / 2);
  cap.translate(cx, R, cz + side * (W / 2 + 0.02));
  parts.push(colorize(cap, RIM));
  return parts;
}

/** Thin tube between two points (square section, cheap). */
const tube = (a: THREE.Vector3, b: THREE.Vector3, t: number, color: number) => colorize(beam(a, b, t), color);

export function roverGeometry(lowPower: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wx = ROVER_WHEEL_X;
  const wz = ROVER_WHEEL_Z;
  const R = ROVER_WHEEL_RADIUS;
  const W = ROVER_WHEEL_WIDTH;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(...wheel(sx * wx, sz * wz, sz, lowPower));

  // narrow central chassis (spine) with axle cross-members
  parts.push(colorize(chamferBox(-0.62, 0.62, 0.5, 0.74, -0.17, 0.17, 0.035), CHASSIS));
  for (const sx of [-1, 1]) parts.push(colorize(chamferBox(sx * wx - 0.08, sx * wx + 0.08, R - 0.05, R + 0.07, -0.24, 0.24, 0.02), CHASSIS));

  // suspension: upper/lower swing arms to an upright beside each wheel, shock with a spring
  const armZ = wz - W / 2 - 0.05;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const hub = V(sx * wx, R, sz * armZ);
      parts.push(colorize(chamferBox(sx * wx - 0.05, sx * wx + 0.05, R - 0.13, R + 0.13, sz * armZ - 0.04, sz * armZ + 0.04, 0.012), FRAME));
      parts.push(tube(V(sx * (wx - 0.32), 0.52, sz * 0.17), V(sx * wx, R - 0.1, sz * armZ), 0.05, FRAME));
      parts.push(tube(V(sx * (wx + 0.02), 0.56, sz * 0.2), V(sx * wx, R - 0.08, sz * armZ), 0.045, FRAME));
      parts.push(tube(V(sx * (wx - 0.3), 0.7, sz * 0.17), V(sx * wx, R + 0.1, sz * armZ), 0.045, FRAME));
      // axle stub into the hub
      parts.push(tube(hub, V(sx * wx, R, sz * (wz - W / 2 + 0.02)), 0.07, CHASSIS));
      // shock absorber: from the upright up to the tray underside, light spring around it
      const s0 = V(sx * (wx - 0.06), R + 0.12, sz * (armZ - 0.02));
      const s1 = V(sx * 0.5, TRAY_SHAPE.y0 + 0.01, sz * 0.3);
      parts.push(tube(s0, s1, 0.04, CHASSIS));
      const sm0 = s0.clone().lerp(s1, 0.15);
      const sm1 = s0.clone().lerp(s1, 0.6);
      parts.push(tube(sm0, sm1, 0.075, SPRING));
    }

  // open tubular frame from the chassis up to the tray: four posts, side rails, X braces
  const yT = TRAY_SHAPE.y0;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      parts.push(tube(V(sx * 0.5, 0.72, sz * 0.15), V(sx * 0.56, yT + 0.01, sz * 0.32), 0.05, TUBE));
    }
  for (const sz of [-1, 1]) {
    // side rail at mid height and a diagonal brace (see-through side view)
    parts.push(tube(V(-0.6, 0.92, sz * 0.27), V(0.62, 0.92, sz * 0.27), 0.04, TUBE));
    parts.push(tube(V(-0.52, 0.74, sz * 0.18), V(0.1, yT + 0.01, sz * 0.32), 0.035, TUBE));
    parts.push(tube(V(0.52, 0.74, sz * 0.18), V(-0.1, yT + 0.01, sz * 0.32), 0.035, TUBE));
  }
  for (const sx of [-1, 1]) parts.push(tube(V(sx * 0.56, yT - 0.02, -0.32), V(sx * 0.56, yT - 0.02, 0.32), 0.04, TUBE));
  // front and rear bumper bars on short struts
  for (const sx of [-1, 1]) {
    const xb = sx * 0.86;
    parts.push(tube(V(xb, 0.62, -0.34), V(xb, 0.62, 0.34), 0.05, TUBE));
    for (const sz of [-1, 1]) parts.push(tube(V(sx * 0.6, 0.62, sz * 0.15), V(xb, 0.62, sz * 0.3), 0.04, TUBE));
  }

  // tray: thin dark wedge, flanks sloping in toward the bottom
  const T = TRAY_SHAPE;
  // flank point at height y, inset by `ins` along X and Z (top edge bevel, t05: rounded rim)
  const fl = (y: number, ins: number) => {
    const t = (y - T.y0) / (T.y1 - T.y0);
    const x0 = T.bottom.x0 + t * (T.top.x0 - T.bottom.x0) + ins;
    const x1 = T.bottom.x1 + t * (T.top.x1 - T.bottom.x1) - ins;
    const z = T.bottom.z + t * (T.top.z - T.bottom.z) - ins;
    return [-1, 1].flatMap((sz) => [V(x0, y, sz * z), V(x1, y, sz * z)]);
  };
  const bev = 0.05;
  parts.push(colorize(hull([...fl(T.y0, 0.02), ...fl(T.y0 + 0.02, 0), ...fl(T.y1 - bev, 0), ...fl(T.y1 - bev * 0.35, bev * 0.45), ...fl(T.y1, bev)]), TRAY));
  // deck plate on top, slightly inset
  parts.push(colorize(chamferBox(T.top.x0 + 0.1, T.top.x1 - 0.12, T.y1 - 0.01, T.y1 + 0.016, -T.top.z + 0.09, T.top.z - 0.09, 0.01), DECK));
  // white deck panel over the rear two thirds of the deck (t01/t03–t05: the buggy reads light-topped,
  // not as a dark box), with two panel joints and a small dark hatch; the dark tray rim frames it
  {
    const D = ROVER_DECK_PANEL;
    parts.push(colorize(chamferBox(D.x0, D.x1, T.y1 + 0.004, D.top, -D.z, D.z, 0.022), DECK_WHITE));
    for (const xj of [D.x0 + (D.x1 - D.x0) * 0.36, D.x0 + (D.x1 - D.x0) * 0.68])
      parts.push(colorize(chamferBox(xj - 0.012, xj + 0.012, D.top - 0.012, D.top + 0.003, -D.z + 0.03, D.z - 0.03), STRIPE_DARK));
    parts.push(colorize(chamferBox(D.x0 + 0.08, D.x0 + 0.26, D.top - 0.01, D.top + 0.006, 0.08, 0.24, 0.006), CHASSIS));
  }

  // hazard lip along the lower edge of both long flanks: dark band with slanted white bars
  const lipY0 = T.y0 + 0.012;
  const lipY1 = T.y0 + 0.075;
  const zAt = (y: number) => T.bottom.z + ((y - T.y0) / (T.y1 - T.y0)) * (T.top.z - T.bottom.z);
  for (const sz of [-1, 1]) {
    const zl = sz * (zAt((lipY0 + lipY1) / 2) + 0.012);
    parts.push(colorize(chamferBox(T.bottom.x0 + 0.06, T.bottom.x1 - 0.04, lipY0, lipY1, zl - 0.014, zl + 0.014), STRIPE_DARK));
    const n = lowPower ? 6 : 11;
    for (let k = 0; k < n; k++) {
      const x = T.bottom.x0 + 0.12 + (k / (n - 1)) * (T.bottom.x1 - T.bottom.x0 - 0.26);
      parts.push(tube(V(x - 0.028, lipY0 + 0.006, zl + sz * 0.012), V(x + 0.028, lipY1 - 0.006, zl + sz * 0.012), 0.032, WHITE));
    }
  }

  // white panels: one across the sloped front face (lit in t01), small ones on the rear corners
  {
    const f = 0.012;
    const a = (y: number) => T.bottom.x1 + ((y - T.y0) / (T.y1 - T.y0)) * (T.top.x1 - T.bottom.x1);
    const yA = T.y0 + 0.08;
    const yB = T.y1 - 0.05;
    const pts: THREE.Vector3[] = [];
    for (const y of [yA, yB])
      for (const sz of [-1, 1]) {
        const zz = sz * (zAt(y) - 0.07);
        pts.push(V(a(y) + 0.002, y, zz), V(a(y) + f, y + 0.004, zz));
      }
    parts.push(colorize(hull(pts), WHITE));
    const b = (y: number) => T.bottom.x0 + ((y - T.y0) / (T.y1 - T.y0)) * (T.top.x0 - T.bottom.x0);
    for (const sz of [-1, 1]) {
      // rear corner panels on the sun-facing rear slope: two wide white squares with a dark gap
      // between them (t41.5), the bright patch at the buggy's upper left in t01 / t03.5
      const p2: THREE.Vector3[] = [];
      for (const y of [yA + 0.02, yB - 0.02])
        for (const zz of [sz * (zAt(y) - 0.02), sz * (zAt(y) - 0.26)]) p2.push(V(b(y) - 0.002, y, zz), V(b(y) - f, y + 0.004, zz));
      parts.push(colorize(hull(p2), WHITE));
    }
  }

  // light equipment box near the front of the deck, ahead of the white panel
  parts.push(colorize(chamferBox(0.36, 0.7, T.y1 + 0.015, T.y1 + 0.11, -0.2, 0.2, 0.02), 0xb4b5ba));
  parts.push(colorize(chamferBox(0.62, 0.705, T.y1 + 0.04, T.y1 + 0.09, -0.15, 0.15, 0.008), STRIPE_DARK));
  // two thin masts close together near the rear (t41.5: ≈ 0.2 m apart), standing on the white panel
  for (const sz of [-1, 1]) {
    parts.push(colorize(cylinderY(ROVER_BEACON.x, sz * ROVER_BEACON.z, ROVER_DECK_PANEL.top - 0.005, T.y1 + 0.12, 0.022, 6), CHASSIS));
    parts.push(colorize(cylinderY(ROVER_BEACON.x, sz * ROVER_BEACON.z, T.y1 + 0.1, ROVER_HEIGHT, 0.01, 5, 0.007), FRAME));
  }
  return mergeAll(parts, { uv: false, color: true });
}
