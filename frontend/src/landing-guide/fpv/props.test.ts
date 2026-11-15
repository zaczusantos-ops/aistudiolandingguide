import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMoonbase } from './props';
import {
  bearing,
  GREENHOUSE_CENTER,
  GREENHOUSE_RADIUS,
  LAYOUT_SUN_AZIMUTH_DEG,
  MOONBASE_SPAWN,
  REFERENCE_POSES,
  shipLocal,
  SUNWARD_CRATES,
  T01_DARK_ROW,
  T47_CRATE,
} from './propsLayout';
import { createHeightField } from './terrainHeight';
import { SHIP_HEIGHT, SHIP_LENGTH } from './propsShip';
import { TANK_HEIGHT } from './propsTanks';
import { WALK_RADIUS_M } from './types';

const rolling = (x: number, z: number) => Math.sin(x * 0.05) * 0.9 + Math.cos(z * 0.043) * 0.7 + Math.sin((x + z) * 0.11) * 0.25;

function stats(root: THREE.Object3D) {
  let drawCalls = 0;
  let triangles = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    drawCalls++;
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    triangles += tris * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
  });
  return { drawCalls, triangles };
}

describe('createMoonbase', () => {
  it('spawns outside every collider, with finite colliders inside the walkable disc', () => {
    for (const heightAt of [rolling, () => 0]) {
      const base = createMoonbase({ seed: 1234, lowPower: false, heightAt });
      expect(base.colliders.length).toBeGreaterThan(20);
      for (const c of base.colliders) {
        expect(Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.radius)).toBe(true);
        expect(c.radius).toBeGreaterThan(0);
        expect(Math.hypot(c.x, c.z)).toBeLessThan(WALK_RADIUS_M);
        expect(Math.hypot(base.spawn.x - c.x, base.spawn.z - c.z)).toBeGreaterThan(c.radius + 0.6);
      }
      expect(Number.isFinite(base.spawn.yawDeg) && Number.isFinite(base.spawn.pitchDeg)).toBe(true);
      base.dispose();
    }
  });

  it('stays within the props draw-call and triangle budget', () => {
    for (const lowPower of [false, true]) {
      const base = createMoonbase({ seed: 7, lowPower, heightAt: rolling });
      const { drawCalls, triangles } = stats(base.object);
      expect(drawCalls).toBeLessThanOrEqual(40);
      expect(triangles).toBeLessThan(600_000);
      base.dispose();
    }
  });

  it('rests ground-standing tanks on the terrain instead of floating', () => {
    const base = createMoonbase({ seed: 3, lowPower: false, heightAt: rolling });
    const tanks = base.object.getObjectByName('tanks') as THREE.InstancedMesh;
    expect(tanks).toBeTruthy();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let grounded = 0;
    for (let i = 0; i < tanks.count; i++) {
      tanks.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const ground = rolling(p.x, p.z);
      // either standing on the regolith (bottom at or slightly below it) or on top of a container
      const onGround = p.y <= ground + 0.01 && p.y > ground - 0.6;
      const onCrate = p.y > ground + 1.0;
      expect(onGround || onCrate).toBe(true);
      if (onGround) grounded++;
    }
    expect(grounded).toBeGreaterThan(8);
    base.dispose();
  });

  it('updates without throwing and disposes cleanly', () => {
    const base = createMoonbase({ seed: 11, lowPower: true, heightAt: () => 0 });
    const scene = new THREE.Scene();
    scene.add(base.object);
    const camera = new THREE.PerspectiveCamera();
    expect(() => base.update?.({ dt: 0.016, elapsed: 1.2, camera })).not.toThrow();
    base.dispose();
    expect(base.object.parent).toBeNull();
  });

  it('publishes reachable reference poses for all 14 frames, clear of every collider', () => {
    expect(Object.keys(REFERENCE_POSES).length).toBe(14);
    for (const heightAt of [rolling, () => 0]) {
      const base = createMoonbase({ seed: 5, lowPower: false, heightAt });
      for (const [name, pose] of Object.entries(REFERENCE_POSES)) {
        expect(Math.hypot(pose.x, pose.z), name).toBeLessThan(WALK_RADIUS_M);
        for (const c of base.colliders) expect(Math.hypot(pose.x - c.x, pose.z - c.z), name).toBeGreaterThan(c.radius + 0.3);
      }
      base.dispose();
    }
  });

  it('keeps the measured scale relations and the far greenhouse bearing', () => {
    // reference: ship ≈ 4× and ≈ 14× the 1.8 m tank in height / length (eye 1.7 m)
    expect(SHIP_HEIGHT / TANK_HEIGHT).toBeGreaterThan(3.5);
    expect(SHIP_HEIGHT / TANK_HEIGHT).toBeLessThan(4.6);
    expect(SHIP_LENGTH / TANK_HEIGHT).toBeGreaterThan(11);
    expect(SHIP_LENGTH / TANK_HEIGHT).toBeLessThan(16);
    // the dome stays ≈ 13° left of the illustrative Sun (azimuth 252°) from the whole base area
    for (const p of [{ x: 0, z: 0 }, SUNWARD_CRATES, REFERENCE_POSES.t21, REFERENCE_POSES.t47]) {
      const b = bearing(p.x, p.z, GREENHOUSE_CENTER.x, GREENHOUSE_CENTER.z);
      expect(b).toBeGreaterThan(234);
      expect(b).toBeLessThan(242);
    }
  });

  it('lights the ship-side frames from ≈ 100° left of the view, as the reference tanks show', () => {
    for (const name of ['t15', 't17', 't18.5']) {
      const leftOfView = (((REFERENCE_POSES[name].yawDeg - LAYOUT_SUN_AZIMUTH_DEG) % 360) + 360) % 360;
      expect(leftOfView, name).toBeGreaterThan(95);
      expect(leftOfView, name).toBeLessThan(125);
    }
  });

  it('keeps the sunward frames (t21, t30) clear of everything but the backlit group and the dome', () => {
    // horizontal half field of view at 1920 × 940, vertical FOV 60°
    const halfH = Math.atan(Math.tan((30 * Math.PI) / 180) * (1920 / 940)) * (180 / Math.PI);
    const base = createMoonbase({ seed: 2, lowPower: true, heightAt: () => 0 });
    for (const name of ['t21', 't30']) {
      const pose = REFERENCE_POSES[name];
      for (const c of base.colliders) {
        if (Math.hypot(c.x - SUNWARD_CRATES.x, c.z - SUNWARD_CRATES.z) < 15) continue;
        if (Math.hypot(c.x - GREENHOUSE_CENTER.x, c.z - GREENHOUSE_CENTER.z) < GREENHOUSE_RADIUS + 5) continue;
        // the lone valley crate is hidden by the terrain lip (see the occlusion test below)
        if (Math.hypot(c.x - T47_CRATE.x, c.z - T47_CRATE.z) < 3) continue;
        const d = Math.hypot(c.x - pose.x, c.z - pose.z);
        let rel = Math.abs(bearing(pose.x, pose.z, c.x, c.z) - pose.yawDeg) % 360;
        if (rel > 180) rel = 360 - rel;
        const angularRadius = (Math.asin(Math.min(1, c.radius / d)) * 180) / Math.PI;
        expect(rel - angularRadius, `${name} collider at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBeGreaterThan(halfH);
      }
    }
    base.dispose();
  });

  it('adds one draped contact-darkening mesh with per-vertex alpha', () => {
    const base = createMoonbase({ seed: 9, lowPower: false, heightAt: rolling });
    const mesh = base.object.getObjectByName('contact-shadows') as THREE.Mesh;
    expect(mesh).toBeTruthy();
    const col = mesh.geometry.getAttribute('color');
    const pos = mesh.geometry.getAttribute('position');
    expect(col.itemSize).toBe(4);
    let maxA = 0;
    for (let i = 0; i < col.count; i++) {
      maxA = Math.max(maxA, col.getW(i));
      // draped just above the terrain
      expect(pos.getY(i) - rolling(pos.getX(i), pos.getZ(i))).toBeCloseTo(0.025, 3);
    }
    expect(maxA).toBeGreaterThan(0.4);
    expect(maxA).toBeLessThanOrEqual(1);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    base.dispose();
  });

  it('spawns at the t01 pose with one low row of four dark crates on its left', () => {
    expect(REFERENCE_POSES.t01).toEqual(MOONBASE_SPAWN);
    const base = createMoonbase({ seed: 4, lowPower: true, heightAt: () => 0 });
    expect(base.spawn).toEqual(MOONBASE_SPAWN);
    const dark = base.object.getObjectByName('crates-dark') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const halfH = Math.atan(Math.tan((30 * Math.PI) / 180) * (1920 / 940)) * (180 / Math.PI);
    let row = 0;
    for (let i = 0; i < dark.count; i++) {
      dark.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      if (Math.hypot(p.x - T01_DARK_ROW.x, p.z - T01_DARK_ROW.z) > 4) continue;
      row++;
      expect(p.y).toBeLessThan(0.1); // a single level, nothing stacked
      let rel = (bearing(MOONBASE_SPAWN.x, MOONBASE_SPAWN.z, p.x, p.z) - MOONBASE_SPAWN.yawDeg) % 360;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      expect(rel).toBeLessThan(-20); // left part of the t01 frame (or just beyond its edge)
      expect(rel).toBeGreaterThan(-halfH - 12);
    }
    expect(row).toBe(4);
    base.dispose();
  });

  it('keeps the front tanks of the flank group out of each other\'s low-Sun shadow (t15–t18.5)', () => {
    const base = createMoonbase({ seed: 6, lowPower: true, heightAt: () => 0 });
    const tanks = base.object.getObjectByName('tanks') as THREE.InstancedMesh;
    const centre = shipLocal(-3.6, 8.9);
    const m = new THREE.Matrix4();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < tanks.count; i++) {
      tanks.getMatrixAt(i, m);
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      if (p.y < 0.5 && Math.hypot(p.x - centre.x, p.z - centre.z) < 3) pts.push(p);
    }
    expect(pts.length).toBe(4);
    // shadows run away from the Sun (azimuth + 180°); u = offset across the shadow direction
    const a = ((LAYOUT_SUN_AZIMUTH_DEG + 180) * Math.PI) / 180;
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    const pose = REFERENCE_POSES['t18.5'];
    const front = [...pts].sort((p, q) => Math.hypot(p.x - pose.x, p.z - pose.z) - Math.hypot(q.x - pose.x, q.z - pose.z)).slice(0, 2);
    for (const t of front)
      for (const o of pts) {
        if (o === t) continue;
        const dx = t.x - o.x;
        const dz = t.z - o.z;
        const along = dx * sx + dz * sz;
        const across = Math.abs(-dx * sz + dz * sx);
        if (along > 0) expect(across, 'front tank inside another tank\'s shadow').toBeGreaterThan(0.8);
      }
    base.dispose();
  });

  it('hides the lone valley crate (t47) from the base frames behind the terrain lip', () => {
    for (const seed of [1, 4139966101]) {
      const field = createHeightField({ seed, lowPower: false });
      const top = field.heightAt(T47_CRATE.x, T47_CRATE.z) + 1.25 * T47_CRATE.scale;
      for (const name of ['t01', 't05', 't12', 't21', 't30']) {
        const p = REFERENCE_POSES[name];
        const eye = field.heightAt(p.x, p.z) + 1.7;
        const L = Math.hypot(T47_CRATE.x - p.x, T47_CRATE.z - p.z);
        const toTop = (top - eye) / L;
        let lip = -Infinity;
        for (let i = 5; i < 195; i++) {
          const t = i / 200;
          lip = Math.max(lip, (field.heightAt(p.x + (T47_CRATE.x - p.x) * t, p.z + (T47_CRATE.z - p.z) * t) - eye) / (L * t));
        }
        expect(lip, `${name} sees the valley crate`).toBeGreaterThan(toTop);
      }
    }
  });
});
