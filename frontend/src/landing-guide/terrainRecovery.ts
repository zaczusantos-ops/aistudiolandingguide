import * as THREE from 'three';

/** Display terrain only. These rasters never enter the Sun/Earth geometry model. */
export interface PackedElevationRaster { width: number; height: number; data: Uint8ClampedArray }
export interface TerrainRasters { global: PackedElevationRaster; south?: PackedElevationRaster }
interface AsyncTerrainWork { cancelled?: () => boolean; yieldControl?: () => Promise<void> }
const DEG = Math.PI / 180;
const POLAR_SPAN = (1024 * 593.75) / (2 * 1_737_400);
const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function decodePackedHeightKm(red: number, green: number): number {
  return -9.5 + ((red * 256 + green) / 65535) * 20.5;
}

/** Original viewport exaggeration (~4.07× vertical scale), solely for display. */
export function terrainRadius(heightKm: number): number {
  return 1 + clamp((heightKm + 9.5) / 20.5, 0, 1) * 0.048 - 0.024;
}

function sample(raster: PackedElevationRaster, x: number, y: number, wrap: boolean): number {
  const { width, height, data } = raster;
  const row = clamp(y, 0, height - 1);
  const column = wrap ? ((x % width) + width) % width : clamp(x, 0, width - 1);
  const x0 = Math.floor(column), y0 = Math.floor(row);
  const x1 = wrap ? (x0 + 1) % width : Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const fx = column - x0, fy = row - y0;
  const heightAt = (px: number, py: number) => {
    const index = (py * width + px) * 4;
    return decodePackedHeightKm(data[index], data[index + 1]);
  };
  return (heightAt(x0, y0) * (1 - fx) + heightAt(x1, y0) * fx) * (1 - fy)
    + (heightAt(x0, y1) * (1 - fx) + heightAt(x1, y1) * fx) * fy;
}

/** Native NASA global mosaic / LOLA south stereographic registration. */
export function sampleTerrainHeightKm(rasters: TerrainRasters, latDeg: number, lonEastDeg: number): number {
  const lon = ((lonEastDeg + 180) % 360 + 360) % 360;
  const global = sample(rasters.global, lon / 360 * rasters.global.width - 0.5, (90 - latDeg) / 180 * rasters.global.height - 0.5, true);
  if (!rasters.south || latDeg > -80.1) return global;
  const lat = latDeg * DEG, lam = lonEastDeg * DEG;
  const distance = Math.tan((lat + Math.PI / 2) / 2);
  const u = 0.5 + distance * Math.sin(lam) / POLAR_SPAN;
  const v = 0.5 - distance * Math.cos(lam) / POLAR_SPAN;
  const south = sample(rasters.south, u * rasters.south.width - 0.5, v * rasters.south.height - 0.5, false);
  const t = clamp((-80.1 - latDeg) / 1.3, 0, 1);
  const weight = t * t * (3 - 2 * t);
  return global * (1 - weight) + south * weight;
}

export function yieldForMoonTerrain(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 80 });
    else setTimeout(resolve, 0);
  });
}

/** Read small stripes after first paint instead of deriving nine full atlases. */
export async function readPackedElevationRaster(image: HTMLImageElement, work: AsyncTerrainWork = {}): Promise<PackedElevationRaster | null> {
  const yieldControl = work.yieldControl ?? yieldForMoonTerrain;
  await yieldControl();
  if (work.cancelled?.()) return null;
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error('Elevation image has no pixels.');
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = Math.min(64, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Elevation image could not be read.');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += canvas.height) {
    if (work.cancelled?.()) return null;
    const rows = Math.min(canvas.height, height - row);
    context.clearRect(0, 0, width, canvas.height);
    context.drawImage(image, 0, row, width, rows, 0, 0, width, rows);
    data.set(context.getImageData(0, 0, width, rows).data, row * width * 4);
    await yieldControl();
  }
  return { width, height, data };
}

/**
 * Build the real displaced picking surface without holding the main thread for
 * an atlas/icosphere pass. The visible coarse Moon is replaced only on success.
 */
export async function buildDisplacedMoonGeometry({ rasters, widthSegments, heightSegments, cancelled, yieldControl = yieldForMoonTerrain }: {
  rasters: TerrainRasters; widthSegments: number; heightSegments: number;
} & AsyncTerrainWork): Promise<THREE.BufferGeometry | null> {
  await yieldControl();
  if (cancelled?.()) return null;
  const width = Math.max(8, Math.floor(widthSegments)), height = Math.max(4, Math.floor(heightSegments));
  const columns = width + 1, count = columns * (height + 1);
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
  const indices = new (count > 65535 ? Uint32Array : Uint16Array)(width * (height - 1) * 6);
  let start = performance.now(), items = 0;
  const checkpoint = async () => {
    if (++items < 512 && performance.now() - start < 4) return false;
    await yieldControl(); items = 0; start = performance.now();
    return cancelled?.() ?? false;
  };
  for (let row = 0; row <= height; row++) for (let col = 0; col <= width; col++) {
    const i = row * columns + col, lat = 90 - row / height * 180, lon = col / width * 360;
    const radius = terrainRadius(sampleTerrainHeightKm(rasters, lat, lon));
    const cosLat = Math.cos(lat * DEG);
    positions[i * 3] = -cosLat * Math.cos(lon * DEG) * radius;
    positions[i * 3 + 1] = Math.sin(lat * DEG) * radius;
    positions[i * 3 + 2] = cosLat * Math.sin(lon * DEG) * radius;
    uvs[i * 2] = col / width + 0.5;
    uvs[i * 2 + 1] = 1 - row / height;
    if (await checkpoint()) return null;
  }
  let offset = 0;
  const triangle = (a: number, b: number, c: number) => {
    indices[offset++] = a; indices[offset++] = b; indices[offset++] = c;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const index of [a, b, c]) { normals[index * 3] += nx; normals[index * 3 + 1] += ny; normals[index * 3 + 2] += nz; }
  };
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const a = row * columns + col + 1, b = a - 1, c = (row + 1) * columns + col, d = c + 1;
    if (row !== 0) triangle(a, b, d);
    if (row !== height - 1) triangle(b, c, d);
    if (await checkpoint()) return null;
  }
  // UV seam duplicates share normals; poles keep a radial, singularity-free normal.
  for (let row = 1; row < height; row++) {
    const first = row * columns * 3, last = (row * columns + width) * 3;
    for (let axis = 0; axis < 3; axis++) normals[first + axis] = normals[last + axis] = normals[first + axis] + normals[last + axis];
  }
  for (let i = 0; i < count; i++) {
    if (i < columns || i >= count - columns) { normals[i * 3] = 0; normals[i * 3 + 1] = i < columns ? 1 : -1; normals[i * 3 + 2] = 0; }
    const length = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
    normals[i * 3] /= length; normals[i * 3 + 1] /= length; normals[i * 3 + 2] /= length;
    if (await checkpoint()) return null;
  }
  if (cancelled?.()) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.025);
  return geometry;
}
