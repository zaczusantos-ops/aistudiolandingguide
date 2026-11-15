import * as THREE from 'three';
import { chamferBox, colorize, makeRng, mergeAll } from './propsGeometry';
import { addHullFill } from './propsShipFill';

/**
 * Greenhouse (t08/t12/t21/t30/t37–t47): a large clear glass hemisphere far beyond the base on a
 * ring of light-grey crates, filled with a dark olive-green canopy whose leaf clusters catch the
 * light on the sunward side, with a thin crisp bright rim on the sunward glass edge. It is placed a few hundred metres out (props.ts) so that,
 * as in the reference walk, it keeps the same bearing just left of the Sun from everywhere in the
 * base while nearby props shift. Local origin: ground centre; the glass base sits at `baseY`.
 */

export interface Greenhouse {
  object: THREE.Group;
  glass: THREE.ShaderMaterial;
  setSunDirection(dir: THREE.Vector3): void;
  dispose(): void;
}

const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GLASS_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uSun;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float edge = 1.0 - ndv;
  float f = pow(edge, 2.2);
  // thin crisp rim, only on the half of the silhouette that faces the Sun
  float rim = smoothstep(0.8, 0.97, edge);
  vec3 sunH = normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-4);
  vec3 nH = normalize(vec3(N.x, 0.0, N.z) + 1e-4);
  // silhouette half toward the Sun (works when looking into the Sun, where the edge normals are
  // nearly perpendicular to it)
  float sunSide = smoothstep(-0.12, 0.2, dot(nH, sunH));
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, uSun), 0.0), 120.0) * 3.0;
  vec3 col = uTint * 0.03 + vec3(1.0) * (f * 0.08 * (0.3 + sunSide) + rim * 4.0 * sunSide) + vec3(spec);
  float a = clamp(0.02 + f * 0.08 + rim * 0.97 * sunSide + spec * 0.4, 0.0, 0.98);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CANOPY_VERT = /* glsl */ `
attribute float aLit;
varying vec3 vN;
varying vec3 vCol;
varying float vLit;
varying vec3 vL;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  vLit = aLit;
  vL = position;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const CANOPY_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uLeaf;
varying vec3 vN;
varying vec3 vCol;
varying float vLit;
varying vec3 vL;
float h3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vn(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
void main() {
  vec3 N = normalize(vN);
  // leaf clusters a few metres across (soft-edged blobs, no pixel speckle at range), in local metres
  float clump = vn(vL * 0.22) * 0.6 + vn(vL * 0.47 + 3.7) * 0.4;
  float spots = vn(vL * 0.85 + 11.0);
  float leaves = smoothstep(0.5, 0.68, clump) * smoothstep(0.38, 0.72, spots) * vLit;
  vec3 sunH = normalize(vec3(uSun.x, 0.35, uSun.z));
  float d = dot(N, sunH);
  // light scattered through the glass and leaves: wrapped, never fully black
  float wrap = 0.45 + 0.55 * clamp(d * 0.5 + 0.5, 0.0, 1.0);
  // clusters catch the light mostly on the sunward half and on top
  float sunSide = 0.15 + 1.0 * smoothstep(-0.3, 0.7, d) + 0.25 * clamp(N.y, 0.0, 1.0);
  vec3 col = vCol * wrap * (0.75 + 0.5 * spots) + uLeaf * leaves * sunSide * (0.6 + 0.5 * vLit);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// small deterministic 3D value noise for the canopy
function hash3(x: number, y: number, z: number, s: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041) + Math.imul(s, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, z: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1;
    const dy = (k >> 1) & 1;
    const dz = (k >> 2) & 1;
    const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    r += wt * hash3(xi + dx, yi + dy, zi + dz, s);
  }
  return r;
}
function fbm(x: number, y: number, z: number, s: number, oct: number): number {
  let a = 0.5;
  let f = 1;
  let r = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    r += a * vnoise(x * f, y * f, z * f, s + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return r / n;
}

/**
 * @param sunAzDeg azimuth the canopy leaves a dark gap toward (the reference shows black glass
 * between the canopy and the sunward rim).
 */
export function createGreenhouse(radius: number, baseY: number, lowPower: boolean, seed: number, sunAzDeg = 252): Greenhouse {
  const group = new THREE.Group();
  group.name = 'greenhouse';
  const disposables: { dispose(): void }[] = [];
  const s = seed >>> 0;

  // plinth: a ring of light-grey crates (two sizes, small gaps and jitter so they read as separate
  // boxes), a dark floor disc under the canopy and a thin light sill ring under the glass
  const rng = makeRng((s ^ 0x9e3779b9) >>> 0);
  const parts: THREE.BufferGeometry[] = [];
  const ringR = radius + 0.55;
  const crateLen = 2.45;
  const nCrates = Math.round((2 * Math.PI * ringR) / (crateLen + 0.12));
  const tmpM = new THREE.Matrix4();
  for (let i = 0; i < nCrates; i++) {
    const a = ((i + 0.5) / nCrates) * Math.PI * 2;
    const len = crateLen * (0.92 + 0.08 * rng());
    const dep = 1.25 + 0.25 * rng();
    const top = baseY + 0.02 + (rng() < 0.25 ? 0.18 : 0);
    const shade = 0.66 + 0.1 * rng();
    const tone = new THREE.Color(shade, shade, shade * 1.03);
    const box = colorize(chamferBox(-len / 2, len / 2, -0.6, top, -dep / 2, dep / 2, 0.06), tone);
    const jitter = (rng() - 0.5) * 0.12;
    tmpM.makeRotationY(-a + Math.PI / 2 + (rng() - 0.5) * 0.05).setPosition(Math.cos(a) * (ringR + jitter), 0, Math.sin(a) * (ringR + jitter));
    parts.push(box.applyMatrix4(tmpM));
  }
  parts.push(colorize(new THREE.CylinderGeometry(radius - 0.2, radius - 0.2, 0.3, 64, 1).translate(0, baseY + 0.15, 0), 0x22201a));
  parts.push(colorize(new THREE.TorusGeometry(radius + 0.1, 0.22, 6, 96).rotateX(Math.PI / 2).translate(0, baseY + 0.1, 0), 0xc4c4c8));
  const platformGeo = mergeAll(parts, { uv: false, color: true });
  const platformMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04 });
  // backlit from the base, the crates still read light grey (≈ 60–110 sRGB) in the reference
  addHullFill(platformMat, 0.22);
  const platform = new THREE.Mesh(platformGeo, platformMat);
  platform.name = 'greenhouse-plinth';
  group.add(platform);
  disposables.push(platformGeo, platformMat);

  // canopy: lumpy displaced hemisphere inside the glass, dark green-brown with lit leaf clusters
  const segW = lowPower ? 72 : 144;
  const segH = lowPower ? 24 : 48;
  const canopyGeo = new THREE.SphereGeometry(1, segW, segH, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = canopyGeo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const lit = new Float32Array(pos.count);
  const dark = new THREE.Color(0x0a0f06);
  const mid = new THREE.Color(0x1a2211);
  const brown = new THREE.Color(0x231a0d);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  const sunX = Math.sin((sunAzDeg * Math.PI) / 180);
  const sunZ = -Math.cos((sunAzDeg * Math.PI) / 180);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const big = fbm(p.x * 2.0 + 3.1, p.y * 2.0, p.z * 2.0 - 1.7, s, 3);
    const lump = fbm(p.x * 6 + 11, p.y * 6, p.z * 6, s + 5, 3);
    // irregular canopy, lower and pulled back on the sunward side
    const toSun = Math.max(0, (p.x * sunX + p.z * sunZ) / Math.max(1e-3, Math.hypot(p.x, p.z))) * Math.sqrt(Math.max(0, 1 - p.y * p.y));
    const r = radius * (0.74 + 0.16 * big + 0.06 * lump - 0.16 * toSun * (0.4 + p.y));
    const y = Math.max(0.02, p.y);
    p.set(p.x * r - sunX * radius * 0.05, baseY + y * r * 0.95, p.z * r - sunZ * radius * 0.05);
    pos.setXYZ(i, p.x, p.y, p.z);
    // tones: dark green, a few reddish-brown patches, lit yellow-green leaf clumps (metres)
    const tone = fbm(p.x * 0.06 + 2, p.y * 0.06, p.z * 0.06, s + 9, 2);
    const patch = fbm(p.x * 0.11 - 4, p.y * 0.11, p.z * 0.11, s + 29, 2);
    c.copy(dark).lerp(mid, THREE.MathUtils.smoothstep(tone, 0.35, 0.7)).lerp(brown, 0.85 * THREE.MathUtils.smoothstep(patch, 0.56, 0.7));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    // regional mask for the lit leaf clumps (fewer in the brown patches and low on the shaded side)
    lit[i] = (1 - 0.75 * THREE.MathUtils.smoothstep(patch, 0.56, 0.7)) * (0.55 + 0.45 * Math.min(1, (p.y - baseY) / (0.5 * radius)));
  }
  canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  canopyGeo.setAttribute('aLit', new THREE.BufferAttribute(lit, 1));
  canopyGeo.computeVertexNormals();
  const canopyMat = new THREE.ShaderMaterial({
    vertexShader: CANOPY_VERT,
    fragmentShader: CANOPY_FRAG,
    vertexColors: true,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
      // dark olive-green leaf highlight (reference: canopy ≈ sRGB 10–20, lit clusters ≈ 35–55)
      uLeaf: { value: new THREE.Color(0x4a5e2a) },
    },
  });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.name = 'greenhouse-canopy';
  group.add(canopy);
  disposables.push(canopyGeo, canopyMat);

  // glass shell
  const glassGeo = new THREE.SphereGeometry(radius, lowPower ? 48 : 96, lowPower ? 16 : 32, 0, Math.PI * 2, 0, Math.PI / 2);
  glassGeo.translate(0, baseY, 0);
  const glass = new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    uniforms: {
      uTint: { value: new THREE.Color(0x9fb4bc) },
      uSun: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  const shell = new THREE.Mesh(glassGeo, glass);
  shell.renderOrder = 2;
  group.add(shell);
  disposables.push(glassGeo, glass);

  return {
    object: group,
    glass,
    setSunDirection(dir) {
      (glass.uniforms.uSun.value as THREE.Vector3).copy(dir).normalize();
      (canopyMat.uniforms.uSun.value as THREE.Vector3).copy(dir).normalize();
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
