import * as THREE from 'three';

/**
 * Very simple image-based fill for the lunar scene: black sky above the horizon and sunlit
 * regolith below it (a little brighter toward the horizon, where the plain is seen at grazing
 * angles). Prefiltered with PMREM it gives props a soft bounce light from the ground on their
 * shadowed sides and subtle horizon reflections on smooth paint — no sky light, no stars.
 */

/** Linear radiance of the environment for a given elevation (radians). Exported for tests. */
export function envRadiance(elevationRad: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (elevationRad >= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const below = -elevationRad;
  // Distant plain near the horizon reads brighter than the ground right under the observer.
  const horizonBoost = 1 - Math.min(1, below / (Math.PI / 7));
  const l = 0.27 + 0.13 * horizonBoost * horizonBoost;
  // Neutral, very slightly warm regolith bounce (shaded prop faces in the reference are not bluish;
  // the neutral tone mapper's toe would exaggerate any blue tint in the darks).
  out[0] = l * 1.02;
  out[1] = l * 0.985;
  out[2] = l * 0.985;
  return out;
}

export interface LunarEnvironment {
  texture: THREE.Texture;
  dispose(): void;
}

/** Builds the PMREM environment. Returns null if the GPU path fails (callers fall back to lights). */
export function createLunarEnvironment(renderer: THREE.WebGLRenderer): LunarEnvironment | null {
  const w = 128;
  const h = 64;
  // 8-bit linear data: values stay well below 1 and every WebGL2 GPU can filter it.
  const data = new Uint8Array(w * h * 4);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    // Equirect rows: v = 0 is straight down (flipY is false for DataTexture).
    const el = ((y + 0.5) / h - 0.5) * Math.PI;
    envRadiance(el, rgb);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.round(rgb[0] * 255);
      data[i + 1] = Math.round(rgb[1] * 255);
      data[i + 2] = Math.round(rgb[2] * 255);
      data[i + 3] = 255;
    }
  }
  const equirect = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.magFilter = THREE.LinearFilter;
  equirect.minFilter = THREE.LinearFilter;
  equirect.needsUpdate = true;

  let pmrem: THREE.PMREMGenerator | null = null;
  try {
    pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(equirect);
    pmrem.dispose();
    equirect.dispose();
    return {
      texture: target.texture,
      dispose() {
        target.dispose();
      },
    };
  } catch {
    pmrem?.dispose();
    equirect.dispose();
    return null;
  }
}
