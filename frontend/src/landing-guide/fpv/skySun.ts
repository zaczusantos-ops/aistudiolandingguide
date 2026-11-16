import * as THREE from 'three';

/**
 * Sun disc + soft glow halo, drawn as a screen-aligned quad that always keeps the same
 * angular size (it follows the camera, so it never parallaxes or grows when walking).
 *
 * The radial profile is expressed in "reference pixels": pixels of a 940 px tall viewport with a
 * 60° vertical FOV (focal length ≈ 814 px). It was fitted to the reference frames (t08, t12, t21,
 * t30): a ~10 px saturated white core and a smooth exponential halo, no streaks. The reference halo
 * is slightly lopsided — its tail reaches ~90 px to the right of / below the disc but only ~60 px
 * to the left and above — so the falloff length and fade window depend gently on screen direction.
 * The quad is depth-tested at ~0.97 × camera.far, so terrain and props occlude it.
 */

/** Focal length in px of the reference viewport (940 px tall, 60° vertical FOV). */
export const SUN_REF_FOCAL_PX = 470 / Math.tan((30 * Math.PI) / 180);
/** Quad half-size in reference px (must cover the whole halo in every direction). */
export const SUN_QUAD_RADIUS_PX = 120;
export const SUN_CORE_RADIUS_PX = 5.0;
const GLOW_PEAK = 0.4; // display value of the halo right outside the core (~100/255)
const GLOW_FALLOFF_PX = 22;
const GLOW_FADE_START_PX = 45;
const GLOW_FADE_END_PX = 105;
/**
 * Screen-direction skew of the halo falloff length: the reference tail is longer toward the
 * lower right (+x right, +y up), shorter toward the upper left.
 */
const GLOW_SKEW_X = 0.18;
const GLOW_SKEW_Y = -0.16;
/** Skew of the fade window (only vertical: the tail ends a little later below the disc). */
const GLOW_FADE_SKEW_Y = -0.1;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Display (sRGB, 0..1) value of the sun at radius `rPx` reference px from its center, along the
 * screen direction (`dirX` right, `dirY` up; unit vector, or 0,0 for the direction-neutral profile).
 * Mirrors the fragment shader; exported for tests and tuning.
 */
export function sunProfile(rPx: number, dirX = 0, dirY = 0): number {
  const core = 1 - smoothstep(SUN_CORE_RADIUS_PX - 0.9, SUN_CORE_RADIUS_PX + 0.9, rPx);
  const lengthScale = 1 + GLOW_SKEW_X * dirX + GLOW_SKEW_Y * dirY;
  const fadeScale = 1 + GLOW_FADE_SKEW_Y * dirY;
  const glow =
    GLOW_PEAK *
    Math.exp(-(rPx - (SUN_CORE_RADIUS_PX + 0.8)) / (GLOW_FALLOFF_PX * lengthScale)) *
    (1 - smoothstep(GLOW_FADE_START_PX * fadeScale, GLOW_FADE_END_PX * fadeScale, rPx));
  return Math.min(1, core + glow);
}

const vertexShader = /* glsl */ `
  uniform vec3 uDir;
  uniform float uDist;
  uniform float uTanR;
  varying vec2 vUv;
  void main() {
    // Direction only: the Sun is effectively at infinity and follows the camera.
    vec3 viewDir = mat3( viewMatrix ) * uDir;
    vec4 clip = projectionMatrix * vec4( viewDir * uDist, 1.0 );
    // Expand in clip space so the quad keeps a constant angular radius (round on screen).
    clip.xy += position.xy * vec2( projectionMatrix[ 0 ][ 0 ], projectionMatrix[ 1 ][ 1 ] ) * uTanR * clip.w;
    vUv = position.xy;
    gl_Position = clip;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uQuadPx;
  uniform float uCorePx;
  varying vec2 vUv;
  void main() {
    float len = length( vUv );
    float r = len * uQuadPx;
    vec2 dir = len > 1e-4 ? vUv / len : vec2( 0.0 );
    float aa = max( fwidth( r ), 0.6 );
    float core = 1.0 - smoothstep( uCorePx - aa, uCorePx + aa, r );
    float lengthScale = 1.0 + ${GLOW_SKEW_X.toFixed(4)} * dir.x + ${GLOW_SKEW_Y.toFixed(4)} * dir.y;
    float fadeScale = 1.0 + ${GLOW_FADE_SKEW_Y.toFixed(4)} * dir.y;
    float glow = ${GLOW_PEAK.toFixed(4)} * exp( -( r - ( uCorePx + 0.8 ) ) / ( ${GLOW_FALLOFF_PX.toFixed(2)} * lengthScale ) )
      * ( 1.0 - smoothstep( ${GLOW_FADE_START_PX.toFixed(1)} * fadeScale, ${GLOW_FADE_END_PX.toFixed(1)} * fadeScale, r ) );
    float v = min( 1.0, core + glow );
    if ( v < 0.0015 ) discard;
    // Written straight to the sRGB canvas (no tone mapping / colour-space conversion):
    // the profile is already in display values, and additive blending keeps it a light source.
    gl_FragColor = vec4( vec3( v ), 1.0 );
  }
`;

export interface SunSprite {
  mesh: THREE.Mesh;
  setDirection(dir: THREE.Vector3): void;
  update(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

export function createSunSprite(): SunSprite {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDir: { value: new THREE.Vector3(0, 0.17, -1).normalize() },
      uDist: { value: 5000 },
      uTanR: { value: SUN_QUAD_RADIUS_PX / SUN_REF_FOCAL_PX },
      uQuadPx: { value: SUN_QUAD_RADIUS_PX },
      uCorePx: { value: SUN_CORE_RADIUS_PX },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sun-glow';
  mesh.frustumCulled = false;
  // Draw before other transparent objects (e.g. greenhouse glass) so they blend over it.
  mesh.renderOrder = -10;

  return {
    mesh,
    setDirection(dir) {
      (material.uniforms.uDir.value as THREE.Vector3).copy(dir).normalize();
    },
    update(camera) {
      material.uniforms.uDist.value = camera.far * 0.97;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
