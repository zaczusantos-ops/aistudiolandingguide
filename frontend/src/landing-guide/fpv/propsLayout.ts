import type { SpawnPose } from './types';

/**
 * World layout of the moonbase (metres, -Z = North, azimuth clockwise from North), authored for
 * the illustrative Sun at azimuth ≈ 252°, elevation 10° and composed so that each reference frame
 * of the walk can be framed from some pose (REFERENCE_POSES). Measured scale cues: eye 1.7 m,
 * tanks 1.8 m, hazard containers 2.3 × 1.25 × 1.3 m, ship ≈ 25 m long / 7.5 m tall.
 */

const DEG = Math.PI / 180;

/** Sun azimuth (deg) the layout and REFERENCE_POSES are composed for (default site, illustrative). */
export const LAYOUT_SUN_AZIMUTH_DEG = 252;

/** Horizontal point at `bearingDeg` (clockwise from North/-Z) and `dist` metres from (ox, oz). */
export function polar(bearingDeg: number, dist: number, ox = 0, oz = 0): { x: number; z: number } {
  return { x: ox + Math.sin(bearingDeg * DEG) * dist, z: oz - Math.cos(bearingDeg * DEG) * dist };
}

/** Bearing (deg, clockwise from North) from (fx, fz) to (tx, tz). */
export function bearing(fx: number, fz: number, tx: number, tz: number): number {
  return ((Math.atan2(tx - fx, -(tz - fz)) / DEG) % 360 + 360) % 360;
}

/**
 * The ship cluster (ship and its container/tank groups) is laid out around the origin (the
 * round-3 spawn) and turned by SHIP_CLUSTER_TURN_DEG about it, so that in the ship-side frames
 * (t01, t05, t15–t18.5) the Sun sits ≈ 100° left of the view axis as in the reference (tanks lit
 * on their left edge, terminator ≈ 60 % across) while the sunward frames keep it clear.
 */
export const SHIP_CLUSTER_TURN_DEG = -60;

/**
 * Spawn = reference frame t01 (critic-verified pose): ship ahead, slightly right of centre; rover
 * and the low dark crate row on the left.
 */
export const MOONBASE_SPAWN: SpawnPose = { x: 7, z: 1, yawDeg: 342, pitchDeg: -4 };

/** Point `ahead` metres along a pose's view axis and `right` metres to its right (negative = left). */
export function viewPoint(pose: SpawnPose, ahead: number, right: number): { x: number; z: number } {
  const y = pose.yawDeg * DEG;
  return { x: pose.x + Math.sin(y) * ahead + Math.cos(y) * right, z: pose.z - Math.cos(y) * ahead + Math.sin(y) * right };
}

/** Ship centre and the azimuth of its nose → tail axis (+X local); its +Z flank faces the spawn. */
export const SHIP_CENTER = polar(54.5 + SHIP_CLUSTER_TURN_DEG, 36);
export const SHIP_AXIS_AZ = 130 + SHIP_CLUSTER_TURN_DEG;

/** A point of the ship cluster authored at bearing `bearingDeg` / `dist` from the origin. */
export const clusterPolar = (bearingDeg: number, dist: number) => polar(bearingDeg + SHIP_CLUSTER_TURN_DEG, dist);

/** A ship-side pose authored in the unturned cluster frame, turned with the cluster about the spawn. */
function clusterPose(x: number, z: number, yawDeg: number, pitchDeg: number): SpawnPose {
  const c = Math.cos(SHIP_CLUSTER_TURN_DEG * DEG);
  const s = Math.sin(SHIP_CLUSTER_TURN_DEG * DEG);
  const r = (v: number) => Math.round(v * 100) / 100;
  return { x: r(x * c - z * s), z: r(z * c + x * s), yawDeg: (((yawDeg + SHIP_CLUSTER_TURN_DEG) % 360) + 360) % 360, pitchDeg };
}

/** Ship-local (x along nose → tail, z toward the sunlit flank) → world XZ. */
export function shipLocal(lx: number, lz: number): { x: number; z: number } {
  const yaw = (90 - SHIP_AXIS_AZ) * DEG;
  return {
    x: SHIP_CENTER.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz,
    z: SHIP_CENTER.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz,
  };
}

/**
 * Low row of four dark crates on the left of t01: parked side by side with their short striped
 * ends toward the spawn (two touching pairs), front ends ≈ 9.8 m ahead: at the t01 pose the row is
 * ≈ 100 px tall and runs from x ≈ 490 px out past the left edge, as in the reference.
 */
export const T01_DARK_ROW = { ...viewPoint(MOONBASE_SPAWN, 11.0, -9.85), yawDeg: MOONBASE_SPAWN.yawDeg };
/** Rover 1: ≈ 15 m from the spawn at x ≈ 610 px in t01 (just right of the row), close on the left in t05. */
export const T01_ROVER = { ...polar(MOONBASE_SPAWN.yawDeg - 23.3, 15, MOONBASE_SPAWN.x, MOONBASE_SPAWN.z), yawDeg: 50 };

/**
 * Backlit group toward the Sun (t08, t12, t21, t30): row modules turned to recede to the right
 * in t12 with a light module on top at the back-left, and four tanks in two pairs 8 m beyond.
 * The group and its poses (t12, t21, t30) were shifted together by SUNWARD_SHIFT in round 4 so
 * that the t21/t30 camera stands clear of the t01 dark crate row; their framing is unchanged.
 */
export const SUNWARD_SHIFT = { x: -4, z: 2 };
export const SUNWARD_CRATES = { x: -24 + SUNWARD_SHIFT.x, z: 8 + SUNWARD_SHIFT.z };
export const SUNWARD_TANKS = polar(226, 8.3, SUNWARD_CRATES.x, SUNWARD_CRATES.z);
/**
 * Viewpoint out in the low valley W/SW of the base, on the line through the greenhouse (t47; t37
 * and t39 stand 5 m farther along that line, with the crate behind them): rolling
 * horizon, ground rising on the left, no ship in view. Composed by the terrain (round 4).
 */
export const T47_VIEW: SpawnPose = { x: -73.2, z: 43.2, yawDeg: 240.1, pitchDeg: 0.3 };
/**
 * Lone dark crate with a free top filling the lower-left quarter of t47 (lid's far-right corner
 * ≈ (580, 580) px, near-right corner ≈ (935, 880) px; reference ≈ (620, 610) / (940, 890)).
 */
export const T47_CRATE = { x: -73.96, z: 45.48, yawDeg: 28, scale: 1.3 };
const sunwardPose = (x: number, z: number, yawDeg: number, pitchDeg: number): SpawnPose => ({
  x: Math.round((x + SUNWARD_SHIFT.x) * 100) / 100,
  z: Math.round((z + SUNWARD_SHIFT.z) * 100) / 100,
  yawDeg,
  pitchDeg,
});

/** Viewpoint the second container row is composed around (t41.5, t43). */
export const T41_VIEW: SpawnPose = { x: 70, z: -70, yawDeg: 42, pitchDeg: -3 };
/**
 * Second container row (three modules) seen from T41_VIEW: its near end at x ≈ 1115 px, its far
 * end at x ≈ 1515 px and higher up the knoll's west flank (the knoll is centred ≈ 55 m east).
 */
export const T41_ROW = {
  left: polar(T41_VIEW.yawDeg + 11, 12.5, T41_VIEW.x, T41_VIEW.z),
  right: polar(T41_VIEW.yawDeg + 33, 18, T41_VIEW.x, T41_VIEW.z),
};
/**
 * Four tanks in a tight overlapping line just beyond the row's far end (≈ 220 px wide in t41.5,
 * as in the reference): 0.6 m apart across the view, alternately 0.55 m nearer / farther (local
 * +Z faces the viewpoint) so neighbours overlap on screen without intersecting (0.77 m bodies).
 */
export const T41_TANKS = {
  ...polar(T41_VIEW.yawDeg + 39, 16.5, T41_VIEW.x, T41_VIEW.z),
  yawDeg: 168,
  items: [
    [-0.9, 0.35],
    [-0.3, -0.2],
    [0.3, 0.35],
    [0.9, -0.2],
  ] as [number, number][],
};

/**
 * Greenhouse: far beyond the sunward crest. In the reference it keeps the same bearing (≈ 13–14°
 * left of the Sun) and size in every sunward frame while the nearby groups shift by up to 25°,
 * which only a distant dome reproduces; glass ≈ 160–180 px wide at 1920 × 940 / 60° vFOV.
 */
export const GREENHOUSE_CENTER = polar(238.6, 380);
export const GREENHOUSE_RADIUS = 38;
/**
 * Walk keep-out radius (m) around the greenhouse, as one large circle collider: the dome is
 * scenery for the distance (up close it would turn into a blurry blob), so the walker slides
 * along this circle instead of reaching it. The t37/t39/t47 valley cameras (≈ 290–295 m from
 * the dome) stay reachable just outside it.
 */
export const GREENHOUSE_KEEP_OUT = 280;

/**
 * Poses reproducing the reference frames (round-3 pose table; `?fpvPose=x,z,yaw,pitch`). Sunward
 * yaw/pitch are solved from the Sun's pixel position (azimuth 252°, elevation 10°), ship-side poses
 * from matched ship / tank / container screen points (turned with the ship cluster). t05 keeps
 * the Sun and the ship's head (+21°, ≈ 24 m) where the reference has them; its rover sits ≈ 9 m
 * away instead of ≈ 4.5 m, because rover 1 also has to stand beside the dark crates in t01.
 */
export const REFERENCE_POSES: Record<string, SpawnPose> = {
  t01: { ...MOONBASE_SPAWN },
  t05: { x: 2.7, z: -12.11, yawDeg: 294.1, pitchDeg: -2.4 },
  // From the floor (no raised mound): the reference camera stands a few metres higher, so the
  // backlit group sits higher in frame than in the video — an accepted mismatch.
  t08: sunwardPose(1.63, 8.77, 243.3, -15.5),
  t12: sunwardPose(-5.24, 9.21, 262.2, -2.1),
  t15: clusterPose(8.72, -9.89, 54.3, -0.7),
  t17: clusterPose(13.31, -12.0, 73.7, -3.9),
  't18.5': clusterPose(16.64, -13.15, 70.3, -1.0),
  t21: sunwardPose(-4.34, -3.35, 257.7, -2.6),
  t30: sunwardPose(-4.34, -3.35, 241.6, -4.5),
  t37: { x: -77.5, z: 45.8, yawDeg: 243.15, pitchDeg: -4.95 },
  t39: { x: -77.5, z: 45.8, yawDeg: 254.9, pitchDeg: -7.4 },
  't41.5': { ...T41_VIEW, pitchDeg: -9 },
  t43: { x: 70.5, z: -69.5, yawDeg: 41, pitchDeg: -8 },
  t47: { ...T47_VIEW },
};
