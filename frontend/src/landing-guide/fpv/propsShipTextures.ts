import * as THREE from 'three';
import { makeRng } from './propsGeometry';

/**
 * Ship hull paint maps (canvas, no downloads): a near-white tiling multiplier (average ≈ 0.98, so
 * the material colour sets the lavender-grey paint) with only a few panel seams, faint large-scale
 * tone variation (no grime smudges: the reference hull is clean), plus a matching bump map for the seams. Returns null when a 2D
 * canvas is unavailable (tests, workers) or in low-power mode.
 */

export interface ShipHullMaps {
  map: THREE.Texture;
  bump: THREE.Texture;
}

function canvas2d(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

function texture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function shipHullMaps(lowPower: boolean, seed: number): ShipHullMaps | null {
  if (lowPower) return null;
  const size = 1024;
  const col = canvas2d(size);
  const bmp = canvas2d(size);
  if (!col || !bmp) return null;
  const rand = makeRng(seed);
  const c = col.ctx;
  const b = bmp.ctx;

  c.fillStyle = 'rgb(250,250,250)';
  c.fillRect(0, 0, size, size);
  b.fillStyle = 'rgb(128,128,128)';
  b.fillRect(0, 0, size, size);

  // large soft tone variation between panels (±3 %)
  const cols = [0, 300, 610, 1024];
  const rows = [0, 420, 1024];
  for (let i = 0; i < cols.length - 1; i++)
    for (let j = 0; j < rows.length - 1; j++) {
      const v = 238 + Math.round(rand() * 16);
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(cols[i], rows[j], cols[i + 1] - cols[i], rows[j + 1] - rows[j]);
    }

  // fine speckle
  const img = c.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 7;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  c.putImageData(img, 0, 0);

  // a few panel seams (dark groove + light lip) and matching bump grooves
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    c.strokeStyle = 'rgba(70,68,76,0.55)';
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(x0 + 2, y0 + 2);
    c.lineTo(x1 + 2, y1 + 2);
    c.stroke();
    b.strokeStyle = 'rgb(40,40,40)';
    b.lineWidth = 3;
    b.beginPath();
    b.moveTo(x0, y0);
    b.lineTo(x1, y1);
    b.stroke();
  };
  for (const x of cols.slice(1, -1)) seam(x, 0, x, size);
  for (const y of rows.slice(1, -1)) seam(0, y, size, y);
  // one short access hatch outline
  const hx = 700 + rand() * 120;
  const hy = 560 + rand() * 120;
  seam(hx, hy, hx + 150, hy);
  seam(hx + 150, hy, hx + 150, hy + 110);
  seam(hx + 150, hy + 110, hx, hy + 110);
  seam(hx, hy + 110, hx, hy);

  return { map: texture(col.canvas, true), bump: texture(bmp.canvas, false) };
}
