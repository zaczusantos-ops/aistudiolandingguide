import type { SpawnPose } from './types';

/**
 * Parses `?fpvPose=x,z,yawDeg[,pitchDeg]` (metres / degrees) used for deterministic screenshots.
 * Returns null when the parameter is missing or malformed. Kept free of three.js / WebGL imports
 * so it can be used (and tested) without loading the 3D scene.
 */
export function parseDebugPose(search: string): SpawnPose | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get('fpvPose');
  } catch {
    return null;
  }
  if (!raw || !raw.trim()) return null;
  const parts = raw.split(',').map((v) => (v.trim() === '' ? Number.NaN : Number(v)));
  if (parts.length < 3 || parts.length > 4 || parts.some((v) => !Number.isFinite(v))) return null;
  return { x: parts[0], z: parts[1], yawDeg: parts[2], pitchDeg: parts[3] ?? 0 };
}
