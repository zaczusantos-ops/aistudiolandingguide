import * as THREE from 'three';
import { yawForAzimuth } from './propsGeometry';

/**
 * Soft contact darkening under the props. The reference shows no long cast shadows on the
 * regolith, only dark contact areas right under/around each object; the ground attenuates the
 * received prop shadows, and these decals add the contact darkening back.
 *
 * Every footprint is a small grid draped on the terrain (`heightAt`, which reproduces the
 * rendered ground triangles) with a per-vertex alpha from a soft rounded-rectangle distance
 * field; all of them are merged into ONE mesh (one draw call): black, transparent, no depth
 * writes, polygon offset toward the camera.
 */

export interface ContactFootprint {
  x: number;
  z: number;
  /** Heading of the footprint's local +X axis (degrees clockwise from North). */
  yawDeg: number;
  halfX: number;
  halfZ: number;
  /** Peak opacity (default 0.6). */
  strength?: number;
  /** Fade distance outside the footprint (m, default 0.9). */
  spread?: number;
  /** Corner radius (m, default min(halfX, halfZ) * 0.6). */
  corner?: number;
}

export interface ContactShadows {
  mesh: THREE.Mesh;
  dispose(): void;
}

const LIFT = 0.025;

function roundRectSd(px: number, pz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(px) - (hx - r);
  const qz = Math.abs(pz) - (hz - r);
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - r;
}

export function createContactShadows(heightAt: (x: number, z: number) => number, items: ContactFootprint[], lowPower: boolean): ContactShadows {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const maxCells = lowPower ? 24 : 48;
  for (const it of items) {
    const strength = it.strength ?? 0.6;
    const spread = it.spread ?? 0.9;
    const r = Math.min(it.corner ?? Math.min(it.halfX, it.halfZ) * 0.6, it.halfX, it.halfZ);
    const ex = it.halfX + spread;
    const ez = it.halfZ + spread;
    const cell = Math.max(lowPower ? 0.6 : 0.35, (2 * Math.max(ex, ez)) / maxCells);
    const nx = Math.max(2, Math.ceil((2 * ex) / cell));
    const nz = Math.max(2, Math.ceil((2 * ez) / cell));
    const yaw = yawForAzimuth(it.yawDeg);
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const base = positions.length / 3;
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const lx = -ex + (2 * ex * i) / nx;
        const lz = -ez + (2 * ez * j) / nz;
        const x = it.x + lx * cos + lz * sin;
        const z = it.z - lx * sin + lz * cos;
        positions.push(x, heightAt(x, z) + LIFT, z);
        const sd = roundRectSd(lx, lz, it.halfX, it.halfZ, r);
        const t = THREE.MathUtils.clamp((sd + 0.25 * spread) / (1.25 * spread), 0, 1);
        const a = strength * (1 - t) * (1 - t);
        colors.push(1, 1, 1, a);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = base + j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'contact-shadows';
  mesh.renderOrder = 1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return {
    mesh,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
