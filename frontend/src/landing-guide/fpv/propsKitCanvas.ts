import * as THREE from 'three';

/**
 * Shared 2D-canvas painting helpers for the procedural prop textures (no downloads). make2d
 * returns null when a 2D canvas is unavailable (jsdom, workers): callers fall back to plain colours.
 */

export type Ctx = CanvasRenderingContext2D;

export function make2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === 'undefined') return null;
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return { canvas, ctx };
  } catch {
    return null;
  }
}

export function toTexture(canvas: HTMLCanvasElement, srgb: boolean, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// painting helpers (all coordinates in a 1024-unit design space; the context is pre-scaled)

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export function speckle(
  ctx: Ctx,
  rand: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  colors: string[],
  alpha: [number, number],
  size: [number, number],
) {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha[0] + rand() * (alpha[1] - alpha[0]);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    const s = size[0] + rand() * (size[1] - size[0]);
    ctx.fillRect(x + rand() * w, y + rand() * h, s, s * (0.5 + rand()));
  }
  ctx.globalAlpha = 1;
}

export function smudges(
  ctx: Ctx,
  rand: () => number,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  rgb: string,
  maxAlpha: number,
  radius: [number, number],
  biasBottom = 0,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  for (let i = 0; i < count; i++) {
    const cx = x + rand() * w;
    const t = biasBottom > 0 ? 1 - Math.pow(rand(), 1 + biasBottom * 2) : rand();
    const cy = y + t * h;
    const r = radius[0] + rand() * (radius[1] - radius[0]);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const a = maxAlpha * (0.3 + rand() * 0.7);
    g.addColorStop(0, `rgba(${rgb},${a.toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  ctx.restore();
}

export function scratches(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, count: number, color: string, alpha: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = alpha * (0.3 + rand() * 0.7);
    ctx.lineWidth = 0.6 + rand() * 1.6;
    const sx = x + rand() * w;
    const sy = y + rand() * h;
    const len = 6 + rand() * 40;
    const ang = rand() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

export function hazardStripes(ctx: Ctx, x: number, y: number, w: number, h: number, stripe: number, a: string, b: string, alongX = false) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = b;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = a;
  const span = w + h;
  for (let s = -span; s < span; s += stripe * 2) {
    ctx.beginPath();
    if (alongX) {
      ctx.moveTo(x + s, y + h);
      ctx.lineTo(x + s + stripe, y + h);
      ctx.lineTo(x + s + stripe + h, y);
      ctx.lineTo(x + s + h, y);
    } else {
      ctx.moveTo(x, y + s);
      ctx.lineTo(x, y + s + stripe);
      ctx.lineTo(x + w, y + s + stripe + w);
      ctx.lineTo(x + w, y + s + w);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Irregular painted band along the inside of a rectangle's border (chipped paint look). */
export function chippedBorder(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, thick: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  const side = (len: number, draw: (t: number, d: number) => [number, number]) => {
    const steps = Math.max(8, Math.round(len / 9));
    ctx.beginPath();
    const [sx0, sy0] = draw(0, 0);
    ctx.moveTo(sx0, sy0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const notch = rand() < 0.12 ? 0.25 : 1;
      const d = thick * notch * (0.55 + rand() * 0.9);
      const [px, py] = draw(t, d);
      ctx.lineTo(px, py);
    }
    const [ex, ey] = draw(1, 0);
    ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();
  };
  side(w, (t, d) => [x + t * w, y + d]);
  side(w, (t, d) => [x + t * w, y + h - d]);
  side(h, (t, d) => [x + d, y + t * h]);
  side(h, (t, d) => [x + w - d, y + t * h]);
  // chips and scuffs near the edges
  for (let i = 0; i < Math.round((w + h) / 14); i++) {
    const edge = Math.floor(rand() * 4);
    const t = rand();
    const d = thick * (0.8 + rand() * 2.2);
    const px = edge === 0 || edge === 1 ? x + t * w : edge === 2 ? x + d : x + w - d;
    const py = edge === 2 || edge === 3 ? y + t * h : edge === 0 ? y + d : y + h - d;
    const r = 1.5 + rand() * thick * 0.45;
    ctx.globalAlpha = 0.5 + rand() * 0.5;
    ctx.beginPath();
    ctx.ellipse(px, py, r * (0.6 + rand()), r * (0.4 + rand() * 0.8), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export function textLines(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, n: number, color: string) {
  ctx.fillStyle = color;
  const lh = h / n;
  for (let i = 0; i < n; i++) {
    let cx = x;
    const end = x + w * (0.55 + rand() * 0.45);
    while (cx < end) {
      const word = 6 + rand() * 26;
      ctx.fillRect(cx, y + i * lh + lh * 0.2, Math.min(word, end - cx), lh * 0.55);
      cx += word + 4 + rand() * 4;
    }
  }
}

/** Yellow warning label with red header band and grungy text (white containers, t18.5). */
export function warningLabel(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number) {
  rect(ctx, x - 3, y - 3, w + 6, h + 6, '#5b5a55');
  rect(ctx, x, y, w, h, '#e4cb52');
  rect(ctx, x, y, w, h * 0.13, '#c8372d');
  rect(ctx, x, y + h * 0.13, w, h * 0.03, '#f4e7a0');
  textLines(ctx, rand, x + w * 0.07, y + h * 0.22, w * 0.86, h * 0.7, 6, '#2b2620');
  speckle(ctx, rand, x, y, w, h, 260, ['#ffffff', '#f2f0e0', '#3a352c'], [0.25, 0.8], [1, 4]);
  smudges(ctx, rand, x, y, w, h, 6, '70,60,40', 0.35, [8, 30]);
}

/** Small white "danger" sticker with a yellow triangle (dark crates, f_041). */
export function dangerSticker(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number) {
  rect(ctx, x, y, w, h, '#e9e9e4');
  ctx.fillStyle = '#e1c13d';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  const tx = x + h * 0.15;
  const ts = h * 0.72;
  ctx.beginPath();
  ctx.moveTo(tx + ts / 2, y + h * 0.12);
  ctx.lineTo(tx + ts, y + h * 0.12 + ts);
  ctx.lineTo(tx, y + h * 0.12 + ts);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  rect(ctx, tx + ts / 2 - 2, y + h * 0.35, 4, ts * 0.35, '#1a1a1a');
  textLines(ctx, rand, x + h * 1.05, y + h * 0.18, w - h * 1.2, h * 0.65, 3, '#1c1c1c');
  speckle(ctx, rand, x, y, w, h, 60, ['#8a8a85', '#ffffff'], [0.2, 0.6], [1, 3]);
}

export function bevelFrame(ctx: Ctx, x: number, y: number, w: number, h: number, dark: string, light: string, width: number) {
  ctx.lineWidth = width;
  ctx.strokeStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.strokeStyle = light;
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.stroke();
}

export function baseFill(ctx: Ctx, rand: () => number, x: number, y: number, w: number, h: number, base: string, light: string, dark: string, density = 1) {
  rect(ctx, x, y, w, h, base);
  speckle(ctx, rand, x, y, w, h, Math.round(w * h * 0.004 * density), [light, dark], [0.04, 0.14], [1, 5]);
  smudges(ctx, rand, x, y, w, h, Math.round(8 * density), dark === '#000000' ? '0,0,0' : '90,90,90', 0.05, [30, 120]);
}
