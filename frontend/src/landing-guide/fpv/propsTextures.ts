import * as THREE from 'three';
import { makeRng } from './propsGeometry';
import { make2d, rect, scratches, smudges, speckle, toTexture } from './propsKitCanvas';
import { TANK_PROFILE, TANK_UV_HEIGHT } from './propsTanks';

/**
 * Procedural canvas textures for the moonbase props (no downloads). Every generator returns
 * null when a 2D canvas is unavailable (jsdom, workers): callers fall back to plain colours.
 * The crate atlases live in propsKitPaint.ts; generic painting helpers in propsKitCanvas.ts.
 */

export { make2d } from './propsKitCanvas';
export { crateAtlas, crateMaps } from './propsKitPaint';

export type CrateStyle = 'hazard' | 'row' | 'dark';

// ---------------------------------------------------------------------------------------------
// ship hull panels: tiling greyscale (multiplies the lavender paint) + matching bump map.

export interface PanelMaps {
  map: THREE.Texture;
  bump: THREE.Texture;
}

export function hullPanelMaps(lowPower: boolean, seed: number): PanelMaps | null {
  const size = lowPower ? 512 : 1024;
  const col = make2d(size, size);
  const bmp = make2d(size, size);
  if (!col || !bmp) return null;
  const s = size / 1024;
  col.ctx.scale(s, s);
  bmp.ctx.scale(s, s);
  const rand = makeRng(seed);
  const C = col.ctx;
  const B = bmp.ctx;
  rect(C, 0, 0, 1024, 1024, '#ececec');
  rect(B, 0, 0, 1024, 1024, '#9a9a9a');

  // recursive panel subdivision of the tile (tile = 8 m, so 128 units per metre)
  const panels: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    const canSplitX = w > 300;
    const canSplitY = h > 300;
    if (depth > 4 || (!canSplitX && !canSplitY) || (depth > 1 && rand() < 0.22)) {
      panels.push([x, y, w, h]);
      return;
    }
    const horiz = canSplitX && (!canSplitY || w > h * (0.8 + rand() * 0.6));
    const t = 0.3 + rand() * 0.4;
    if (horiz) {
      const cut = Math.round((w * t) / 32) * 32;
      split(x, y, cut, h, depth + 1);
      split(x + cut, y, w - cut, h, depth + 1);
    } else {
      const cut = Math.round((h * t) / 32) * 32;
      split(x, y, w, cut, depth + 1);
      split(x, y + cut, w, h - cut, depth + 1);
    }
  };
  split(0, 0, 1024, 1024, 0);
  for (const [x, y, w, h] of panels) {
    const v = 226 + Math.floor(rand() * 24);
    rect(C, x, y, w, h, `rgb(${v},${v},${v})`);
    const b = 150 + Math.floor(rand() * 10);
    rect(B, x, y, w, h, `rgb(${b},${b},${b})`);
    if (rand() < 0.12) {
      // inset hatch / access plate
      const iw = w * (0.25 + rand() * 0.35);
      const ih = h * (0.2 + rand() * 0.3);
      const ix = x + (w - iw) * rand();
      const iy = y + (h - ih) * rand();
      C.strokeStyle = 'rgba(70,70,78,0.55)';
      C.lineWidth = 3;
      C.strokeRect(ix, iy, iw, ih);
      B.strokeStyle = '#4a4a4a';
      B.lineWidth = 4;
      B.strokeRect(ix, iy, iw, ih);
    }
    if (rand() < 0.12) {
      // rivet rows
      const n = Math.max(3, Math.floor(w / 40));
      for (let i = 0; i < n; i++) {
        rect(C, x + 14 + i * ((w - 28) / n), y + 12, 4, 4, 'rgba(90,90,98,0.6)');
        rect(B, x + 14 + i * ((w - 28) / n), y + 12, 4, 4, '#c8c8c8');
      }
    }
  }
  // seams: dark groove + light lip
  for (const [x, y, w, h] of panels) {
    C.strokeStyle = 'rgba(52,52,60,0.9)';
    C.lineWidth = 4;
    C.strokeRect(x + 1, y + 1, w - 2, h - 2);
    C.strokeStyle = 'rgba(255,255,255,0.5)';
    C.lineWidth = 2;
    C.beginPath();
    C.moveTo(x + 5, y + h - 4);
    C.lineTo(x + 5, y + 5);
    C.lineTo(x + w - 4, y + 5);
    C.stroke();
    B.strokeStyle = '#000000';
    B.lineWidth = 7;
    B.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  speckle(C, rand, 0, 0, 1024, 1024, 5000, ['#ffffff', '#7a7a84'], [0.03, 0.1], [1, 4]);
  smudges(C, rand, 0, 0, 1024, 1024, 26, '70,70,80', 0.07, [40, 200]);
  scratches(C, rand, 0, 0, 1024, 1024, 80, '#6d6d76', 0.25);
  return { map: toTexture(col.canvas, true, true), bump: toTexture(bmp.canvas, false, true) };
}

/**
 * Tank paint detail (multiplies the lavender paint). u runs around the tank, v = height /
 * TANK_UV_HEIGHT (see propsTanks.ts): small dark notches on the foot ring, faint dirt streaks
 * rising from the ground, a seam line on the cone cap. Mostly white so the paint colour shows.
 */
export function tankDetailMap(lowPower: boolean, seed: number): THREE.Texture | null {
  const size = lowPower ? 256 : 512;
  const c = make2d(size, size);
  if (!c) return null;
  const { canvas, ctx } = c;
  ctx.scale(size / 512, size / 512);
  const rand = makeRng(seed);
  const Y = (m: number) => (1 - m / TANK_UV_HEIGHT) * 512;
  rect(ctx, 0, 0, 512, 512, '#f6eff6');
  // dirt streaks fading upward from the foot
  for (let i = 0; i < 60; i++) {
    const x = rand() * 512;
    const w = 2 + rand() * 9;
    const top = Y(0.25 + rand() * 0.9);
    const g = ctx.createLinearGradient(0, top, 0, Y(0));
    const a = 0.03 + rand() * 0.06;
    g.addColorStop(0, 'rgba(90,86,92,0)');
    g.addColorStop(1, `rgba(90,86,92,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, top, w, Y(0) - top);
  }
  speckle(ctx, rand, 0, 0, 512, 512, 700, ['#ffffff', '#8a8792'], [0.03, 0.08], [1, 3]);
  // foot ring notches (t18.5)
  for (let k = 0; k < 14; k++) {
    const x = (k / 14) * 512 + 8;
    rect(ctx, x, Y(TANK_PROFILE.footTop - 0.012), 7, Y(0.018) - Y(TANK_PROFILE.footTop - 0.012), '#3a383d');
  }
  // seam line on the cone and a soft shade under the collar lip
  rect(ctx, 0, Y(TANK_PROFILE.collarTop + 0.09), 512, 2, 'rgba(70,68,76,0.55)');
  rect(ctx, 0, Y(TANK_PROFILE.bandTop + 0.004), 512, 3, 'rgba(70,68,76,0.35)');
  return toTexture(canvas, true, true);
}
