import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CRATE_SPECS, containerLayout, crateGeometry, moduleLayout } from './propsCrates';
import { bindEnvironmentBoost, CRATE_BOUNCE_BOOST, CRATE_PAINT_GAIN, createCrateMaterial } from './propsKitPaint';
import {
  ROVER_BEACON,
  ROVER_DECK_PANEL,
  ROVER_HALF_LENGTH,
  ROVER_HALF_WIDTH,
  ROVER_HEIGHT,
  ROVER_TRAY_TOP,
  ROVER_WHEEL_RADIUS,
  ROVER_WHEEL_WIDTH,
  ROVER_WHEEL_Z,
  roverGeometry,
} from './propsRover';
import { TANK_HEIGHT, TANK_MAST_TOP, TANK_PROFILE, TANK_RADIUS, tankGeometry, tankProfile } from './propsTanks';
import { crateAtlas, crateMaps, tankDetailMap, type CrateStyle } from './propsTextures';

const STYLES: CrateStyle[] = ['hazard', 'row', 'dark'];
const EYE = 1.7;

function bbox(g: THREE.BufferGeometry): THREE.Box3 {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
}

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe('props kit: crates', () => {
  it('builds each crate to its spec envelope (stacking height = h + rim)', () => {
    for (const style of STYLES) {
      const spec = CRATE_SPECS[style];
      const g = crateGeometry(spec);
      const b = bbox(g);
      const H = spec.h + (spec.lid?.t ?? 0);
      expect(b.min.y).toBeCloseTo(0, 3);
      expect(b.max.y).toBeLessThanOrEqual(H + 1e-3);
      expect(b.max.y).toBeGreaterThan(H - 0.02);
      expect(b.max.x - b.min.x).toBeCloseTo(spec.w, 2);
      expect(b.max.z - b.min.z).toBeCloseTo(spec.d, 2);
      g.dispose();
    }
  });

  it('keeps containers in proportion with the 1.7 m eye height', () => {
    for (const style of ['hazard', 'dark'] as const) {
      const s = CRATE_SPECS[style];
      expect(s.h + (s.lid?.t ?? 0)).toBeGreaterThan(0.55 * EYE);
      expect(s.h + (s.lid?.t ?? 0)).toBeLessThan(0.8 * EYE);
    }
    // dark crates stay long and low (t01 row); the white hazard containers are shorter and taller:
    // t18.5 pillar top / labelled face ≈ 0.55–0.6 once perspective is undone, 0.58–0.69 on screen
    expect(CRATE_SPECS.dark.w / CRATE_SPECS.dark.h).toBeGreaterThan(1.8);
    const hz = CRATE_SPECS.hazard;
    const hzH = hz.h + (hz.lid?.t ?? 0);
    expect(hzH / hz.w).toBeGreaterThan(0.58);
    expect(hzH / hz.w).toBeLessThan(0.72);
    // still a container next to the 1.8 m tanks, not a cube
    expect(hzH / TANK_HEIGHT).toBeLessThan(0.72);
    expect(hz.w).toBeGreaterThan(hz.d);
    const row = CRATE_SPECS.row;
    expect(row.h / TANK_HEIGHT).toBeGreaterThan(0.5);
    expect(row.h / TANK_HEIGHT).toBeLessThan(0.7);
  });

  it('has real relief: recessed panels and protruding corner blocks', () => {
    const spec = CRATE_SPECS.hazard;
    const L = containerLayout(spec, 'hazard');
    expect(L.rd).toBeGreaterThan(0.015);
    expect(L.pi).toBeGreaterThan(0.015);
    expect(L.win.x).toBeLessThan(L.m);
    expect(L.label.y0).toBeGreaterThan(L.win.y1);
    const M = moduleLayout(CRATE_SPECS.row);
    expect(M.px[2] + M.ps / 2).toBeLessThan(CRATE_SPECS.row.w / 2);
    // the front faces sit at several depths (corner block, plate, recess)
    const g = crateGeometry(spec);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const depths = new Set<number>();
    for (let i = 0; i < pos.count; i++) if (nrm.getZ(i) > 0.99) depths.add(Math.round(pos.getZ(i) * 1000));
    expect(depths.size).toBeGreaterThanOrEqual(3);
    g.dispose();
  });

  it('has bevelled corner pillars standing proud of the faces and rising above the rim', () => {
    for (const style of ['hazard', 'dark'] as const) {
      const spec = CRATE_SPECS[style];
      const L = containerLayout(spec, style);
      const g = crateGeometry(spec);
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const hx = spec.w / 2;
      const hz = spec.d / 2;
      let pillarFront = -Infinity;
      let plateFront = -Infinity;
      let pillarTop = -Infinity;
      let midTop = -Infinity;
      let chamfer = 0;
      // per-triangle centroids (flat-shaded hulls: vertices sit only on the face corners)
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
        const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
        const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
        if (nrm.getZ(i) > 0.99) {
          if (Math.abs(x) > hx - L.cb && Math.abs(x) < hx - L.cc) pillarFront = Math.max(pillarFront, z);
          if (Math.abs(x) < L.m - 0.02 && y > L.win.y1 + 0.02 && y < spec.h - 0.02) plateFront = Math.max(plateFront, z);
        }
        if (nrm.getY(i) > 0.99) {
          if (Math.abs(x) > hx - L.cb && Math.abs(z) > hz - L.cb) pillarTop = Math.max(pillarTop, y);
          if (Math.abs(x) < L.m && Math.abs(z) > hz - L.pi - L.rimW + 0.01) midTop = Math.max(midTop, y);
        }
        // 45° bevel on the outer vertical edges of the pillars
        if (Math.abs(Math.abs(nrm.getX(i)) - Math.SQRT1_2) < 0.02 && Math.abs(Math.abs(nrm.getZ(i)) - Math.SQRT1_2) < 0.02) chamfer++;
      }
      expect(pillarFront).toBeCloseTo(hz, 3);
      expect(pillarFront - plateFront).toBeGreaterThan(0.045);
      expect(pillarTop).toBeCloseTo(L.H, 3);
      expect(pillarTop - midTop).toBeGreaterThan(0.03);
      expect(chamfer).toBeGreaterThanOrEqual(4 * 2 * 3);
      // the striped channel steps between the pillar face and the plates
      expect(L.scD).toBeGreaterThan(0.01);
      expect(L.scD).toBeLessThan(L.pi);
      g.dispose();
    }
  });

  it('maps every vertex inside the atlas and stays cheap', () => {
    for (const style of STYLES) {
      const g = crateGeometry(CRATE_SPECS[style]);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
      expect(tris(g)).toBeLessThan(2000);
      g.dispose();
    }
  });

  it('scales the stripe and pillar widths down with a shorter container but keeps the dark crates', () => {
    const hz = containerLayout(CRATE_SPECS.hazard, 'hazard');
    const dk = containerLayout(CRATE_SPECS.dark, 'dark');
    expect(dk.cb).toBeCloseTo(0.27, 6);
    expect(dk.sc).toBeCloseTo(0.14, 6);
    expect(hz.cb / CRATE_SPECS.hazard.w).toBeGreaterThan(0.11);
    expect(hz.cb / CRATE_SPECS.hazard.w).toBeLessThan(0.14);
    // main face ≈ 60 % of the length, label inside it
    expect((2 * hz.m) / CRATE_SPECS.hazard.w).toBeGreaterThan(0.55);
    expect(hz.label.x).toBeLessThan(hz.m);
  });

  it('lifts the near-white hazard paint above the atlas and leaves the other families alone', () => {
    expect(CRATE_PAINT_GAIN.hazard).toBeGreaterThan(1);
    expect(CRATE_PAINT_GAIN.hazard).toBeLessThan(1.25);
    expect(CRATE_PAINT_GAIN.row).toBe(1);
    expect(CRATE_PAINT_GAIN.dark).toBe(1);
  });

  it('falls back to plain colours without a 2D canvas', () => {
    expect(crateAtlas('hazard', false, 1)).toBeNull();
    expect(crateMaps('dark', false, 1)).toBeNull();
    expect(tankDetailMap(false, 1)).toBeNull();
    const { material, textures } = createCrateMaterial('dark', false, 1);
    expect(material.map).toBeNull();
    expect(material.color.getHex()).toBe(CRATE_SPECS.dark.fallbackColor);
    expect(textures).toHaveLength(0);
    material.dispose();
  });

  it('lets crates pick up more regolith bounce than the scene default (backlit faces, t12)', () => {
    expect(CRATE_BOUNCE_BOOST.row).toBeGreaterThan(1.5);
    expect(CRATE_BOUNCE_BOOST.dark).toBeLessThan(CRATE_BOUNCE_BOOST.row);
    const material = new THREE.MeshStandardMaterial();
    bindEnvironmentBoost(material, 2);
    const scene = new THREE.Scene();
    const call = () => material.onBeforeRender({} as THREE.WebGLRenderer, scene, new THREE.Camera(), new THREE.BufferGeometry(), new THREE.Mesh(), new THREE.Group());
    call();
    expect(material.envMap).toBeNull();
    const env = new THREE.Texture();
    scene.environment = env;
    scene.environmentIntensity = 0.4;
    call();
    expect(material.envMap).toBe(env);
    expect(material.envMapIntensity).toBeCloseTo(0.8, 6);
    scene.environment = null;
    call();
    expect(material.envMap).toBeNull();
    material.dispose();
    env.dispose();
  });
});

describe('props kit: tanks', () => {
  it('stands ≈ 1.8 m to the cap top, ≈ 0.77 m wide (width / height ≈ 0.43), with a thin mast above', () => {
    const g = tankGeometry(false);
    const b = bbox(g);
    expect(b.min.y).toBeCloseTo(0, 3);
    expect(b.max.y).toBeCloseTo(TANK_MAST_TOP, 2);
    expect(b.max.x - b.min.x).toBeGreaterThan(0.74);
    expect(b.max.x - b.min.x).toBeLessThan(0.82);
    expect(TANK_HEIGHT).toBeGreaterThan(1.0 * EYE);
    expect(TANK_HEIGHT).toBeLessThan(1.12 * EYE);
    // reference t15–t18.5: body width / cap height 0.41–0.53
    expect((2 * TANK_RADIUS) / TANK_HEIGHT).toBeGreaterThan(0.4);
    expect((2 * TANK_RADIUS) / TANK_HEIGHT).toBeLessThan(0.47);
    expect(tris(g)).toBeLessThan(4000);
    g.dispose();
  });

  it('has a straight body, a barely inset ribbed band, a flush lip and a truncated-cone cap with a flat top', () => {
    const prof = tankProfile();
    const top = prof[prof.length - 1];
    expect(top.y).toBeCloseTo(TANK_HEIGHT, 5);
    // flat top: the last two points share the cap height, top radius well below the body radius
    const rim = prof[prof.length - 2];
    expect(rim.y).toBeCloseTo(TANK_HEIGHT, 5);
    expect(rim.x).toBeLessThan(TANK_RADIUS * 0.55);
    // the lip does not overhang the body noticeably (no heavy collar); the band is inset a little
    const p = TANK_PROFILE;
    const lipR = Math.max(...prof.filter((q) => q.y > p.bandTop && q.y <= p.collarTop).map((q) => q.x));
    expect(lipR).toBeLessThan(TANK_RADIUS + 0.01);
    const bandR = Math.min(...prof.filter((q) => q.y > p.bodyTop + 0.002 && q.y < p.bandTop).map((q) => q.x));
    expect(bandR).toBeLessThan(TANK_RADIUS * 0.97);
    expect(bandR).toBeGreaterThan(TANK_RADIUS * 0.88);
    // the cap narrows monotonically from the lip to the flat top
    const cap = prof.filter((q) => q.y >= p.collarTop && q.x > 0);
    for (let i = 1; i < cap.length; i++) expect(cap[i].x).toBeLessThanOrEqual(cap[i - 1].x + 1e-9);
    expect(p.capTop - p.collarTop).toBeGreaterThan(0.2);
  });
});

describe('props kit: rover', () => {
  it('is a buggy with big wheels on a wide track and two thin masts', () => {
    const g = roverGeometry(false);
    const b = bbox(g);
    const length = b.max.x - b.min.x;
    const D = 2 * ROVER_WHEEL_RADIUS;
    expect(D / length).toBeGreaterThan(0.3);
    expect(D / length).toBeLessThan(0.45);
    // t41.5: track (outer) ≈ 2 wheel diameters, tyre width ≈ 0.4 diameter
    expect((2 * ROVER_WHEEL_Z + ROVER_WHEEL_WIDTH) / D).toBeGreaterThan(1.8);
    expect(ROVER_WHEEL_WIDTH / D).toBeGreaterThan(0.35);
    expect(b.max.x).toBeLessThanOrEqual(ROVER_HALF_LENGTH + 0.05);
    expect(Math.max(-b.min.z, b.max.z)).toBeLessThanOrEqual(ROVER_HALF_WIDTH + 0.05);
    expect(b.max.y).toBeCloseTo(ROVER_HEIGHT, 2);
    expect(ROVER_HEIGHT / D).toBeGreaterThan(1.7);
    expect(ROVER_HEIGHT / D).toBeLessThan(2.1);
    expect(Math.abs(ROVER_BEACON.z) * 2).toBeLessThan(0.3);
    expect(b.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(tris(g)).toBeLessThan(15000);
    g.dispose();
  });

  it('carries a raised white deck panel on top of the tray', () => {
    const g = roverGeometry(false);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const D = ROVER_DECK_PANEL;
    let area = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if (nrm.getY(i) < 0.99) continue;
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      if (Math.abs(y - D.top) > 1e-3) continue;
      // light, near-neutral vertex colour (linear)
      if (col.getX(i) < 0.6 || col.getY(i) < 0.6 || col.getZ(i) < 0.6) continue;
      const a = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const b = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
      const c = new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    // most of the panel's top reads white (joints and hatch are dark), over a large part of the deck
    expect(area).toBeGreaterThan(0.6 * (D.x1 - D.x0) * 2 * D.z);
    expect(D.top - ROVER_TRAY_TOP).toBeGreaterThan(0.05);
    expect(D.top).toBeLessThan(ROVER_HEIGHT - 0.2);
    g.dispose();
  });

  it('is open under the tray: no surface between the frame and the wheels at mid height', () => {
    const g = roverGeometry(false);
    const pos = g.getAttribute('position');
    // probe box beside the chassis, between the side rail and the inner tyre walls, below the tray
    const probe = new THREE.Box3(new THREE.Vector3(-0.35, 0.78, 0.36), new THREE.Vector3(0.35, 1.0, ROVER_WHEEL_Z - ROVER_WHEEL_WIDTH / 2 - 0.02));
    const tri = new THREE.Triangle();
    const box = new THREE.Box3();
    let hits = 0;
    for (const side of [1, -1]) {
      const pr = side > 0 ? probe : new THREE.Box3(new THREE.Vector3(probe.min.x, probe.min.y, -probe.max.z), new THREE.Vector3(probe.max.x, probe.max.y, -probe.min.z));
      for (let i = 0; i + 2 < pos.count; i += 3) {
        tri.setFromAttributeAndIndices(pos, i, i + 1, i + 2);
        box.setFromPoints([tri.a, tri.b, tri.c]);
        if (box.intersectsBox(pr) && pr.intersectsTriangle(tri)) hits++;
      }
    }
    expect(hits).toBe(0);
    g.dispose();
  });
});
