import { describe, expect, it } from 'vitest';
import { Group, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { bodyDirectionAt, createGeometrySite, type Body } from '../explorer/geometry';
import { DEFAULT_CONFIG, interpolateLocalGrid } from '../navigator/math';
import type { LandingSiteEntry } from '../navigator/types';
import { readVisibilityAt } from '../navigator/visibilityReading';
import { latLonToSphereUnit } from './lunarTerrainEngine';
import { layoutOrbitalDirections, type OrbitalDirectionsInput } from './orbitalDirections';
import { rotateMoonOnOwnAxes } from './ownAxisRotation';
import { buildSiteReadout } from './siteReadings';

const dataset = parseNavigatorDataset(rawDataset);
const ridge = dataset.sites.find(site => site.id === 'shackleton_ridge')!;
const DEG = Math.PI / 180;
type ExpectedBody = { az: number; el: number; vector: readonly [number, number, number] };
type Fixture = { point: 'ridge' | 'farside'; epoch: number; utc: string; sun: ExpectedBody; earth: ExpectedBody };

/**
 * Independent Python scalar ENU oracles, copied as constants so CI is self-contained.
 * Dataset SHA256: 100452d2bb54dc278ec8f6de44efb3cb2b6d4851ac06bfa90f0d66620fdacfb2.
 * d = E*cos(el)*sin(az) + N*cos(el)*cos(az) + U*sin(el), then
 * Three-local = (-ME.x, ME.z, ME.y). Free-point constants additionally restore the
 * finite body range from reference Cartesian position before observer subtraction.
 * These verify transformations of bundled samples, not independent SPICE accuracy.
 */
const fixtures: readonly Fixture[] = [
  { point: 'ridge', epoch: 0, utc: '2026-11-15T00:00:00Z',
    sun: { az: 251.918, el: 1.386, vector: [0.413451287174506, -0.027165285432960866, 0.9101209152640598] },
    earth: { az: 134.856, el: -3.941, vector: [-0.9970358200560775, 0.06197149152071787, -0.045597234168343735] } },
  { point: 'ridge', epoch: 72, utc: '2026-11-18T00:00:00Z',
    sun: { az: 215.403, el: 1.103, vector: [-0.20936461623945798, -0.027071709704840657, 0.9774628279380047] },
    earth: { az: 131.269, el: 0.071, vector: [-0.9940604464239374, -0.007570682665732077, -0.10856571106669471] } },
  { point: 'ridge', epoch: 87, utc: '2026-11-18T15:00:00Z',
    sun: { az: 207.803, el: 1.063, vector: [-0.336826619820808, -0.0270404725488149, 0.9411783258365153] },
    earth: { az: 130.792, el: 0.954, vector: [-0.9928766601359815, -0.02291931185359531, -0.11692152454264507] } },
  { point: 'ridge', epoch: 168, utc: '2026-11-22T00:00:00Z',
    sun: { az: 166.812, el: 1.001, vector: [-0.8716769806282512, -0.026813627803972163, 0.4893467797041335] },
    earth: { az: 131.161, el: 4.975, vector: [-0.989505677723983, -0.09301121508149773, -0.11057769947446222] } },
  { point: 'farside', epoch: 0, utc: '2026-11-15T00:00:00Z',
    sun: { az: 268.28960315521044, el: 24.42120909641788, vector: [0.41344150797693036, -0.027177176381316774, 0.9101250027142977] },
    earth: { az: 38.34646054592687, el: -85.79949020939347, vector: [-0.9973138255463223, 0.05744573949514477, -0.045443595676571996] } },
  { point: 'farside', epoch: 87, utc: '2026-11-18T15:00:00Z',
    sun: { az: 268.3536043147543, el: -19.684276006838903, vector: [-0.33683687283747216, -0.027052114206870488, 0.9411743219053583] },
    earth: { az: 103.16609170858514, el: -83.13264552757335, vector: [-0.992825631381335, -0.027235282941010797, -0.11642811101867438] } },
  { point: 'farside', epoch: 168, utc: '2026-11-22T00:00:00Z',
    sun: { az: 266.8622576356575, el: -60.65440294908256, vector: [-0.8716795366298322, -0.02682509395094968, 0.4893415982269685] },
    earth: { az: 131.45178749707108, el: -81.55656388654252, vector: [-0.9891613026855309, -0.0972018893499976, -0.11005321429315142] } },
];

function siteFor(fixture: Fixture): LandingSiteEntry {
  if (fixture.point === 'ridge') return ridge;
  // Deliberately supply no terrain, local grid or engineering payload. The real
  // geometric readout must bypass those unavailable fields for a free point.
  return createGeometrySite(dataset, 0, 180) as LandingSiteEntry;
}

function direction(site: LandingSiteEntry, epoch: number, body: Body): Vector3 {
  const angle = bodyDirectionAt(site, epoch, body);
  const local = latLonToSphereUnit(angle.latDeg, angle.lonEastDeg);
  return new Vector3(local.x, local.y, local.z);
}

function inputFor(site: LandingSiteEntry, epoch: number): OrbitalDirectionsInput {
  const camera = new PerspectiveCamera(50, 1.6, 0.1, 100);
  camera.position.set(3, 3, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return {
    observerLocal: latLonToSphereUnit(site.center.latitude_deg, site.center.longitude_east_deg),
    sunDirectionLocal: direction(site, epoch, 'sun'), earthDirectionLocal: direction(site, epoch, 'earth'),
    moonMatrixWorld: new Matrix4().makeRotationX(Math.PI), camera,
    viewport: { width: 1600, height: 1000 },
  };
}

const reading = (site: LandingSiteEntry, epochIdx: number, terrainHorizonDeg = ridge.horizon_elev_deg) =>
  buildSiteReadout({ dataset, site, epochIdx, terrainHorizonDeg, config: DEFAULT_CONFIG });

describe('orbital directions from actual site and UTC samples', () => {
  it('matches independent Three-vector and ENU oracles for all seven catalogued/free-point cases', () => {
    for (const fixture of fixtures) {
      const site = siteFor(fixture);
      expect(dataset.mission_window.timestamps_utc[fixture.epoch]).toBe(fixture.utc);
      const phi = site.center.latitude_deg * DEG;
      const lambda = site.center.longitude_east_deg * DEG;
      const up = new Vector3().copy(latLonToSphereUnit(site.center.latitude_deg, site.center.longitude_east_deg));
      // Independent E/N basis after the documented ME→Three mapping.
      const east = new Vector3(Math.sin(lambda), 0, Math.cos(lambda));
      const north = new Vector3(Math.sin(phi) * Math.cos(lambda), Math.cos(phi), -Math.sin(phi) * Math.sin(lambda));
      for (const body of ['sun', 'earth'] as const) {
        const expected = fixture[body];
        const actual = direction(site, fixture.epoch, body);
        expected.vector.forEach((value, axis) => expect(actual.getComponent(axis)).toBeCloseTo(value, 11));
        expect(actual.length()).toBeCloseTo(1, 12);
        expect(actual.dot(up)).toBeCloseTo(Math.sin(expected.el * DEG), 11);
        const recoveredAz = (Math.atan2(actual.dot(east), actual.dot(north)) / DEG + 360) % 360;
        expect(recoveredAz).toBeCloseTo(expected.az, 8);
        expect(site.sky_series[`${body}_el_deg`][fixture.epoch]).toBeCloseTo(expected.el, 9);
      }
      const layout = layoutOrbitalDirections(inputFor(site, fixture.epoch));
      for (const body of [layout.sun, layout.earth]) {
        expect(['ready', 'head-on']).toContain(body.status);
        expect(body.marker).not.toBeNull();
      }
      expect(reading(site, fixture.epoch).kind).toBe(fixture.point === 'ridge' ? 'terrain' : 'geometric');
    }
  });

  it('advances both displayed rays with the same real UTC sample instead of retaining the first sky state', () => {
    const indices = [0, 87, 168];
    const layouts = indices.map(epoch => layoutOrbitalDirections(inputFor(ridge, epoch)));
    expect(layouts[0].sun.directionTip).not.toEqual(layouts[1].sun.directionTip);
    expect(layouts[1].sun.directionTip).not.toEqual(layouts[2].sun.directionTip);
    expect(layouts[0].earth.directionTip).not.toEqual(layouts[1].earth.directionTip);
    expect(layouts[1].earth.directionTip).not.toEqual(layouts[2].earth.directionTip);
    const readouts = indices.map(epoch => reading(ridge, epoch));
    expect(readouts.map(item => item.timestamp)).toEqual(indices.map(epoch => dataset.mission_window.timestamps_utc[epoch]));
    expect(readouts[0].earth.label).toBe('Earth below modeled horizon');
    expect(readouts[1].earth.label).toBe('Whole Earth in view');
    expect(readouts[2].earth.label).toBe('Whole Earth in view');
  });

  it('keeps the real partially visible Earth direction at sample72 despite a failed whole-disk criterion', () => {
    const earth = readVisibilityAt({
      body: 'earth', epochIdx: 72, criterion: 'full-disk',
      series: {
        azimuthDeg: ridge.sky_series.earth_az_deg, elevationDeg: ridge.sky_series.earth_el_deg,
        angularRadiusDeg: dataset.mission_window.earth_angular_radius_deg,
      },
      horizon: { kind: 'terrain-profile', azimuthDeg: dataset.horizon_azimuths_deg, elevationDeg: ridge.horizon_elev_deg },
    });
    expect(earth).toMatchObject({ status: 'known', diskState: 'partial', centerPosition: 'above', criterionSatisfied: false });
    if (earth.status !== 'known') throw new Error('Expected the saved partial-Earth sample.');
    expect(earth.horizonElevationDeg).toBeCloseTo(0.015579, 9);
    expect(earth.centerClearanceDeg).toBeCloseTo(0.055421, 9);
    expect(earth.criterionClearanceDeg).toBeCloseTo(-0.869479, 9);
    expect(reading(ridge, 72).earth.label).toBe('Earth partly in view');
    const layout = layoutOrbitalDirections(inputFor(ridge, 72));
    expect(['ready', 'head-on']).toContain(layout.earth.status);
    expect(layout.earth.marker).not.toBeNull();
    // No horizon or DTE result enters the projection API. A directional icon is
    // not the full-disk test, and does not establish a usable radio link.
  });

  it('changes projection with camera and own-axis rotation while preserving the exact site/time/readout', () => {
    const epoch = 168;
    const input = inputFor(ridge, epoch);
    const originalReading = reading(ridge, epoch);
    const sourceSnapshot = JSON.stringify({ site: ridge, utc: dataset.mission_window.timestamps_utc[epoch], readout: originalReading });
    const directionsSnapshot = JSON.stringify([input.sunDirectionLocal, input.earthDirectionLocal]);
    const initial = layoutOrbitalDirections(input);
    input.camera.position.set(-4, 3, 2);
    input.camera.lookAt(0, 0, 0);
    input.camera.updateMatrixWorld(true);
    const movedCamera = layoutOrbitalDirections(input);
    expect(movedCamera.observer.point).not.toEqual(initial.observer.point);
    expect(movedCamera.sun.directionTip).not.toEqual(initial.sun.directionTip);
    const moon = new Group();
    moon.rotation.x = Math.PI;
    rotateMoonOnOwnAxes(moon, input.camera, 0.7, -0.25);
    input.moonMatrixWorld = moon.matrixWorld.clone();
    const spun = layoutOrbitalDirections(input);
    expect(spun.observer.point).not.toEqual(movedCamera.observer.point);
    expect(spun.earth.directionTip).not.toEqual(movedCamera.earth.directionTip);
    expect(JSON.stringify([input.sunDirectionLocal, input.earthDirectionLocal])).toBe(directionsSnapshot);
    expect(reading(ridge, epoch)).toEqual(originalReading);
    expect(JSON.stringify({ site: ridge, utc: dataset.mission_window.timestamps_utc[epoch], readout: originalReading })).toBe(sourceSnapshot);
  });

  it('uses a local-grid offset only as a visual ray anchor while preserving catalogued central sky directions', () => {
    const epoch = 168;
    const center = interpolateLocalGrid(ridge, 0, 0);
    const offset = interpolateLocalGrid(ridge, 0.6, -0.4);
    // This catalogued grid spans ±1000m (the display scaffold of a free point
    // has different bounds and must not be substituted for this dataset).
    expect(offset.dxM).toBeCloseTo(600, 6);
    expect(offset.dyM).toBeCloseTo(-400, 6);
    const input = inputFor(ridge, epoch);
    input.observerLocal = latLonToSphereUnit(center.latitudeDeg, center.longitudeEastDeg);
    const central = layoutOrbitalDirections(input);
    const originalDirections = JSON.stringify([input.sunDirectionLocal, input.earthDirectionLocal]);
    input.observerLocal = latLonToSphereUnit(offset.latitudeDeg, offset.longitudeEastDeg);
    const shifted = layoutOrbitalDirections(input);
    expect(shifted.observer.point).not.toEqual(central.observer.point);
    expect(shifted.sun.directionTip).not.toEqual(central.sun.directionTip);
    expect(JSON.stringify([input.sunDirectionLocal, input.earthDirectionLocal])).toBe(originalDirections);
    expect(direction(ridge, epoch, 'sun').x).toBeCloseTo(-0.8716769806282512, 11);
    const readout = reading(ridge, epoch, offset.horizonElevDeg);
    expect(readout.kind).toBe('terrain');
    expect(readout.timestamp).toBe(dataset.mission_window.timestamps_utc[epoch]);
    // The numeric horizon may change with the grid. Its sampled sky tracks stay
    // those of the catalogued center; the display offset is not fresh ephemeris.
    expect(readout.modelNote).toContain('Sky positions refer to the catalogued site center');
  });

  it('retains the farside geometry model and below-horizon Earth reading when camera culling changes', () => {
    const fixture = fixtures.find(item => item.point === 'farside' && item.epoch === 168)!;
    const site = siteFor(fixture);
    const originalReading = reading(site, 168, []);
    expect(originalReading).toMatchObject({ kind: 'geometric', basis: 'Approximate geometry · geometric horizon' });
    expect(originalReading.earth.label).toBe('Earth center below horizon');
    expect(site.sky_series.earth_el_deg[168]).toBeCloseTo(-81.55656388654252, 9);
    const input = inputFor(site, 168);
    input.camera.position.set(0, 0, 5);
    input.camera.lookAt(0, 0, 0);
    input.camera.updateMatrixWorld(true);
    const output = layoutOrbitalDirections(input);
    expect(output.observer.status).toBe('far-side');
    expect(output.earth.lineStart).toBeNull();
    expect(['ready', 'head-on']).toContain(output.earth.status);
    expect(output.earth.marker).not.toBeNull();
    expect(reading(site, 168, [])).toEqual(originalReading);
    expect(site.id).not.toBe(ridge.id);
  });
});
