import * as THREE from 'three';
import { CRATE_SPECS, crateGeometry } from './propsCrates';
import { createContactShadows, type ContactFootprint } from './propsDecalShadows';
import { createGreenhouse } from './propsDome';
import { groundFrame, makeRng, yawForAzimuth } from './propsGeometry';
import {
  GREENHOUSE_CENTER,
  GREENHOUSE_RADIUS,
  MOONBASE_SPAWN,
  polar,
  SHIP_AXIS_AZ,
  SHIP_CENTER,
  shipLocal,
  SUNWARD_CRATES,
  SUNWARD_TANKS,
  T01_DARK_ROW,
  T01_ROVER,
  T41_ROW,
  T41_TANKS,
  T41_VIEW,
  T47_CRATE,
} from './propsLayout';
import { ROVER_BEACON, ROVER_BEACON_RADIUS, ROVER_HALF_LENGTH, ROVER_HALF_WIDTH, roverGeometry } from './propsRover';
import { buildShipGeometry, SHIP_HALF_WIDTH, SHIP_LENGTH } from './propsShip';
import { addHullFill } from './propsShipFill';
import { shipHullMaps } from './propsShipTextures';
import { TANK_PAINT, TANK_RADIUS, tankGeometry } from './propsTanks';
import { bindEnvironmentBoost, createCrateMaterial } from './propsKitPaint';
import { tankDetailMap, type CrateStyle } from './propsTextures';
import type { CircleCollider, FrameContext, PropsModule, PropsOptions } from './types';

export { MOONBASE_SPAWN, T41_VIEW } from './propsLayout';

/**
 * Procedural moonbase seen in the reference walk: landed ship with tanks and white hazard
 * containers along its sunlit flank, a rover and a row of dark crates near the start, a backlit
 * tank/crate group toward the Sun, a second container row + tank group with a rover, and a large
 * greenhouse dome far beyond the sunward crest. Everything is generated in code (geometry + canvas
 * textures) and drawn with a handful of merged / instanced meshes; soft contact darkening is one
 * extra draped mesh. Positions live in propsLayout.ts.
 */

const DEG = Math.PI / 180;

type CrateItem = [dx: number, dz: number, level: number, dyawDeg: number];

interface CrateGroup {
  style: CrateStyle;
  x: number;
  z: number;
  yawDeg: number;
  items: CrateItem[];
  tilt?: number;
  /** Extra height under level 0 (stacking on another family's crates). */
  baseLift?: number;
  /** Uniform scale of the group's crates about its ground frame (default 1; offsets stay in metres). */
  scale?: number;
}

interface TankGroup {
  x: number;
  z: number;
  yawDeg: number;
  items: [dx: number, dz: number][];
}

/** Strength of the hull's ambient fill (fraction of the Sun's irradiance, see propsShipFill.ts). */
const SHIP_HULL_FILL = 0.8;
/**
 * Extra clockwise turn of the containers beside the ship's flank (groups B, C): their long faces
 * look toward the camera in t15–t18.5 and, as in the reference, are lit while their right ends
 * fall into shade.
 */
const FLANK_CRATE_TURN = 55;

const lidT = (style: CrateStyle) => CRATE_SPECS[style].lid?.t ?? 0;
const crateLift = (style: CrateStyle) => CRATE_SPECS[style].h + lidT(style) + 0.005;

export function createMoonbase(opts: PropsOptions): PropsModule {
  const { heightAt, lowPower } = opts;
  const rand = makeRng((opts.seed ^ 0x6d6f6f6e) >>> 0);
  const group = new THREE.Group();
  group.name = 'moonbase';
  const disposables: { dispose(): void }[] = [];
  const colliders: CircleCollider[] = [];
  const contacts: ContactFootprint[] = [];
  const shadows = !lowPower;

  // ------------------------------------------------------------------ ship
  const shipYaw = yawForAzimuth(SHIP_AXIS_AZ);
  let hSum = 0;
  let hMin = Infinity;
  let hN = 0;
  for (let i = 0; i <= 12; i++)
    for (let j = 0; j <= 4; j++) {
      const p = shipLocal(-SHIP_LENGTH / 2 + (SHIP_LENGTH * i) / 12, -SHIP_HALF_WIDTH + (2 * SHIP_HALF_WIDTH * j) / 4);
      const h = heightAt(p.x, p.z);
      hSum += h;
      hMin = Math.min(hMin, h);
      hN++;
    }
  const shipBase = hSum / hN - 0.12;
  const ship = buildShipGeometry(shipBase - hMin + 0.8);
  const hullMaps = shipHullMaps(lowPower, 0x5a17);
  const hullMat = new THREE.MeshStandardMaterial({
    color: hullMaps ? 0xb0a9b2 : 0xaaa3ac,
    map: hullMaps?.map ?? null,
    bumpMap: hullMaps?.bump ?? null,
    bumpScale: 1.2,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.04,
  });
  // the reference hull reads lit on every face it shows (see propsShipFill.ts)
  addHullFill(hullMat, SHIP_HULL_FILL);
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a464b, roughness: 0.7, metalness: 0.08 });
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x4e4a54, roughness: 0.85, metalness: 0.04 });
  addHullFill(shadeMat, SHIP_HULL_FILL * 0.6);
  const shipHull = new THREE.Mesh(ship.hull, hullMat);
  const shipDark = new THREE.Mesh(ship.dark, darkMat);
  const shipShade = new THREE.Mesh(ship.shade, shadeMat);
  shipHull.name = 'ship-hull';
  for (const m of [shipHull, shipDark, shipShade]) {
    m.position.set(SHIP_CENTER.x, shipBase, SHIP_CENTER.z);
    m.rotation.y = shipYaw;
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    group.add(m);
  }
  disposables.push(ship.hull, ship.dark, ship.shade, hullMat, darkMat, shadeMat);
  if (hullMaps) disposables.push(hullMaps.map, hullMaps.bump);
  for (const c of ship.colliders) {
    const p = shipLocal(c.x, c.z);
    colliders.push({ x: p.x, z: p.z, radius: c.r });
  }
  for (const f of ship.footprint) {
    const p = shipLocal((f.x0 + f.x1) / 2, 0);
    contacts.push({ x: p.x, z: p.z, yawDeg: SHIP_AXIS_AZ, halfX: (f.x1 - f.x0) / 2, halfZ: f.hw, strength: 0.7, spread: 1.6, corner: 0.6 });
  }

  // ------------------------------------------------------------------ crates
  const crateMatrices: Record<CrateStyle, THREE.Matrix4[]> = { hazard: [], row: [], dark: [] };
  const tmp = new THREE.Matrix4();
  const rot = new THREE.Matrix4();

  /** Places a crate group; returns the world matrices of its crates (in item order). */
  const addCrateGroup = (g: CrateGroup): THREE.Matrix4[] => {
    const spec = CRATE_SPECS[g.style];
    const k = g.scale ?? 1;
    const lift = crateLift(g.style) * k;
    const w = spec.w * k;
    const d = spec.d * k;
    let halfX = 0;
    let halfZ = 0;
    for (const [dx, dz, level] of g.items)
      if (level === 0) {
        halfX = Math.max(halfX, Math.abs(dx) + w / 2);
        halfZ = Math.max(halfZ, Math.abs(dz) + d / 2);
      }
    const frame = groundFrame({ heightAt, x: g.x, z: g.z, yawDeg: g.yawDeg, halfX, halfZ, maxTilt: g.tilt ?? 0.08, sink: 0.06 * k, nx: Math.ceil(halfX / 1.2) });
    const cos = Math.cos(yawForAzimuth(g.yawDeg));
    const sin = Math.sin(yawForAzimuth(g.yawDeg));
    const out: THREE.Matrix4[] = [];
    for (const [dx, dz, level, dyaw] of g.items) {
      rot.makeRotationY(dyaw * DEG);
      tmp.makeTranslation(dx, (g.baseLift ?? 0) + level * lift, dz).multiply(rot);
      if (k !== 1) tmp.multiply(new THREE.Matrix4().makeScale(k, k, k));
      const m = frame.clone().multiply(tmp);
      crateMatrices[g.style].push(m);
      out.push(m);
      if (level === 0 && !g.baseLift) {
        const x = g.x + dx * cos + dz * sin;
        const z = g.z - dx * sin + dz * cos;
        colliders.push({ x, z, radius: Math.hypot(w, d) * 0.46 });
        contacts.push({ x, z, yawDeg: g.yawDeg - dyaw, halfX: w / 2, halfZ: d / 2, strength: 0.6, spread: 0.75 * k, corner: 0.12 * k });
      }
    }
    return out;
  };

  // tanks
  const tankMatrices: THREE.Matrix4[] = [];
  const addTank = (x: number, z: number, yawDeg: number) => {
    const m = groundFrame({ heightAt, x, z, yawDeg, halfX: TANK_RADIUS, halfZ: TANK_RADIUS, maxTilt: 0, sink: 0.05 });
    tankMatrices.push(m);
    colliders.push({ x, z, radius: TANK_RADIUS + 0.2 });
    contacts.push({ x, z, yawDeg: 0, halfX: TANK_RADIUS + 0.04, halfZ: TANK_RADIUS + 0.04, corner: TANK_RADIUS + 0.04, strength: 0.62, spread: 0.55 });
  };
  const addTankGroup = (g: TankGroup) => {
    const cos = Math.cos(yawForAzimuth(g.yawDeg));
    const sin = Math.sin(yawForAzimuth(g.yawDeg));
    for (const [dx, dz] of g.items) addTank(g.x + dx * cos + dz * sin, g.z - dx * sin + dz * cos, g.yawDeg + rand() * 360);
  };
  /** Tank standing on a container's recessed inner deck (core top + 0.28 · rim rise, as the kit builds it). */
  const tankOnCrate = (crate: THREE.Matrix4, style: CrateStyle, dx: number) => {
    const deck = CRATE_SPECS[style].h + 0.28 * (CRATE_SPECS[style].lid?.t ?? 0.07);
    tankMatrices.push(crate.clone().multiply(new THREE.Matrix4().makeTranslation(dx, deck, 0)));
  };

  // (A) white hazard containers on the shaded (-Z) side of the ship's head: two side by side and
  // one on top, parallel to the hull with their ends toward the nose/Sun. Out of every reference
  // frame (the reference shows nothing left of the ship in t15/t17), seen only when walking round.
  {
    const a = shipLocal(-8.6, -6.9);
    addCrateGroup({ style: 'hazard', x: a.x, z: a.z, yawDeg: SHIP_AXIS_AZ - 4, items: [[0, -0.68, 0, 0], [0.1, 0.7, 0, 180], [0.05, 0.02, 1, 2]] });
  }
  // (B) tanks + white hazard containers beside the ship's mid flank (t15–t18.5). Two pairs, each a
  // front tank with a partner behind-right; the right pair stands ≈ 0.9 m off the left pair's
  // shadow line (the low Sun throws ≈ 10 m shadows along the ship axis), so its front tank stays
  // lit on the left like the reference t18.5.
  {
    const t = shipLocal(-3.6, 8.9);
    addTankGroup({ x: t.x, z: t.z, yawDeg: SHIP_AXIS_AZ, items: [[-0.6, 0.45], [0.15, 1.35], [-0.25, -0.62], [0.66, 0.58]] });
    const c = shipLocal(0.5, 9.7);
    const hw = CRATE_SPECS.hazard.w / 2;
    const crates = addCrateGroup({ style: 'hazard', x: c.x, z: c.z, yawDeg: SHIP_AXIS_AZ + FLANK_CRATE_TURN, items: [[-(hw + 0.025), 0.08, 0, 0], [hw + 0.045, -0.1, 0, 180]] });
    tankOnCrate(crates[1], 'hazard', -0.5);
  }
  // (C) white modular containers stacked off the ship's rear quarter (t15/t17 right side)
  {
    const p = shipLocal(3.0, 15.0);
    addCrateGroup({ style: 'row', x: p.x, z: p.z, yawDeg: SHIP_AXIS_AZ + FLANK_CRATE_TURN, items: [[-1.25, 0, 0, 0], [1.25, 0.1, 0, 180], [1.3, -1.2, 0, 0], [0.7, -0.55, 1, 2]] });
  }
  // (D) one low row of four dark crates on the left of t01: side by side in two touching pairs,
  // short striped ends toward the spawn (local X = the t01 view axis, local Z = its right).
  addCrateGroup({
    style: 'dark',
    x: T01_DARK_ROW.x,
    z: T01_DARK_ROW.z,
    yawDeg: T01_DARK_ROW.yawDeg,
    items: [[0.05, 2.12, 0, 1.5], [-0.04, 0.75, 0, 180], [0.1, -0.75, 0, -1], [0, -2.12, 0, 181.5]],
  });
  // (E) second white container row + tank cluster around the t41.5 viewpoint (t41.5, t43): rover
  // centre-left, a short row of modules receding to the right and climbing the west flank of the
  // knoll east of the viewpoint, its tanks just beyond the row's far end, higher up the slope, and
  // a dark crate close on the right. The row follows the slope (tilt up to ≈ 8°).
  {
    const L = T41_ROW.left;
    const R = T41_ROW.right;
    const rowAz = (Math.atan2(R.x - L.x, -(R.z - L.z)) * 180) / Math.PI;
    const c = { x: (L.x + R.x) / 2, z: (L.z + R.z) / 2 };
    const m = CRATE_SPECS.row.w + 0.06;
    addCrateGroup({ style: 'row', x: c.x, z: c.z, yawDeg: rowAz, tilt: 0.14, items: [[-m, 0, 0, 0], [0, 0, 0, 180], [m, 0, 0, 0]] });
    addTankGroup({ x: T41_TANKS.x, z: T41_TANKS.z, yawDeg: T41_TANKS.yawDeg, items: T41_TANKS.items });
    // single dark crate close on the right, its long striped face toward the viewpoint (t41.5, t43)
    const v = T41_VIEW;
    const d = polar(v.yawDeg + 50, 3.7, v.x, v.z);
    addCrateGroup({ style: 'dark', x: d.x, z: d.z, yawDeg: v.yawDeg - 12, items: [[0, 0, 0, 0]] });
  }
  // (F) backlit group toward the Sun (t08, t12, t21, t30): two row modules side by side turned so
  // the row recedes to the right in t12, a third one behind its right end, a light module on top at
  // the back-left, and four tanks in two overlapping pairs beyond (each pair: a front tank with a
  // partner behind-right as seen from t12).
  {
    const c = SUNWARD_CRATES;
    const rowYaw = 336.7;
    addCrateGroup({ style: 'row', x: c.x, z: c.z, yawDeg: rowYaw, items: [[-1.25, 0, 0, 0], [1.25, 0, 0, 180], [1.5, -1.2, 0, 0]] });
    // light module on top (a dark crate in shade would read near-black; the reference shows a light one)
    addCrateGroup({ style: 'row', x: c.x, z: c.z, yawDeg: rowYaw, baseLift: crateLift('row') - 0.06, items: [[-0.55, -0.05, 0, 2]] });
    addTankGroup({ x: SUNWARD_TANKS.x, z: SUNWARD_TANKS.z, yawDeg: 164, items: [[0.9, 0], [0.5, 0.8], [-0.85, 0.05], [-1.25, 0.85]] });
  }

  // (H) lone dark crate with a free top in the t47 foreground, out in the sunward valley. The
  // reference draws it larger than the base's crates (lid edge near eye level ≈ 2–5 m away), so it
  // is scaled up; nothing of the same family stands next to it for comparison.
  addCrateGroup({ style: 'dark', x: T47_CRATE.x, z: T47_CRATE.z, yawDeg: T47_CRATE.yawDeg, scale: T47_CRATE.scale, items: [[0, 0, 0, 0]] });

  // (G) greenhouse far beyond the sunward crest (t08, t12, t21, t30, t37–t47)
  const R = GREENHOUSE_RADIUS;
  let domeGround = Infinity;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    domeGround = Math.min(domeGround, heightAt(GREENHOUSE_CENTER.x + Math.cos(a) * R, GREENHOUSE_CENTER.z + Math.sin(a) * R));
  }
  domeGround = Math.min(domeGround, heightAt(GREENHOUSE_CENTER.x, GREENHOUSE_CENTER.z)) - 0.3;
  const greenhouse = createGreenhouse(R, 1.6, lowPower, opts.seed);
  greenhouse.object.position.set(GREENHOUSE_CENTER.x, domeGround, GREENHOUSE_CENTER.z);
  group.add(greenhouse.object);
  disposables.push(greenhouse);
  colliders.push({ x: GREENHOUSE_CENTER.x, z: GREENHOUSE_CENTER.z, radius: R + 2 });
  contacts.push({ x: GREENHOUSE_CENTER.x, z: GREENHOUSE_CENTER.z, yawDeg: 0, halfX: R + 1.5, halfZ: R + 1.5, corner: R + 1.5, strength: 0.55, spread: 4 });
  {
    // backlit dome shadow falling toward the base (dark patch in front of the dome, t12)
    const s = polar(72, R * 0.95, GREENHOUSE_CENTER.x, GREENHOUSE_CENTER.z);
    contacts.push({ x: s.x, z: s.z, yawDeg: 72, halfX: R * 0.8, halfZ: R * 0.55, corner: R * 0.5, strength: 0.7, spread: 6 });
  }

  // ------------------------------------------------------------------ instanced meshes
  const tint = new THREE.Color();
  for (const style of ['hazard', 'row', 'dark'] as CrateStyle[]) {
    const mats = crateMatrices[style];
    if (!mats.length) continue;
    const geo = crateGeometry(CRATE_SPECS[style]);
    const { material: mat, textures } = createCrateMaterial(style, lowPower, 0xc0ffee + style.length * 7919);
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      const v = 0.9 + rand() * 0.1;
      mesh.setColorAt(i, tint.setRGB(v, v, v * (0.98 + rand() * 0.02)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    // The flank containers stand ≈ 4–6 m downstream of the group B tanks along the 10° Sun's shadow
    // direction, so the tanks' ≈ 10 m shadows would cross their lit fronts in t15–t18.5 for any
    // placement that keeps the reference composition (tanks left of the containers at about the same
    // depth); the reference fronts read evenly lit, so these containers do not receive cast shadows
    // (their own N·L shading, the shaded right ends included, is unchanged).
    mesh.receiveShadow = shadows && style !== 'hazard';
    mesh.name = `crates-${style}`;
    group.add(mesh);
    disposables.push(geo, mat, mesh, ...textures);
  }

  {
    const geo = tankGeometry(lowPower);
    const map = tankDetailMap(lowPower, 0x7a2c);
    // light paint: the sunlit left edge reads ≈ 180 like the reference (t15–t18.5)
    const mat = new THREE.MeshStandardMaterial({ color: 0xd6d1da, map, roughness: TANK_PAINT.roughness + 0.06, metalness: TANK_PAINT.metalness });
    // Mild regolith bounce only: a strong boost lifts the close-up shadow side (ref t18.5 ≈ 3–5) far
    // more than it helps distant backlit tanks, and the close-up is the more prominent view.
    bindEnvironmentBoost(mat, 1.1);
    const mesh = new THREE.InstancedMesh(geo, mat, tankMatrices.length);
    tankMatrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.name = 'tanks';
    group.add(mesh);
    disposables.push(geo, mat, mesh);
    if (map) disposables.push(map);
  }

  // ------------------------------------------------------------------ rovers
  const roverPoses = [
    // rover 1: ≈ 16 m ahead-left of the spawn, right of the dark crate row (t01); close on the left in t05
    { x: T01_ROVER.x, z: T01_ROVER.z, yawDeg: T01_ROVER.yawDeg },
    // rover 2: centre-left of the t41.5 view
    { ...polar(T41_VIEW.yawDeg - 8, 16, T41_VIEW.x, T41_VIEW.z), yawDeg: T41_VIEW.yawDeg + 8 },
  ];
  const roverGeo = roverGeometry(lowPower);
  const roverMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
  const rovers = new THREE.InstancedMesh(roverGeo, roverMat, roverPoses.length);
  const beaconGeo = new THREE.SphereGeometry(ROVER_BEACON_RADIUS, 8, 6);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a });
  const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, roverPoses.length);
  roverPoses.forEach((r, i) => {
    const m = groundFrame({ heightAt, x: r.x, z: r.z, yawDeg: r.yawDeg, halfX: ROVER_HALF_LENGTH * 0.85, halfZ: ROVER_HALF_WIDTH * 0.85, maxTilt: 0.2, sink: 0.04 });
    rovers.setMatrixAt(i, m);
    beacons.setMatrixAt(i, m.clone().multiply(new THREE.Matrix4().makeTranslation(ROVER_BEACON.x, ROVER_BEACON.y, ROVER_BEACON.z)));
    colliders.push({ x: r.x, z: r.z, radius: Math.hypot(ROVER_HALF_LENGTH, ROVER_HALF_WIDTH) * 0.85 });
    contacts.push({ x: r.x, z: r.z, yawDeg: r.yawDeg, halfX: ROVER_HALF_LENGTH * 0.8, halfZ: ROVER_HALF_WIDTH * 0.8, strength: 0.42, spread: 0.6, corner: 0.4 });
  });
  rovers.instanceMatrix.needsUpdate = true;
  beacons.instanceMatrix.needsUpdate = true;
  rovers.computeBoundingSphere();
  beacons.computeBoundingSphere();
  rovers.castShadow = shadows;
  rovers.receiveShadow = shadows;
  group.add(rovers, beacons);
  disposables.push(roverGeo, roverMat, rovers, beaconGeo, beaconMat, beacons);

  // ------------------------------------------------------------------ contact darkening
  const contactShadows = createContactShadows(heightAt, contacts, lowPower);
  group.add(contactShadows.mesh);
  disposables.push(contactShadows);

  // ------------------------------------------------------------------ frame update
  let sunLight: THREE.DirectionalLight | null = null;
  let searched = 0;
  const sunDir = new THREE.Vector3();
  const lp = new THREE.Vector3();
  const tp = new THREE.Vector3();

  const update = (frame: FrameContext) => {
    // rover beacon: short amber blink every ~1.6 s
    const phase = (frame.elapsed % 1.6) / 1.6;
    const k = phase < 0.08 ? 1 : 0.12;
    beaconMat.color.setRGB(1.0 * k, 0.48 * k, 0.16 * k);
    // greenhouse glass / canopy follow the scene's sun light (found lazily)
    if (!sunLight && searched < 3) {
      searched++;
      let root: THREE.Object3D = group;
      while (root.parent) root = root.parent;
      root.traverse((o) => {
        if (!sunLight && (o as THREE.DirectionalLight).isDirectionalLight) sunLight = o as THREE.DirectionalLight;
      });
    }
    if (sunLight) {
      const light: THREE.DirectionalLight = sunLight;
      light.getWorldPosition(lp);
      light.target.getWorldPosition(tp);
      sunDir.subVectors(lp, tp);
      if (sunDir.lengthSq() > 1e-8) greenhouse.setSunDirection(sunDir.normalize());
    }
  };

  return {
    object: group,
    colliders,
    spawn: { ...MOONBASE_SPAWN },
    update,
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
