import * as THREE from 'three';
import { createHeightField } from './terrainHeight';
import { applyRegolithShader, type RegolithScale, type RegolithUniforms } from './terrainShader';
import { generateRegolithTexture } from './terrainTexture';
import type { GroundModule, GroundOptions } from './types';

/**
 * Lunar ground for the first-person walk: nested LOD rings reaching ~6 km (dense around the
 * walk area), gentle undulation, sparse soft craters, far rolling hills, and a procedural
 * regolith material with multi-scale detail and a sunward forward-scatter sheen.
 * Purely illustrative scenery.
 */

const SCALES: RegolithScale[] = [
  { tile: 1.15, angle: 0.37, offset: [0.13, 0.71], slope: 0.62, cavity: 0.3, albedo: 0.12, fade: [8, 22] },
  { tile: 6.3, angle: 1.91, offset: [0.57, 0.29], slope: 0.65, cavity: 0.5, albedo: 0.22, fade: [40, 130], damp: [3, 16, 0.22] },
  // Coarse scale: chunky pits and clods at the feet, stronger relief toward the mid field.
  { tile: 37, angle: 4.13, offset: [0.83, 0.41], slope: 0.4, cavity: 0.35, albedo: 0.35, fade: [900, 2400], damp: [4, 24, 1.0], tintFadeIn: [3, 15] },
  { tile: 230, angle: 2.71, offset: [0.21, 0.93], slope: 0.05, cavity: 0.2, albedo: 0.5, fade: null, damp: [25, 140, 4.4], tintFadeIn: [25, 110] },
];

const REGOLITH_SRGB: [number, number, number] = [158, 153, 158];

export function createLunarGround(opts: GroundOptions): GroundModule {
  const field = createHeightField(opts);
  const mesh = field.buildMesh();

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geo.computeBoundingSphere();

  const texSize = opts.lowPower ? 512 : 2048;
  const seed = (Math.floor(Math.abs(opts.seed)) ^ 0x51ed) >>> 0;
  const tex = generateRegolithTexture(texSize, seed);
  const detail = new THREE.DataTexture(tex.data, tex.size, tex.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  detail.wrapS = THREE.RepeatWrapping;
  detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 16; // clamped to the GPU maximum by three.js
  detail.colorSpace = THREE.NoColorSpace;
  detail.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.color.setRGB(REGOLITH_SRGB[0] / 255, REGOLITH_SRGB[1] / 255, REGOLITH_SRGB[2] / 255, THREE.SRGBColorSpace);

  const uniforms: RegolithUniforms = {
    uDetail: { value: detail },
    uSunDirW: { value: new THREE.Vector3(0, Math.sin(0.1745), -Math.cos(0.1745)) },
    uDiffuseGain: { value: 0.97 },
    uPhotK: { value: 0.35 },
    uSheenLobe: { value: 0.45 },
    uSheenFar: { value: new THREE.Vector2(0.5, 4) },
    uSheenTail: { value: new THREE.Vector2(1.0, 1.35) },
    uSheenColumn: { value: 4.6 },
    uSheenFall: { value: 1.9 },
    uSheenSharp: { value: new THREE.Vector2(26, 10) },
    uFill: { value: 0.15 },
    uShadeTint: { value: new THREE.Color(0.98, 0.96, 1.04) },
    uAmbientGain: { value: 1.0 },
    uCavityFloor: { value: 0.35 },
    uCavityEdge: { value: new THREE.Vector2(0.78, 0.95) },
    uCavityFade: { value: new THREE.Vector3(15, 40, 80) },
    uIsoK: { value: new THREE.Vector2(0.45, 0.85) },
    uShadowStrength: { value: 0.32 },
    uShadowFade: { value: new THREE.Vector3(4, 14, 0.12) },
  };
  const scales = opts.lowPower ? SCALES.slice(1) : SCALES;
  applyRegolithShader(mat, uniforms, { scales }, opts.lowPower ? 'lunar-regolith-low-v4' : 'lunar-regolith-v4');

  const ground = new THREE.Mesh(geo, mat);
  ground.name = 'lunar-ground';
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.frustumCulled = false;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();

  return {
    object: ground,
    heightAt: field.heightAt,
    setSunDirection(dir: THREE.Vector3) {
      uniforms.uSunDirW.value.copy(dir).normalize();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      detail.dispose();
    },
  };
}
