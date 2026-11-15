/**
 * Large local landforms of the illustrative walk (pure, three.js-free, seed-independent), added
 * to the height field of terrainHeight.ts. World convention: metres, Y up, -Z = North, azimuth
 * clockwise from North; the base (spawn area) sits around the origin and the illustrative Sun is
 * low in the W/SW (azimuth ≈ 252°).
 *
 * - VALLEY: broad low ground (≈ 7 m below the base floor) opening W/SW of the base toward the
 *   distant greenhouse. Seen from the base it falls away gently toward the Sun (lit); seen from
 *   inside it, the ground rises on every side.
 * - WALLS: the valley's western edge turns a steep, self-shadowed face toward the base and the
 *   valley floor, capped by a lit rim: from the valley it reads as a dark band with a thin bright
 *   crest line right of the Sun. A second, farther wall closes the valley to the SW (left of the
 *   Sun); from the base and the valley it hides behind nearer rises, from a raised viewpoint it
 *   shows as a dark band under the horizon.
 * - LIPS: low rims 50–70 m W/NW and SW of the base that hide the valley floor and the wall faces
 *   from the base, so only the plain beyond shows there.
 * - FAR_CALM: the far plain beyond the wall is kept low (damped far hills), so neither the base
 *   nor the valley sees distant rises above the rim.
 * Everything here is illustrative scenery: no real topography is implied.
 */

export interface ValleyParams {
  /** Floor depth (m) below the base floor. */
  depth: number;
  /** Azimuth window (deg): centre, half width, fade. */
  az: number;
  hw: number;
  fade: number;
  /** Radii (m) over which the ground descends into the valley on the open side... */
  r0: number;
  r1: number;
  /** ...and behind the lip. */
  r0Lip: number;
  r1Lip: number;
  /** Radii (m) over which the far end of the valley rises back to the plain. */
  rEnd0: number;
  rEnd1: number;
}

export interface WallParams {
  /** Azimuth window (deg): centre, half width, fade. */
  az: number;
  hw: number;
  fade: number;
  /** Rim radius (m) from the origin, its wander amplitude (m), face width (m). */
  r: number;
  wander: number;
  width: number;
  /** Rim height (m) relative to the base floor; height of the lit bench beyond the rim (m). */
  rimH: number;
  bench: number;
  /** Extra depth (m) of the floor at the foot of the face and the distance (m) it deepens over. */
  moat: number;
  moatW: number;
  /** Amplitude (m) of the rim height's variation along the wall (wavy, lumpy crest line). */
  rimVar: number;
}

export interface LipParams {
  az: number;
  hw: number;
  fade: number;
  /** Crest radius (m), half width (m) and height (m) above the base floor. */
  r: number;
  w: number;
  h: number;
}

export const VALLEY: ValleyParams = {
  depth: 7,
  az: 252,
  hw: 46,
  fade: 22,
  r0: 40,
  r1: 95,
  r0Lip: 78,
  r1Lip: 104,
  rEnd0: 560,
  rEnd1: 860,
};

export const WALLS: readonly WallParams[] = [
  { az: 270, hw: 15, fade: 4, r: 268, wander: 9, width: 26, rimH: -2.5, bench: 1.2, moat: 2.5, moatW: 90, rimVar: 1.4 },
  // Its southern end: same rim, gentle lit slope (the horizon toward the Sun from the valley).
  { az: 249, hw: 4, fade: 5, r: 268, wander: 9, width: 75, rimH: -2.5, bench: 0, moat: 0, moatW: 1, rimVar: 0 },
  { az: 215, hw: 9, fade: 5, r: 410, wander: 14, width: 34, rimH: 2.2, bench: 0.8, moat: 0, moatW: 1, rimVar: 0.8 },
];

export const LIPS: readonly LipParams[] = [
  { az: 278, hw: 26, fade: 9, r: 72, w: 20, h: 1.3 },
  { az: 202, hw: 24, fade: 12, r: 76, w: 20, h: 2.2 },
];

/** Far-plain calming beyond the wall (azimuth window, deg) and its start radii (m). */
export const FAR_CALM = { az: 285, hw: 36, fade: 18, r0: 300, r1: 700, strength: 0.85 };

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Smooth azimuthal window: 1 inside [c - hw, c + hw], fading to 0 over `fade` (degrees). */
export function azWindow(azDeg: number, c: number, hw: number, fade: number): number {
  let d = Math.abs(azDeg - c) % 360;
  if (d > 180) d = 360 - d;
  return 1 - smooth(hw, hw + fade, d);
}

export interface LandformSample {
  /** Height offset (m). */
  h: number;
  /** 0..1 factor for the broad swells / hummocks / far hills (1 = untouched). */
  keep: number;
}

/**
 * Landform offset at (x, z), given its radius `r` and azimuth `azDeg` from the origin and a
 * smooth periodic `wobble(azRad)` in [-1, 1] for the rim line. Writes into and returns `out`.
 */
export function landformAt(
  r: number,
  azDeg: number,
  wobble: (azRad: number) => number,
  out: LandformSample,
): LandformSample {
  const V = VALLEY;
  let h = 0;
  let keep = 1;

  const wv = azWindow(azDeg, V.az, V.hw, V.fade);
  let wl = 0;
  for (let i = 0; i < LIPS.length; i++) {
    const L = LIPS[i];
    const w = azWindow(azDeg, L.az, L.hw, L.fade);
    if (w <= 0) continue;
    wl = Math.max(wl, w);
    const t = (r - L.r) / L.w;
    if (t > -2.5 && t < 2.5) h += w * L.h * Math.exp(-t * t);
  }
  if (wv > 0) {
    const ra = V.r0 + (V.r0Lip - V.r0) * wl;
    const rb = V.r1 + (V.r1Lip - V.r1) * wl;
    const inV = wv * smooth(ra, rb, r) * (1 - smooth(V.rEnd0, V.rEnd1, r));
    if (inV > 0) {
      // Walls may overlap at their azimuthal ends: blend them by their azimuthal weights.
      let cut = 0;
      let lift = 0;
      let wsum = 0;
      for (let i = 0; i < WALLS.length; i++) {
        const W = WALLS[i];
        const ww = azWindow(azDeg, W.az, W.hw, W.fade);
        if (ww <= 0) continue;
        const azR = (azDeg * Math.PI) / 180;
        const rim = W.r + W.wander * wobble(azR + 1.3 * i);
        const rimH = W.rimH + W.rimVar * wobble(4.3 * azR + 2.1 + i);
        const c = smooth(rim - W.width, rim, r);
        // Floor deepening toward the foot of the face; beyond the rim the ground stands at the rim
        // height, with a lit bench just past it (thin bright crest line seen from the valley).
        const moat = W.moat * smooth(rim - W.width - W.moatW, rim - W.width, r) * (1 - c);
        const bench = W.bench * smooth(rim - 2, rim + 6, r) * (1 - smooth(rim + 10, rim + 60, r));
        lift += ww * (c * (V.depth + rimH) + bench - moat);
        cut += ww * c;
        wsum += ww;
      }
      if (wsum > 1) {
        lift /= wsum;
        cut /= wsum;
      }
      h += inV * (-V.depth + lift);
      // Calm valley floor: damp swells / hummocks so the face and the floor stay readable.
      keep = 1 - 0.8 * inV * (1 - cut);
    }
  }
  const wf = azWindow(azDeg, FAR_CALM.az, FAR_CALM.hw, FAR_CALM.fade);
  if (wf > 0) keep = Math.min(keep, 1 - FAR_CALM.strength * wf * smooth(FAR_CALM.r0, FAR_CALM.r1, r));
  out.h = h;
  out.keep = keep;
  return out;
}
