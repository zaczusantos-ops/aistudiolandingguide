import * as THREE from 'three';
import { createEarth } from './skyEarth';
import { createLunarEnvironment, type LunarEnvironment } from './skyEnv';
import { createSunSprite } from './skySun';
import { EYE_HEIGHT_M, type FrameContext, type SkyModule, type SkyOptions } from './types';

/**
 * Sky & lighting for the first-person lunar walk.
 *
 * Lighting convention (other modules may rely on it):
 * - Renderer: Khronos PBR Neutral tone mapping at exposure SKY_EXPOSURE (0.88). Between ~0.09 and
 *   ~0.9 linear the output is `0.88 · input − 0.04`; below that the toe goes quadratic
 *   (≈ 6.25 · x²), which is what makes shadowed faces fall steeply toward black.
 * - Sun: DirectionalLight with intensity SUN_INTENSITY = π, i.e. a white Lambertian surface facing
 *   the Sun receives linear 1.0 before exposure (three.js diffuse = albedo · intensity · cosθ / π).
 *   Screen value of a sunlit matte face ≈ sRGB( 0.88 · albedoLinear · cosθ − 0.04 ).
 * - Fill: PMREM environment (black sky, sunlit regolith below the horizon) at ENV_INTENSITY plus a
 *   weak hemisphere light. Calibrated so faces turned away from the Sun land at sRGB ≈ 15–35
 *   (dark but not black), like the reference frames; there is no local bounce between props.
 * - Sky: pure black, no stars. Sun = constant-angular-size disc + halo sprite. Earth = small sphere
 *   at its dataset direction with the true ~1.9° apparent size.
 * The lighting is illustrative (sun elevation is fixed upstream); nothing here is a measurement.
 */

export const SKY_TONE_MAPPING = THREE.NeutralToneMapping;
/** Tone-mapping exposure. 0.88 brings sunlit regolith and prop flanks to the reference levels. */
export const SKY_EXPOSURE = 0.88;
/** Sun DirectionalLight intensity: π ⇒ unit irradiance on a surface facing the Sun. */
export const SUN_INTENSITY = Math.PI;
/**
 * Strength of the regolith-bounce environment (diffuse + specular) on PBR materials. The ground's
 * own shader barely sees it (its normals face the black sky); it mostly fills shadowed prop faces.
 */
export const ENV_INTENSITY = 0.4;

// Shadow volume (metres). The box follows the camera, is pushed forward along the view, and is
// snapped to shadow-map texels so shadows do not swim. Light-space width is SHADOW_HALF_WIDTH
// across the Sun azimuth; along it the ground footprint is ±SHADOW_HALF_DEPTH. The light-space
// height is derived from the Sun elevation so a low Sun does not waste resolution.
export const SHADOW_MAP_SIZE = 2048;
export const SHADOW_HALF_WIDTH = 150;
export const SHADOW_HALF_DEPTH = 170;
const SHADOW_FORWARD_OFFSET = 55;
const SHADOW_MAX_CASTER_HEIGHT = 18;
const SHADOW_RELIEF_MARGIN = 6;
const SHADOW_LIGHT_DISTANCE = 450;

export function configureRenderer(renderer: THREE.WebGLRenderer, lowPower: boolean): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = SKY_TONE_MAPPING;
  renderer.toneMappingExposure = SKY_EXPOSURE;
  renderer.shadowMap.enabled = !lowPower;
  // PCF with a Vogel-disk kernel (PCFSoft was removed in r18x); radius is set on the light.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
}

export interface ShadowBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Orthographic shadow-camera bounds for a given Sun direction. Light-space +Y is "camera up":
 * ground toward the Sun maps to −Y and tall casters to +Y, so the box is asymmetric.
 */
export function computeShadowBounds(sunDir: THREE.Vector3, out: ShadowBounds = { left: 0, right: 0, top: 0, bottom: 0 }): ShadowBounds {
  const sinEl = THREE.MathUtils.clamp(sunDir.y, 0.02, 1);
  const cosEl = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
  const groundY = SHADOW_HALF_DEPTH * sinEl;
  out.left = -SHADOW_HALF_WIDTH;
  out.right = SHADOW_HALF_WIDTH;
  out.bottom = -(groundY + SHADOW_RELIEF_MARGIN * cosEl + 1);
  out.top = groundY + SHADOW_MAX_CASTER_HEIGHT * cosEl + SHADOW_RELIEF_MARGIN * cosEl;
  return out;
}

const _up = new THREE.Vector3(0, 1, 0);
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();

/** Same basis as `Object3D.lookAt` gives the shadow camera (z = toward the Sun). */
export function lightBasis(sunDir: THREE.Vector3, outX: THREE.Vector3, outY: THREE.Vector3): void {
  outX.crossVectors(_up, sunDir);
  if (outX.lengthSq() < 1e-8) outX.set(1, 0, 0);
  outX.normalize();
  outY.crossVectors(sunDir, outX).normalize();
}

/** Moves `center` (in place) so its light-space X/Y fall exactly on shadow-map texel corners. */
export function snapToShadowTexels(center: THREE.Vector3, sunDir: THREE.Vector3, texelX: number, texelY: number): THREE.Vector3 {
  lightBasis(sunDir, _bx, _by);
  const u = center.dot(_bx);
  const v = center.dot(_by);
  const du = Math.round(u / texelX) * texelX - u;
  const dv = Math.round(v / texelY) * texelY - v;
  return center.addScaledVector(_bx, du).addScaledVector(_by, dv);
}

export function createLunarSky(opts: SkyOptions): SkyModule {
  const { scene, lowPower } = opts;
  scene.background = new THREE.Color(0x000000);
  const group = new THREE.Group();
  group.name = 'lunar-sky';

  // --- Sun light + camera-following shadows ---
  const sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  sunLight.name = 'sun';
  sunLight.castShadow = !lowPower;
  if (!lowPower) {
    const shadow = sunLight.shadow;
    shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    shadow.camera.near = 1;
    shadow.camera.far = SHADOW_LIGHT_DISTANCE + SHADOW_HALF_DEPTH + 250;
    shadow.bias = -0.00004;
    shadow.normalBias = 0.09;
    shadow.radius = 0.5; // small Vogel kernel: crisp edges, no IGN stipple in tight penumbrae
  }
  group.add(sunLight);
  group.add(sunLight.target);

  // --- Fill: environment (regolith bounce) or, in lowPower, an equivalent hemisphere light ---
  let env: LunarEnvironment | null = null;
  if (!lowPower) {
    env = createLunarEnvironment(opts.renderer);
    if (env) {
      scene.environment = env.texture;
      scene.environmentIntensity = ENV_INTENSITY;
    }
  }
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  hemi.name = 'fill';
  // Weak neutral light from above (earthshine/scatter stand-in) so upward shadowed ground is not 0.
  hemi.color.setRGB(0.1, 0.1, 0.1);
  if (env) {
    hemi.groundColor.setRGB(0.03, 0.03, 0.03);
  } else {
    // No environment: carry the regolith bounce in the hemisphere light instead.
    hemi.groundColor.setRGB(0.49, 0.475, 0.475);
  }
  group.add(hemi);

  // --- Sun disc/halo and Earth ---
  const sun = createSunSprite();
  group.add(sun.mesh);
  const earth = createEarth(lowPower);
  group.add(earth.mesh);

  const sunDir = new THREE.Vector3(0, 0.17, -1).normalize();
  const bounds = computeShadowBounds(sunDir);
  const center = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const camPos = new THREE.Vector3();

  const applyShadowBounds = () => {
    if (!sunLight.castShadow) return;
    computeShadowBounds(sunDir, bounds);
    const cam = sunLight.shadow.camera;
    cam.left = bounds.left;
    cam.right = bounds.right;
    cam.top = bounds.top;
    cam.bottom = bounds.bottom;
    cam.updateProjectionMatrix();
  };
  applyShadowBounds();

  return {
    object: group,
    sunLight,
    setSunDirection(dir) {
      sunDir.copy(dir).normalize();
      sun.setDirection(sunDir);
      earth.setSunDirection(sunDir);
      applyShadowBounds();
    },
    setEarthDirection(dir) {
      earth.setDirection(dir);
    },
    update(frame: FrameContext) {
      const camera = frame.camera;
      sun.update(camera);
      earth.update(camera);

      // Shadow box centre: ground under the player, pushed forward along the view direction.
      camera.getWorldPosition(camPos);
      camera.getWorldDirection(forward);
      forward.y = 0;
      if (forward.lengthSq() > 1e-6) forward.normalize();
      center.copy(camPos);
      center.y -= EYE_HEIGHT_M;
      center.addScaledVector(forward, SHADOW_FORWARD_OFFSET);
      if (sunLight.castShadow) {
        const texelX = (bounds.right - bounds.left) / SHADOW_MAP_SIZE;
        const texelY = (bounds.top - bounds.bottom) / SHADOW_MAP_SIZE;
        snapToShadowTexels(center, sunDir, texelX, texelY);
      }
      sunLight.target.position.copy(center);
      sunLight.position.copy(center).addScaledVector(sunDir, SHADOW_LIGHT_DISTANCE);
      sunLight.target.updateMatrixWorld();
      sunLight.updateMatrixWorld();
    },
    dispose() {
      sun.dispose();
      earth.dispose();
      sunLight.dispose();
      hemi.dispose();
      if (env) {
        if (scene.environment === env.texture) scene.environment = null;
        env.dispose();
      }
    },
  };
}
