import * as THREE from 'three';
import { atlasPx, CRATE_SPECS, containerLayout, moduleLayout, type ContainerLayout, type ModuleLayout } from './propsCrates';
import { makeRng } from './propsGeometry';
import {
  type Ctx,
  dangerSticker,
  make2d,
  rect,
  roundRectPath,
  scratches,
  smudges,
  speckle,
  textLines,
  toTexture,
} from './propsKitCanvas';
import type { CrateStyle } from './propsTextures';

/**
 * Crate atlases painted from the same layout numbers the geometry is built from (propsCrates.ts),
 * so painted stripes, labels, frames and recess shading line up with the real relief.
 *
 * Atlas layout (1024 design units, canvas y down):
 *   FRONT  (0,0)-(1024,512)      long faces (±Z)        — region top = crate top (incl. rim)
 *   END    (0,512)-(512,1024)    short faces (±X)
 *   TOP    (512,512)-(1024,768)  upward faces           — region left = -X, region top = -Z
 *   BOTTOM (512,768)-(1024,1024) downward faces
 * Optional bump atlas with the same layout (seams, engraving, scratches, label edges).
 */

interface Painter {
  c: Ctx;
  /** Bump canvas (mid grey = flat) or null. */
  b: Ctx | null;
  /** Sheen mask canvas (black = none, white = dusty sheen) or null; same 1024-unit layout. */
  s: Ctx | null;
  rand: () => number;
  /** Areas (design units) whose detail fades out in the coarse mip levels, with the fade colour. */
  fades: { x: number; y: number; w: number; h: number; color: string }[];
}

type Pt = [number, number];

function poly(ctx: Ctx, pts: Pt[], fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, width: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function clipRect(ctx: Ctx, x: number, y: number, w: number, h: number, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  draw();
  ctx.restore();
}

/** Base colour + very fine low-contrast grain + broad soft mottling (no bright specks). */
function surface(p: Painter, x: number, y: number, w: number, h: number, base: string, grainRgb: string, mottle = 0.05) {
  rect(p.c, x, y, w, h, base);
  const n = Math.round(w * h * 0.006);
  speckle(p.c, p.rand, x, y, w, h, n, [`rgb(${grainRgb})`], [0.03, 0.08], [1, 3]);
  smudges(p.c, p.rand, x, y, w, h, Math.max(3, Math.round((w * h) / 9000)), grainRgb, mottle, [24, 90]);
}

/** A band along one edge of a rectangle whose inner boundary is ragged (worn paint edge). */
function wornBand(p: Painter, x: number, y: number, w: number, h: number, side: 'top' | 'bottom' | 'left' | 'right', thick: number, color: string) {
  const { c, rand } = p;
  const horizontal = side === 'top' || side === 'bottom';
  const len = horizontal ? w : h;
  const pts: Pt[] = [];
  const at = (t: number, dd: number): Pt => {
    if (side === 'top') return [x + t * w, y + dd];
    if (side === 'bottom') return [x + t * w, y + h - dd];
    if (side === 'left') return [x + dd, y + t * h];
    return [x + w - dd, y + t * h];
  };
  pts.push(at(0, 0));
  // smooth two-octave value noise for the ragged inner edge (chipped paint, not spikes)
  const lattice = (n: number) => Array.from({ length: n + 2 }, () => rand() * 2 - 1);
  const n1 = lattice(Math.ceil(len / 46));
  const n2 = lattice(Math.ceil(len / 13));
  const sample = (arr: number[], t: number) => {
    const f = t * (arr.length - 2);
    const i = Math.floor(f);
    const u = f - i;
    const s = u * u * (3 - 2 * u);
    return arr[i] * (1 - s) + arr[i + 1] * s;
  };
  const steps = Math.max(8, Math.round(len / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const dd = thick * Math.max(0.35, 1 + 0.4 * sample(n1, t) + 0.18 * sample(n2, t));
    pts.push(at(t, dd));
  }
  pts.push(at(1, 0));
  poly(c, pts, color);
  // a few detached chips just inside the band
  c.fillStyle = color;
  for (let i = 0; i < Math.round(len / 48); i++) {
    const t = rand();
    const [px, py] = at(t, thick * (1.3 + rand() * 0.9));
    const r = 0.6 + rand() * Math.min(4, thick * 0.3);
    c.globalAlpha = 0.5 + rand() * 0.5;
    c.beginPath();
    c.ellipse(px, py, r * (0.6 + rand()), r * (0.4 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

/** Irregular paint chips (small jagged polygons) scattered in a rectangle, denser toward `bias` edges. */
function chips(p: Painter, x: number, y: number, w: number, h: number, n: number, color: string, size: [number, number], alpha: [number, number] = [0.6, 0.95]) {
  const { c, rand } = p;
  clipRect(c, x, y, w, h, () => {
    for (let i = 0; i < n; i++) {
      const cx = x + rand() * w;
      const cy = y + rand() * h;
      const r = size[0] + rand() * (size[1] - size[0]);
      const k = 5 + Math.floor(rand() * 4);
      const pts: Pt[] = [];
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2;
        const rr = r * (0.45 + rand() * 0.75);
        pts.push([cx + Math.cos(a) * rr * (1 + rand() * 0.6), cy + Math.sin(a) * rr * 0.7]);
      }
      c.globalAlpha = alpha[0] + rand() * (alpha[1] - alpha[0]);
      poly(c, pts, color);
    }
    c.globalAlpha = 1;
  });
}

/** Diagonal hazard stripes with worn, chipped edges and grime (alongY: stripes run across a vertical strip). */
function wornStripes(p: Painter, x: number, y: number, w: number, h: number, period: number, a: string, b: string, wearRgb: string, wear = 1) {
  const { c, rand } = p;
  clipRect(c, x, y, w, h, () => {
    rect(c, x, y, w, h, b);
    const span = w + h;
    for (let s = -span; s < span; s += period) {
      const j = (rand() - 0.5) * period * 0.08;
      poly(c, [
        [x, y + s + j],
        [x, y + s + period * 0.5 + j],
        [x + w, y + s + period * 0.5 - w * 0.9 + j],
        [x + w, y + s - w * 0.9 + j],
      ], a);
    }
    // wear: chips of the under-colour and dirt
    speckle(c, rand, x, y, w, h, Math.round(w * h * 0.02 * wear), [`rgb(${wearRgb})`], [0.25, 0.7], [1, 4]);
    smudges(c, rand, x, y, w, h, Math.round(4 + h / 40), wearRgb, 0.22 * wear, [6, 22], 0.6);
  });
}

function aoFrame(c: Ctx, x: number, y: number, w: number, h: number, dark: string, light: string, width: number, alpha = 0.6) {
  line(c, x, y + h, x, y, dark, width, alpha);
  line(c, x, y, x + w, y, dark, width, alpha);
  line(c, x + w, y, x + w, y + h, light, width * 0.8, alpha * 0.8);
  line(c, x, y + h, x + w, y + h, light, width * 0.8, alpha * 0.8);
}

/** Bump helpers: grooves dark, raised light, base mid grey. */
function bumpRect(p: Painter, x: number, y: number, w: number, h: number, v: number) {
  if (p.b) rect(p.b, x, y, w, h, `rgb(${v},${v},${v})`);
}
function bumpLine(p: Painter, x0: number, y0: number, x1: number, y1: number, v: number, width: number) {
  if (p.b) line(p.b, x0, y0, x1, y1, `rgb(${v},${v},${v})`, width);
}
function bumpScratches(p: Painter, x: number, y: number, w: number, h: number, n: number) {
  if (p.b) scratches(p.b, p.rand, x, y, w, h, n, '#5a5a5a', 0.6);
}

// ---------------------------------------------------------------------------------------------
// palettes (albedo; the screen colour targets are measured on the reference, see report)

interface ContainerPalette {
  body: string;
  bodyGrain: string;
  recess: string;
  block: string;
  seam: string;
  edge: string;
  grime: string;
  stripeA: string;
  stripeB: string;
  stripeWear: string;
  endBody: string;
  endRecess: string;
  endEdge: string;
  bar: string;
  rimTop: string;
  topInner: string;
  slot: string;
  base: string;
  lid: string;
  /** Colour the stripe channels fade to at distance (coarse mips); null = natural average. */
  fade: string | null;
  dark: boolean;
}

/** Dark metal showing through chipped white paint. */
const CHIP = '#2e2a2b';

const HAZARD: ContainerPalette = {
  body: '#f5eef3',
  bodyGrain: '118,112,116',
  recess: '#ebe4e9',
  block: '#f4edf2',
  seam: '#6a6365',
  edge: '#fbf8f8',
  grime: '108,102,106',
  stripeA: '#f4e8b0',
  stripeB: '#cbc5cb',
  stripeWear: '246,242,242',
  endBody: '#38373a',
  endRecess: '#28272a',
  endEdge: '#e2dcdd',
  bar: '#48474b',
  rimTop: '#f7f2f4',
  topInner: '#ede7e9',
  slot: '#29282b',
  base: '#3c3a3b',
  lid: '#ede7e8',
  fade: null,
  dark: false,
};

// The renderer's tone-map toe (~ -0.04 linear) crushes very dark albedos to pure black, so the
// "black" paint is a dark warm grey that lands near the reference's (24,19,17) when lit.
const DARK: ContainerPalette = {
  body: '#4d4b4a',
  bodyGrain: '30,28,28',
  recess: '#403e3d',
  block: '#504d4c',
  seam: '#201d1c',
  edge: '#ecebea',
  grime: '150,146,144',
  stripeA: '#ead49c',
  stripeB: '#3e3836',
  stripeWear: '70,64,60',
  endBody: '#454342',
  endRecess: '#383635',
  endEdge: '#e4e1de',
  bar: '#4c4948',
  rimTop: '#454342',
  topInner: '#3e3c3b',
  slot: '#1a1817',
  base: '#2a2625',
  lid: '#efeef1',
  fade: '#57524b',
  dark: true,
};

// ---------------------------------------------------------------------------------------------
// hazard / dark container

function warningLabel(p: Painter, x: number, y: number, w: number, h: number) {
  const { c, rand } = p;
  rect(c, x - 2, y - 2, w + 4, h + 4, '#6b6462');
  rect(c, x, y, w, h, '#f7edc9');
  rect(c, x, y, w, h * 0.1, '#d8695f');
  rect(c, x, y + h * 0.1, w, h * 0.025, '#f6edc8');
  textLines(c, rand, x + w * 0.06, y + h * 0.22, w * 0.88, h * 0.7, 7, '#2a241e');
  // heavy black wear blotches like the reference labels
  clipRect(c, x, y, w, h, () => {
    for (let i = 0; i < 52; i++) {
      c.globalAlpha = 0.3 + rand() * 0.6;
      c.fillStyle = rand() < 0.7 ? '#1d1a17' : '#f7f1dc';
      const bw = 4 + rand() * w * 0.3;
      const bh = 1.5 + rand() * 7;
      c.fillRect(x + rand() * w, y + h * 0.15 + rand() * h * 0.85, bw, bh);
    }
    c.globalAlpha = 1;
    smudges(c, rand, x, y, w, h, 6, '60,50,35', 0.3, [6, 22]);
  });
  bumpRect(p, x - 2, y - 2, w + 4, h + 4, 140);
}

function cornerMarks(p: Painter, x0: number, x1: number, y0: number, y1: number, color: string) {
  // small engraved angle marks near the top and bottom of a corner block (t18.5)
  const w = x1 - x0;
  const h = y1 - y0;
  for (const yy of [y0 + h * 0.12, y1 - h * 0.18]) {
    const cx = x0 + w * 0.5;
    line(p.c, cx - w * 0.16, yy + w * 0.16, cx + w * 0.16, yy - w * 0.16, color, 2.2, 0.7);
    bumpLine(p, cx - w * 0.16, yy + w * 0.16, cx + w * 0.16, yy - w * 0.16, 70, 3);
  }
  const by = y0 + h * 0.45;
  line(p.c, x0 + w * 0.3, by, x0 + w * 0.3, by + h * 0.14, color, 2, 0.55);
  line(p.c, x0 + w * 0.3, by, x0 + w * 0.42, by - w * 0.1, color, 2, 0.55);
}

function paintContainer(p: Painter, L: ContainerLayout, P: ContainerPalette) {
  const { c, rand } = p;
  const { w, d, h, H, cb, cc, sc, pi, rim, rimW, base, m, win, label, endM, endWin } = L;
  const A = atlasPx(w, H, d);
  const hx = w / 2;
  const hz = d / 2;
  const plateZ = hz - pi;
  const plateX = hx - pi;
  const inner = plateZ - rimW;

  // ------------------------------------------------------------------ FRONT
  surface(p, 0, 0, 1024, 512, P.body, P.bodyGrain, P.dark ? 0.06 : 0.05);
  const fyH = A.fy(h);
  const fyB = A.fy(base);
  // corner blocks
  for (const [x0, x1] of [
    [-hx, -hx + cb],
    [hx - cb, hx],
  ]) {
    const X0 = A.fx(x0);
    const X1 = A.fx(x1);
    surface(p, X0, 0, X1 - X0, 512, P.block, P.bodyGrain, 0.05);
    if (P.dark) {
      const outer = x0 < 0 ? 'left' : 'right';
      wornBand(p, X0, 0, X1 - X0, 512, outer, 11, P.edge);
      wornBand(p, X0, 0, X1 - X0, 512, outer === 'left' ? 'right' : 'left', 6, P.edge);
      wornBand(p, X0, 0, X1 - X0, 512, 'top', 9, P.edge);
    } else {
      cornerMarks(p, X0, X1, 0, 512, P.seam);
      line(c, x0 < 0 ? X1 - 2 : X0 + 2, 0, x0 < 0 ? X1 - 2 : X0 + 2, 512, P.seam, 2.5, 0.55);
      const outer = x0 < 0 ? 'left' : 'right';
      wornBand(p, X0, 0, X1 - X0, 512, outer, 3.5, CHIP);
      wornBand(p, X0, 0, X1 - X0, 512, 'top', 4, CHIP);
      chips(p, outer === 'left' ? X0 : X1 - 22, 0, 22, 512, 16, CHIP, [2, 6]);
      chips(p, X0, 0, X1 - X0, 40, 8, CHIP, [2, 7]);
      chips(p, X0, 470, X1 - X0, 42, 8, CHIP, [2, 6]);
    }
  }
  // stripe channels (recessed): worn diagonal stripes
  for (const [x0, x1] of [
    [-(hx - cb), -m],
    [m, hx - cb],
  ]) {
    const X0 = A.fx(x0);
    const X1 = A.fx(x1);
    wornStripes(p, X0, fyH, X1 - X0, fyB - fyH, P.dark ? 74 : 62, P.stripeA, P.stripeB, P.stripeWear, P.dark ? 1.3 : 1);
    line(c, X0 + 1.5, fyH, X0 + 1.5, fyB, P.dark ? '#000000' : P.seam, 3, 0.7);
    line(c, X1 - 1.5, fyH, X1 - 1.5, fyB, P.dark ? '#000000' : P.seam, 3, 0.55);
    bumpRect(p, X0, fyH, X1 - X0, fyB - fyH, 112);
    if (P.fade) p.fades.push({ x: X0 + 2, y: fyH, w: X1 - X0 - 4, h: fyB - fyH, color: P.fade });
    if (P.dark) {
      wornBand(p, X0 - 8, fyH, 8, fyB - fyH, 'right', 4, P.edge);
      wornBand(p, X1, fyH, 9, fyB - fyH, 'left', 5, P.edge);
    }
  }
  // base skid line
  rect(c, A.fx(-(hx - cb)), fyB, A.fx(hx - cb) - A.fx(-(hx - cb)), 512 - fyB, P.base);
  // lower recessed panel
  {
    const X0 = A.fx(-win.x);
    const X1 = A.fx(win.x);
    const Y0 = A.fy(win.y1);
    const Y1 = A.fy(win.y0);
    surface(p, X0, Y0, X1 - X0, Y1 - Y0, P.recess, P.bodyGrain, 0.05);
    aoFrame(c, X0, Y0, X1 - X0, Y1 - Y0, P.dark ? '#000000' : '#5d5553', P.dark ? '#6c6664' : '#f2ebe7', 5, 0.75);
    roundRectPath(c, X0 + 14, Y0 + 12, X1 - X0 - 28, Y1 - Y0 - 24, 14);
    c.lineWidth = 2.5;
    c.strokeStyle = P.dark ? '#24201f' : '#9d9591';
    c.stroke();
    rect(c, (X0 + X1) / 2 - 46, Y0 + 20, 92, 9, P.dark ? '#08080a' : '#4a4644');
    rect(c, (X0 + X1) / 2 - 46, Y0 + 29, 92, 2, P.dark ? '#3c3c42' : '#f4eeea');
    bumpRect(p, X0, Y0, X1 - X0, Y1 - Y0, 118);
    if (p.b) {
      roundRectPath(p.b, X0 + 14, Y0 + 12, X1 - X0 - 28, Y1 - Y0 - 24, 14);
      p.b.lineWidth = 3;
      p.b.strokeStyle = '#4a4a4a';
      p.b.stroke();
    }
  }
  // label / sticker
  if (!P.dark) {
    const X0 = A.fx(-label.x);
    const X1 = A.fx(label.x);
    warningLabel(p, X0, A.fy(label.y1), X1 - X0, A.fy(label.y0) - A.fy(label.y1));
    textLines(c, rand, A.fx(m - 0.3), A.fy(base + 0.1), A.fx(m - 0.06) - A.fx(m - 0.3), 16, 2, '#6a6361');
  } else {
    const X0 = A.fx(win.x + 0.04);
    dangerSticker(c, rand, X0, A.fy(base + 0.075), A.fx(m - 0.03) - X0, A.fy(base + 0.012) - A.fy(base + 0.075));
    smudges(c, rand, 0, 0, 1024, 512, 10, '58,58,64', 0.1, [40, 120]);
  }
  // rim band along the top (raised rim front faces)
  {
    const X0 = A.fx(-(hx - cb));
    const X1 = A.fx(hx - cb);
    if (P.dark) {
      wornBand(p, X0, 0, X1 - X0, 512, 'top', fyH + 4, P.edge);
    } else {
      rect(c, X0, 0, X1 - X0, fyH, P.rimTop);
      line(c, X0, fyH + 1, X1, fyH + 1, P.seam, 2.5, 0.6);
      line(c, X0, fyH + 4, X1, fyH + 4, '#ffffff', 1.5, 0.35);
      chips(p, X0, 0, X1 - X0, fyH + 6, 34, CHIP, [1.5, 6]);
      chips(p, X0, fyH, X1 - X0, 60, 18, CHIP, [1.5, 4], [0.35, 0.75]);
      chips(p, X0, fyB - 50, X1 - X0, 50, 22, CHIP, [1.5, 5], [0.35, 0.8]);
    }
    bumpLine(p, X0, fyH + 1, X1, fyH + 1, 60, 3);
  }
  // plate seams next to the channels
  for (const xx of [-m, m]) line(c, A.fx(xx), fyH, A.fx(xx), fyB, P.dark ? '#000000' : P.seam, 2.5, 0.6);
  // grime and scratches
  smudges(c, rand, 0, 0, 1024, 512, 18, P.grime, P.dark ? 0.1 : 0.16, [30, 120], 1);
  smudges(c, rand, 0, fyB - 70, 1024, 70, 10, P.grime, P.dark ? 0.14 : 0.16, [20, 60], 1);
  scratches(c, rand, 0, 0, 1024, 512, 50, P.dark ? '#8a8a88' : '#7a716d', 0.25);
  bumpScratches(p, 0, 0, 1024, 512, 60);

  // ------------------------------------------------------------------ END
  surface(p, 0, 512, 512, 512, P.endBody, P.dark ? '64,60,60' : '70,70,76', 0.06);
  const eyH = A.ey(h);
  for (const [z0, z1] of [
    [-hz, -hz + cb],
    [hz - cb, hz],
  ]) {
    const Z0 = A.ez(z0);
    const Z1 = A.ez(z1);
    surface(p, Z0, 512, Z1 - Z0, 512, P.block, P.bodyGrain, 0.05);
    // the corner bevel maps to the outermost columns
    const ccPx = (cc / d) * 512 + 3;
    if (P.dark) {
      wornBand(p, Z0, 512, Z1 - Z0, 512, z0 < 0 ? 'left' : 'right', ccPx, P.edge);
      wornBand(p, Z0, 512, Z1 - Z0, 512, z0 < 0 ? 'right' : 'left', 5, P.edge);
    } else {
      cornerMarks(p, Z0, Z1, 512, 1024, P.seam);
      const xi = z0 < 0 ? Z1 - 2 : Z0 + 2;
      line(c, xi, 512, xi, 1024, P.seam, 2.5, 0.55);
    }
  }
  {
    const Z0 = A.ez(-endM);
    const Z1 = A.ez(endM);
    // rim end face + top band
    wornBand(p, Z0, 512, Z1 - Z0, 512, 'top', eyH - 512 + (P.dark ? 4 : 6), P.endEdge);
    rect(c, Z0, A.ey(base), Z1 - Z0, 1024 - A.ey(base), P.base);
    // recessed window with worn light edges and the diagonal bar
    const W0 = A.ez(-endWin.z);
    const W1 = A.ez(endWin.z);
    const Y0 = A.ey(endWin.y1);
    const Y1 = A.ey(endWin.y0);
    surface(p, W0, Y0, W1 - W0, Y1 - Y0, P.endRecess, '60,60,66', 0.08);
    aoFrame(c, W0, Y0, W1 - W0, Y1 - Y0, '#000000', '#77777c', 4, 0.6);
    for (const side of ['top', 'bottom', 'left', 'right'] as const) wornBand(p, W0 - 7, Y0 - 7, W1 - W0 + 14, Y1 - Y0 + 14, side, 4.5, P.endEdge);
    const zt = endWin.z - 0.03;
    const yt = endWin.y1 - 0.03;
    const yb = endWin.y0 + 0.03;
    const len = Math.hypot(2 * zt, yt - yb);
    const nz = (yt - yb) / len;
    const ny = (2 * zt) / len;
    const hb = L.bar / 2;
    const corner = (z: number, y: number): Pt => [A.ez(z), A.ey(y)];
    const barPts: Pt[] = [corner(-zt - nz * hb, yt - ny * hb), corner(-zt + nz * hb, yt + ny * hb), corner(zt + nz * hb, yb + ny * hb), corner(zt - nz * hb, yb - ny * hb)];
    clipRect(c, W0, Y0, W1 - W0, Y1 - Y0, () => {
      poly(c, barPts, P.bar);
      c.save();
      c.strokeStyle = P.endEdge;
      c.lineWidth = 3;
      c.globalAlpha = 0.85;
      c.beginPath();
      c.moveTo(barPts[0][0], barPts[0][1]);
      c.lineTo(barPts[3][0], barPts[3][1]);
      c.moveTo(barPts[1][0], barPts[1][1]);
      c.lineTo(barPts[2][0], barPts[2][1]);
      c.stroke();
      c.restore();
    });
    smudges(c, rand, Z0, 512, Z1 - Z0, 512, 10, P.grime, 0.12, [20, 80], 1);
    scratches(c, rand, 0, 512, 512, 512, 30, P.dark ? '#5a5856' : '#9a9a98', 0.3);
  }
  bumpScratches(p, 0, 512, 512, 512, 30);

  // ------------------------------------------------------------------ TOP
  surface(p, 512, 512, 512, 256, P.topInner, P.bodyGrain, 0.06);
  {
    const X0 = A.tx(-(hx - cb));
    const X1 = A.tx(hx - cb);
    // long rims
    for (const [z0, z1] of [
      [-plateZ, -inner],
      [inner, plateZ],
    ]) {
      const Z0 = A.tz(z0);
      const Z1 = A.tz(z1);
      surface(p, X0, Z0, X1 - X0, Z1 - Z0, P.rimTop, P.bodyGrain, 0.05);
      if (P.dark) wornBand(p, X0, Z0, X1 - X0, Z1 - Z0, z0 < 0 ? 'top' : 'bottom', 6, P.edge);
      line(c, X0, z0 < 0 ? Z1 : Z0, X1, z0 < 0 ? Z1 : Z0, '#000000', 2, 0.5);
    }
    // end rims
    for (const [x0, x1] of [
      [-plateX, -(plateX - rimW)],
      [plateX - rimW, plateX],
    ]) {
      const XX0 = A.tx(x0);
      const XX1 = A.tx(x1);
      surface(p, XX0, A.tz(-(hz - cb)), XX1 - XX0, A.tz(hz - cb) - A.tz(-(hz - cb)), P.rimTop, P.bodyGrain, 0.05);
      if (P.dark) wornBand(p, XX0, A.tz(-(hz - cb)), XX1 - XX0, A.tz(hz - cb) - A.tz(-(hz - cb)), x0 < 0 ? 'left' : 'right', 6, P.edge);
    }
    // corner block tops
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const a = A.tx(sx < 0 ? -hx : hx - cb);
        const b = A.tz(sz < 0 ? -hz : hz - cb);
        const bw = A.tx(-hx + cb) - A.tx(-hx);
        const bh = A.tz(-hz + cb) - A.tz(-hz);
        surface(p, a, b, bw, bh, P.dark ? P.block : P.rimTop, P.bodyGrain, 0.05);
        if (P.dark) {
          wornBand(p, a, b, bw, bh, sx < 0 ? 'left' : 'right', 7, P.edge);
          wornBand(p, a, b, bw, bh, sz < 0 ? 'top' : 'bottom', 7, P.edge);
        }
        rect(c, a + bw / 2 - 4, b + bh / 2 - 4, 8, 8, P.dark ? '#3a3a3f' : '#8a8280');
      }
    // handle slots with their bars
    for (const sz of [-1, 1]) {
      const hxp = L.handle.x + 0.05;
      const zs0 = sz < 0 ? -(L.handle.z1 - 0.03) : L.handle.z0 - 0.03;
      const zs1 = sz < 0 ? -(L.handle.z0 + 0.03) : L.handle.z1 + 0.03;
      const za = Math.min(zs0, zs1);
      const zb = Math.max(zs0, zs1);
      const zMid0 = Math.min(sz * L.handle.z0, sz * L.handle.z1);
      const zMid1 = Math.max(sz * L.handle.z0, sz * L.handle.z1);
      rect(c, A.tx(-hxp), A.tz(za - 0.03), A.tx(hxp) - A.tx(-hxp), A.tz(zb + 0.03) - A.tz(za - 0.03), P.slot);
      rect(c, A.tx(-L.handle.x), A.tz(zMid0), A.tx(L.handle.x) - A.tx(-L.handle.x), A.tz(zMid1) - A.tz(zMid0), P.dark ? '#bdb9b4' : '#d9d0cc');
      bumpRect(p, A.tx(-hxp), A.tz(za - 0.03), A.tx(hxp) - A.tx(-hxp), A.tz(zb + 0.03) - A.tz(za - 0.03), 70);
    }
    // lid plate with chevron engraving (dark crates, t47): light grey, dust-dulled, with a bevelled
    // frame and two long outlined bars meeting in a chevron, plus a smaller inner chevron
    if (L.lid) {
      const LX0 = A.tx(-L.lid.x);
      const LX1 = A.tx(L.lid.x);
      const LZ0 = A.tz(-L.lid.z);
      const LZ1 = A.tz(L.lid.z);
      const lw = LX1 - LX0;
      const lh = LZ1 - LZ0;
      surface(p, LX0, LZ0, lw, lh, P.lid, '120,118,124', 0.05);
      aoFrame(c, LX0 + 1, LZ0 + 1, lw - 2, lh - 2, '#f2f2f4', '#6e6d72', 3.5, 0.8);
      if (p.s) rect(p.s, LX0, LZ0, lw, lh, '#ffffff');
      const cy = (LZ0 + LZ1) / 2;
      const engrave = (pts: Pt[], width: number) => {
        for (const [col, off, wd, a] of [
          ['#5e5d63', 0, width, 0.9],
          ['#f4f4f6', width * 0.55, width * 0.45, 0.7],
        ] as const) {
          c.save();
          c.strokeStyle = col;
          c.lineWidth = wd;
          c.globalAlpha = a;
          c.lineJoin = 'miter';
          c.beginPath();
          c.moveTo(pts[0][0] + off, pts[0][1] + off);
          for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0] + off, pts[i][1] + off);
          c.closePath();
          c.stroke();
          c.restore();
        }
        if (p.b) {
          // soft groove profile (wide shallow + narrow deep) so the bump does not alias into jaggies
          for (const [col, wd] of [
            ['#787878', width * 1.5],
            ['#4c4c4c', width * 0.8],
          ] as const) {
            p.b.save();
            p.b.strokeStyle = col;
            p.b.lineWidth = wd;
            p.b.lineJoin = 'round';
            p.b.beginPath();
            p.b.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) p.b.lineTo(pts[i][0], pts[i][1]);
            p.b.closePath();
            p.b.stroke();
            p.b.restore();
          }
        }
        if (p.s) {
          p.s.save();
          p.s.strokeStyle = '#6a6a6a';
          p.s.lineWidth = width;
          p.s.beginPath();
          p.s.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) p.s.lineTo(pts[i][0], pts[i][1]);
          p.s.closePath();
          p.s.stroke();
          p.s.restore();
        }
      };
      // two long bars (outlined parallelograms) converging toward +X
      const tipX = LX0 + lw * 0.86;
      const x0 = LX0 + lw * 0.1;
      const t = lh * 0.13;
      for (const sgn of [-1, 1]) {
        const yOut = cy + sgn * lh * 0.36;
        const yIn = cy + sgn * lh * 0.36 - sgn * t;
        engrave([
          [x0, yOut],
          [tipX - lw * 0.08, cy + sgn * t * 0.5],
          [tipX - lw * 0.08 - t * 1.6, cy + sgn * t * 0.5],
          [x0 + t * 0.4, yIn],
        ], 2.4);
      }
      // smaller inner chevron
      engrave([
        [LX0 + lw * 0.3, cy - lh * 0.16],
        [LX0 + lw * 0.62, cy],
        [LX0 + lw * 0.3, cy + lh * 0.16],
        [LX0 + lw * 0.36, cy],
      ], 2.0);
      chips(p, LX0, LZ0, lw, lh, 10, '#4a4a50', [1.5, 4], [0.3, 0.6]);
    }
    if (!P.dark) {
      chips(p, 512, 512, 512, 30, 30, CHIP, [2, 8]);
      chips(p, 512, 738, 512, 30, 30, CHIP, [2, 8]);
      chips(p, 512, 512, 30, 256, 14, CHIP, [2, 7]);
      chips(p, 994, 512, 30, 256, 14, CHIP, [2, 7]);
      chips(p, 512, 512, 512, 256, 10, CHIP, [3, 12], [0.4, 0.8]);
    }
    smudges(c, rand, 512, 512, 512, 256, 10, P.grime, 0.12, [20, 70]);
    scratches(c, rand, 512, 512, 512, 256, 20, P.dark ? '#77777a' : '#8a827e', 0.25);
  }

  // ------------------------------------------------------------------ BOTTOM
  rect(c, 512, 768, 512, 256, P.dark ? '#161618' : '#7c7674');
}

// ---------------------------------------------------------------------------------------------
// white row modules (t41.5, t43)

function paintModule(p: Painter, L: ModuleLayout) {
  const { c, rand } = p;
  const { w, d, H, ps, px, py0, slotZ, slotW, slotY0, slotY1 } = L;
  const A = atlasPx(w, H, d);
  const WHITE = '#efeced';
  const GRAIN = '112,108,106';
  const RECESS = '#acadb2';
  const EDGE = '#5d5a59';

  // FRONT
  surface(p, 0, 0, 1024, 512, WHITE, GRAIN, 0.05);
  for (let k = 0; k < 3; k++) {
    const X0 = A.fx(px[k] - ps / 2);
    const X1 = A.fx(px[k] + ps / 2);
    const Y0 = A.fy(py0 + ps);
    const Y1 = A.fy(py0);
    surface(p, X0, Y0, X1 - X0, Y1 - Y0, RECESS, '40,40,46', 0.1);
    aoFrame(c, X0, Y0, X1 - X0, Y1 - Y0, '#26262a', '#a7a8ac', 6, 0.8);
    bumpRect(p, X0, Y0, X1 - X0, Y1 - Y0, 110);
    if (k !== 1) {
      // diagonal bar: "\" on the left panel, "/" on the right one (geometry mirrors per face)
      const a = ps / 2 - 0.05;
      const dir = k === 0 ? 1 : -1;
      const xt = px[k] - dir * a;
      const xb = px[k] + dir * a;
      const yt = py0 + ps - 0.05;
      const yb = py0 + 0.05;
      const len = Math.hypot(xb - xt, yt - yb);
      const nx = (yt - yb) / len;
      const ny = (xb - xt) / len;
      const hb = L.bar / 2 + 0.004;
      const pt = (x: number, y: number): Pt => [A.fx(x), A.fy(y)];
      const bar: Pt[] = [pt(xt - nx * hb, yt - ny * hb), pt(xt + nx * hb, yt + ny * hb), pt(xb + nx * hb, yb + ny * hb), pt(xb - nx * hb, yb - ny * hb)];
      clipRect(c, X0, Y0, X1 - X0, Y1 - Y0, () => {
        poly(c, bar, '#dad7d3');
        c.save();
        c.strokeStyle = '#4b4a4c';
        c.lineWidth = 2.5;
        c.globalAlpha = 0.7;
        c.beginPath();
        c.moveTo(bar[0][0], bar[0][1]);
        c.lineTo(bar[3][0], bar[3][1]);
        c.moveTo(bar[1][0], bar[1][1]);
        c.lineTo(bar[2][0], bar[2][1]);
        c.stroke();
        c.restore();
      });
    } else {
      const BX0 = A.fx(px[1] - ps * 0.3);
      const BX1 = A.fx(px[1] + ps * 0.3);
      const BY0 = A.fy(py0 + ps * 0.68);
      const BY1 = A.fy(py0 + ps * 0.36);
      rect(c, BX0, BY0, BX1 - BX0, BY1 - BY0, '#d6d3cf');
      aoFrame(c, BX0, BY0, BX1 - BX0, BY1 - BY0, '#f2efeb', '#555456', 3, 0.7);
      const sw = (BX1 - BX0) * 0.62;
      const sh = (BY1 - BY0) * 0.36;
      roundRectPath(c, (BX0 + BX1) / 2 - sw / 2, (BY0 + BY1) / 2 - sh / 2, sw, sh, sh * 0.45);
      c.fillStyle = '#38393c';
      c.fill();
      textLines(c, rand, BX0, BY1 + 10, BX1 - BX0, 18, 2, '#4c4c50');
    }
  }
  // frame bevel lines at the band/separator edges
  line(c, 0, A.fy(py0 + ps) - 6, 1024, A.fy(py0 + ps) - 6, '#ffffff', 2, 0.25);
  line(c, 0, 3, 1024, 3, '#ffffff', 3, 0.3);
  smudges(c, rand, 0, 0, 1024, 512, 16, '96,88,82', 0.11, [30, 120], 1);
  smudges(c, rand, 0, 430, 1024, 82, 12, '96,88,82', 0.16, [20, 60], 1);
  scratches(c, rand, 0, 0, 1024, 512, 40, '#7d7874', 0.25);
  textLines(c, rand, A.fx(px[2] + ps / 2 + 0.02), A.fy(0.16), 60, 14, 2, EDGE);
  bumpScratches(p, 0, 0, 1024, 512, 40);

  // END: two vertical slots
  surface(p, 0, 512, 512, 512, WHITE, GRAIN, 0.05);
  for (const zc of slotZ) {
    const Z0 = A.ez(zc - slotW / 2);
    const Z1 = A.ez(zc + slotW / 2);
    const Y0 = A.ey(slotY1);
    const Y1 = A.ey(slotY0);
    surface(p, Z0, Y0, Z1 - Z0, Y1 - Y0, '#45464a', '30,30,34', 0.1);
    aoFrame(c, Z0, Y0, Z1 - Z0, Y1 - Y0, '#1c1c1f', '#9a9b9f', 5, 0.8);
    for (let k = 1; k < 4; k++) line(c, Z0 + 10, Y0 + ((Y1 - Y0) * k) / 4, Z1 - 10, Y0 + ((Y1 - Y0) * k) / 4, '#2a2a2d', 4, 0.7);
    bumpRect(p, Z0, Y0, Z1 - Z0, Y1 - Y0, 110);
  }
  smudges(c, rand, 0, 512, 512, 512, 10, '96,88,82', 0.12, [20, 80], 1);

  // TOP: dark handle slots along both long edges
  surface(p, 512, 512, 512, 256, '#d9d6d2', GRAIN, 0.06);
  for (const zc of [-d / 2 + 0.17, d / 2 - 0.17])
    for (const xc of px) {
      const X0 = A.tx(xc - 0.16);
      const X1 = A.tx(xc + 0.16);
      const Z0 = A.tz(zc - 0.045);
      const Z1 = A.tz(zc + 0.045);
      rect(c, X0, Z0, X1 - X0, Z1 - Z0, '#2a2a2d');
      line(c, X0, Z1, X1, Z1, '#f5f2ee', 2, 0.6);
      bumpRect(p, X0, Z0, X1 - X0, Z1 - Z0, 70);
    }
  smudges(c, rand, 512, 512, 512, 256, 10, '96,88,82', 0.12, [20, 70]);
  rect(c, 512, 768, 512, 256, '#7c7976');
}

// ---------------------------------------------------------------------------------------------

function paint(style: CrateStyle, p: Painter) {
  const spec = CRATE_SPECS[style];
  if (spec.kind === 'module') paintModule(p, moduleLayout(spec));
  else paintContainer(p, containerLayout(spec, style), style === 'dark' ? DARK : HAZARD);
}

/**
 * Full mip chain built by hand so painted detail can fade with distance: below 256 texels the
 * `fades` areas are progressively covered by their fade colour (dark crates' stripes are barely
 * visible beyond ~15 m, as in t01). Returns null if a level cannot be allocated.
 */
function buildMips(base: HTMLCanvasElement, fades: Painter['fades']): HTMLCanvasElement[] | null {
  const levels: HTMLCanvasElement[] = [base];
  let prev = base;
  let size = base.width;
  while (size > 1) {
    size = Math.max(1, size >> 1);
    const lv = make2d(size, size);
    if (!lv) return null;
    lv.ctx.imageSmoothingEnabled = true;
    lv.ctx.imageSmoothingQuality = 'high';
    lv.ctx.drawImage(prev, 0, 0, size, size);
    const k = size <= 128 ? 0.9 : size <= 256 ? 0.68 : size <= 512 ? 0.2 : 0;
    if (k > 0 && fades.length) {
      lv.ctx.save();
      lv.ctx.scale(size / 1024, size / 1024);
      lv.ctx.globalAlpha = k;
      for (const f of fades) rect(lv.ctx, f.x, f.y, f.w, f.h, f.color);
      lv.ctx.restore();
    }
    levels.push(lv.canvas);
    prev = lv.canvas;
  }
  return levels;
}

export interface CrateMaps {
  map: THREE.Texture;
  bump: THREE.Texture | null;
  /** Dusty-sheen mask (lid plates of the dark crates), or null for styles without one. */
  sheen: THREE.Texture | null;
}

/** Albedo atlas (+ optional bump atlas) for one crate style (1024² or 512² in low-power mode). */
export function crateMaps(style: CrateStyle, lowPower: boolean, seed: number, withBump = !lowPower): CrateMaps | null {
  const size = lowPower ? 512 : 1024;
  const col = make2d(size, size);
  if (!col) return null;
  const bmp = withBump ? make2d(size, size) : null;
  const wantSheen = style === 'dark' && !lowPower;
  const shn = wantSheen ? make2d(size / 4, size / 4) : null;
  col.ctx.scale(size / 1024, size / 1024);
  if (bmp) {
    bmp.ctx.scale(size / 1024, size / 1024);
    rect(bmp.ctx, 0, 0, 1024, 1024, 'rgb(128,128,128)');
  }
  if (shn) {
    shn.ctx.scale(size / 4096, size / 4096);
    rect(shn.ctx, 0, 0, 1024, 1024, '#000000');
  }
  const fades: Painter['fades'] = [];
  paint(style, { c: col.ctx, b: bmp?.ctx ?? null, s: shn?.ctx ?? null, rand: makeRng(seed), fades });
  const map = toTexture(col.canvas, true, false);
  const mips = fades.length ? buildMips(col.canvas, fades) : null;
  if (mips) {
    map.mipmaps = mips;
    map.generateMipmaps = false;
  }
  return { map, bump: bmp ? toTexture(bmp.canvas, false, false) : null, sheen: shn ? toTexture(shn.canvas, true, false) : null };
}

/** Albedo atlas texture for one crate style. */
export function crateAtlas(style: CrateStyle, lowPower: boolean, seed: number): THREE.Texture | null {
  return crateMaps(style, lowPower, seed, false)?.map ?? null;
}

/**
 * How strongly each crate family picks up the regolith bounce (scene environment) relative to the
 * scene's environmentIntensity. The shared environment is calibrated for the ship and tanks; crates
 * stand right on the bright sunlit plain, and in the reference the backlit white row modules keep a
 * mid-grey shaded face (t12 ≈ 50–70) where a plain bounce leaves ours near 26. The dark family gets
 * a smaller lift so its faces in shade stay near-black (t01).
 */
export const CRATE_BOUNCE_BOOST: Record<CrateStyle, number> = { hazard: 1.15, row: 2.5, dark: 1.5 };

/**
 * Paint gain on top of the albedo atlas (material colour = gain × atlas). The hazard atlas is
 * already near white, yet its sunlit front faces read 173–183 against the reference's 197–211
 * (t15–t18.5); a small gain above 1 is the only way to lift them further. Sun-facing faces still stay
 * below clipping: ≈ 0.88 · 1.0 · cos θ − 0.04 linear at most with the neutral tone mapper.
 */
export const CRATE_PAINT_GAIN: Record<CrateStyle, number> = { hazard: 1.13, row: 1, dark: 1 };

/**
 * Lets a standard material use the scene's environment at `boost` × scene.environmentIntensity
 * (three.js otherwise forces the scene value onto materials without their own envMap). Tracks the
 * scene each frame, so it follows an environment swap or removal (lowPower: none, no-op).
 */
export function bindEnvironmentBoost(material: THREE.MeshStandardMaterial, boost: number): void {
  if (boost === 1) return;
  material.onBeforeRender = (_renderer, scene) => {
    const env = scene.environment;
    if (material.envMap !== env) {
      material.envMap = env;
      material.needsUpdate = true;
    }
    if (env) material.envMapIntensity = scene.environmentIntensity * boost;
  };
}

/**
 * Ready-made crate material: albedo atlas + bump atlas (engraving, seams, recess outlines,
 * scratches) with the spec's roughness/metalness; plain fallback colour without a canvas.
 * The dark family is a MeshPhysicalMaterial whose light lid plates carry a dusty sheen
 * (sheenColorMap mask): under the low Sun the regolith-dusted plate brightens at grazing
 * incidence like the plain around it (t47 lid ≈ 140 in the reference), with no emission.
 * Returns the textures so the caller can dispose them.
 */
export function createCrateMaterial(
  style: CrateStyle,
  lowPower: boolean,
  seed: number,
): { material: THREE.MeshStandardMaterial; textures: THREE.Texture[] } {
  const spec = CRATE_SPECS[style];
  const maps = crateMaps(style, lowPower, seed);
  const params: THREE.MeshStandardMaterialParameters = {
    color: maps ? new THREE.Color().setScalar(CRATE_PAINT_GAIN[style]) : spec.fallbackColor,
    map: maps?.map ?? null,
    bumpMap: maps?.bump ?? null,
    bumpScale: 1.2,
    roughness: spec.roughness,
    metalness: spec.metalness,
  };
  const material = maps?.sheen
    ? new THREE.MeshPhysicalMaterial({ ...params, sheen: 1, sheenColor: 0xffffff, sheenColorMap: maps.sheen, sheenRoughness: CRATE_LID_SHEEN_ROUGHNESS })
    : new THREE.MeshStandardMaterial(params);
  bindEnvironmentBoost(material, CRATE_BOUNCE_BOOST[style]);
  const textures = maps ? [maps.map, ...(maps.bump ? [maps.bump] : []), ...(maps.sheen ? [maps.sheen] : [])] : [];
  return { material, textures };
}

/** Sheen roughness of the dusty lid plates (lower = sheen concentrated at more grazing angles). */
export const CRATE_LID_SHEEN_ROUGHNESS = 0.5;
