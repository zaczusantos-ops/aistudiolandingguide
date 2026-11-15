import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Small procedural-modelling toolkit for the moonbase props: convex "hull pieces" with flat
 * normals, box-projected UVs, per-vertex colours and merging into a few draw calls.
 */

export const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convex hull of the points as a non-indexed geometry with flat normals. */
export function hull(points: THREE.Vector3[]): THREE.BufferGeometry {
  return new ConvexGeometry(points);
}

/** Axis-aligned box (min/max corners) with optional uniform chamfer on every edge. */
export function chamferBox(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  c = 0,
): THREE.BufferGeometry {
  if (c <= 0) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    g.deleteAttribute('uv');
    return g;
  }
  const cc = Math.min(c, (x1 - x0) * 0.45, (y1 - y0) * 0.45, (z1 - z0) * 0.45);
  const pts: THREE.Vector3[] = [];
  for (const x of [x0, x1])
    for (const y of [y0, y1])
      for (const z of [z0, z1]) {
        const sx = x === x0 ? 1 : -1;
        const sy = y === y0 ? 1 : -1;
        const sz = z === z0 ? 1 : -1;
        pts.push(V(x, y + sy * cc, z + sz * cc), V(x + sx * cc, y, z + sz * cc), V(x + sx * cc, y + sy * cc, z));
      }
  return hull(pts);
}

/** Box oriented from p0 to p1 (a beam / strut) with square section `t`. */
export function beam(p0: THREE.Vector3, p1: THREE.Vector3, t: number, t2 = t): THREE.BufferGeometry {
  const len = p0.distanceTo(p1);
  const g = new THREE.BoxGeometry(t, t2, len).toNonIndexed();
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().lookAt(p0, p1, Math.abs(p1.y - p0.y) > len * 0.99 ? V(1, 0, 0) : V(0, 1, 0));
  m.setPosition(p0.clone().add(p1).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** Cylinder along Y between y0 and y1 (non-indexed, no uv). */
export function cylinderY(
  x: number,
  z: number,
  y0: number,
  y1: number,
  r: number,
  seg = 12,
  rTop = r,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, y1 - y0, seg, 1).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

export type UVMapper = (p: THREE.Vector3, n: THREE.Vector3, axis: number, sign: number) => [number, number];

/** Assigns UVs per triangle from its face normal (box projection) using `mapper`. */
export function applyUV(geo: THREE.BufferGeometry, mapper: UVMapper): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(c.sub(a));
    if (n.lengthSq() < 1e-14) n.set(0, 1, 0);
    n.normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const axis = ax > ay + 1e-4 && ax >= az ? 0 : ay >= az ? 1 : 2;
    const sign = (axis === 0 ? n.x : axis === 1 ? n.y : n.z) >= 0 ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      p.fromBufferAttribute(pos, i + k);
      const [u, v] = mapper(p, n, axis, sign);
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** World-scaled triplanar-style box UVs (1 UV unit = `metresPerTile` metres). */
export function worldUV(metresPerTile: number, offset = 0): UVMapper {
  const s = 1 / metresPerTile;
  return (p, _n, axis, sign) => {
    if (axis === 0) return [(sign > 0 ? -p.z : p.z) * s + offset, p.y * s];
    if (axis === 1) return [p.x * s + offset, p.z * s];
    return [(sign > 0 ? p.x : -p.x) * s + offset, p.y * s];
  };
}

/** Constant UV (samples a single texel area), useful for parts that should not show detail. */
export function constUV(u: number, v: number): UVMapper {
  return () => [u, v];
}

/** Adds a constant per-vertex colour attribute. */
export function colorize(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const col = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * Merges geometries into one, normalising them to non-indexed position/normal(/uv/color).
 * Missing uv/color attributes are filled so every part can share one material.
 */
export function mergeAll(parts: THREE.BufferGeometry[], opts: { uv?: boolean; color?: boolean } = {}): THREE.BufferGeometry {
  const wantUV = opts.uv ?? true;
  const wantColor = opts.color ?? false;
  const norm = parts.map((p) => {
    let g = p.index ? p.toNonIndexed() : p;
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const count = g.getAttribute('position').count;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    if (wantUV && !g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    if (!wantUV && g.getAttribute('uv')) g.deleteAttribute('uv');
    if (wantColor && !g.getAttribute('color')) g = colorize(g, 0xffffff);
    if (!wantColor && g.getAttribute('color')) g.deleteAttribute('color');
    g.morphAttributes = {};
    return g;
  });
  const merged = mergeGeometries(norm, false);
  if (!merged) throw new Error('moonbase: geometry merge failed');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  for (const p of parts) p.dispose();
  for (const p of norm) p.dispose();
  return merged;
}

export interface GroundFrameOpts {
  heightAt(x: number, z: number): number;
  x: number;
  z: number;
  /** Heading of the object's local +X axis, degrees clockwise from North (-Z). */
  yawDeg: number;
  halfX: number;
  halfZ: number;
  /** Metres to bury the object below the fitted plane. */
  sink?: number;
  /** Max tilt (rad). 0 keeps the object level and rests it on the lowest sample. */
  maxTilt?: number;
  /** Extra samples along X used to detect dips under long footprints (default 2 = corners only). */
  nx?: number;
}

const DEG = Math.PI / 180;

/** Rotation around Y that maps local +X onto the horizontal direction at azimuth `azDeg`. */
export function yawForAzimuth(azDeg: number): number {
  return (90 - azDeg) * DEG;
}

/**
 * Builds a placement matrix resting a footprint on the terrain: samples the four corners and
 * centre, fits a plane (optionally tilting the object to follow the slope) and sinks it a little
 * so that no corner floats.
 */
export function groundFrame(o: GroundFrameOpts): THREE.Matrix4 {
  const yaw = yawForAzimuth(o.yawDeg);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // local (lx, lz) -> world: x = lx*cos + lz*sin, z = -lx*sin + lz*cos
  const sample = (lx: number, lz: number) => o.heightAt(o.x + lx * cos + lz * sin, o.z - lx * sin + lz * cos);
  const hpp = sample(o.halfX, o.halfZ);
  const hpm = sample(o.halfX, -o.halfZ);
  const hmp = sample(-o.halfX, o.halfZ);
  const hmm = sample(-o.halfX, -o.halfZ);
  const hc = sample(0, 0);
  const maxTilt = o.maxTilt ?? 0.12;
  const sink = o.sink ?? 0.05;
  const nx = Math.max(2, Math.round(o.nx ?? 2));
  const m = new THREE.Matrix4();
  if (maxTilt <= 0) {
    let y = Math.min(hpp, hpm, hmp, hmm, hc);
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= 2; j++) y = Math.min(y, sample(-o.halfX + (2 * o.halfX * i) / nx, -o.halfZ + o.halfZ * j));
    m.makeRotationY(yaw).setPosition(o.x, y - sink, o.z);
    return m;
  }
  let gx = (hpp + hpm - hmp - hmm) / (4 * Math.max(o.halfX, 1e-3));
  let gz = (hpp + hmp - hpm - hmm) / (4 * Math.max(o.halfZ, 1e-3));
  const lim = Math.tan(maxTilt);
  gx = THREE.MathUtils.clamp(gx, -lim, lim);
  gz = THREE.MathUtils.clamp(gz, -lim, lim);
  const mean = (hpp + hpm + hmp + hmm + hc) / 5;
  // Lowest residual of the samples below the plane decides the extra sink.
  let res = hc - mean;
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= 2; j++) {
      const lx = -o.halfX + (2 * o.halfX * i) / nx;
      const lz = -o.halfZ + o.halfZ * j;
      res = Math.min(res, sample(lx, lz) - (mean + gx * lx + gz * lz));
    }
  const ax = V(1, gx, 0).normalize();
  const azv = V(0, gz, 1).normalize();
  const ay = new THREE.Vector3().crossVectors(azv, ax).normalize();
  azv.crossVectors(ax, ay).normalize();
  const basis = new THREE.Matrix4().makeBasis(ax, ay, azv);
  m.makeRotationY(yaw).multiply(basis);
  m.setPosition(o.x, mean + Math.min(0, res) - sink, o.z);
  return m;
}
