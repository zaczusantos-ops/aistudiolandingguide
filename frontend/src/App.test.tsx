import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import statusExample from '../../contracts/examples/science-status.json';
import datasetJson from './data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset, parseScienceStatus } from './contract';
import {
  computeSolarIllumFraction,
  DEFAULT_CONFIG,
  evaluateLiveSite,
  interpolateHorizon,
  interpolateLocalGrid,
} from './navigator/math';
import {
  addSiteSlot,
  computeWindowSlice,
  evaluateWindowMetrics,
  findNearestPrecomputedSite,
  parseUtcDateHourToEpochIndex,
  removeSiteSlot,
  setSiteSlotAt,
  SiteSlotState,
  swapSiteSlots,
} from './landing-guide/state';
import {
  createCustomLandingSite,
  projectBodySkySeries,
} from './landing-guide/customSiteBuilder';
import { buildLunarAtlasData } from './landing-guide/lunarTerrainEngine';
import { App } from './App';

afterEach(() => {
  cleanup();
});

describe('Lunar Landing Site Navigator — Landing Guide', () => {
  it('validates the placeholder science contract and NASA LOLA/SPICE v1 dataset', () => {
    const parsed = parseScienceStatus(statusExample);
    expect(parsed.status).toBe('not_implemented');

    const dataset = parseNavigatorDataset(datasetJson);
    expect(dataset.sites.length).toBe(10);
    expect(dataset.horizon_azimuths_deg.length).toBe(360);
    expect(dataset.mission_window.timestamps_utc.length).toBe(721);
  });

  it('computes solar geometry, 1–4 slot management, UTC slicing, and nearest polar lookup', () => {
    expect(computeSolarIllumFraction(-0.5, 0, 0.267)).toBe(0);
    expect(computeSolarIllumFraction(0, 0, 0.267)).toBeCloseTo(0.5, 5);
    expect(computeSolarIllumFraction(0.5, 0, 0.267)).toBe(1);
    expect(interpolateHorizon(359.5, [0, 180], [2, -2])).toBeCloseTo(1.988888, 3);

    const dataset = parseNavigatorDataset(datasetJson);
    const site = dataset.sites[0];
    const t0 = performance.now();
    const terrain = interpolateLocalGrid(site, 0.25, -0.5);
    const live = evaluateLiveSite(
      site,
      0.25,
      -0.5,
      dataset.horizon_azimuths_deg,
      dataset.mission_window,
      DEFAULT_CONFIG,
    );
    const elapsedMs = performance.now() - t0;

    expect(terrain.horizonElevDeg.length).toBe(360);
    expect(live.score.total_0_100).toBeGreaterThanOrEqual(0);
    expect(live.score.total_0_100).toBeLessThanOrEqual(100);
    expect(elapsedMs).toBeLessThan(100);

    let slots: SiteSlotState[] = [{ siteId: dataset.sites[0].id, offsetXNorm: 0, offsetYNorm: 0 }];
    slots = addSiteSlot(slots, dataset.sites);
    slots = addSiteSlot(slots, dataset.sites);
    slots = addSiteSlot(slots, dataset.sites);
    expect(slots.length).toBe(4);
    slots = addSiteSlot(slots, dataset.sites);
    expect(slots.length).toBe(4);

    slots = setSiteSlotAt(slots, 2, 'malapert_massif');
    expect(slots[2].siteId).toBe('malapert_massif');

    slots = swapSiteSlots(slots, 0, 1);
    expect(slots[1].siteId).toBe(dataset.sites[0].id);

    slots = removeSiteSlot(slots, 3);
    slots = removeSiteSlot(slots, 2);
    slots = removeSiteSlot(slots, 1);
    expect(slots.length).toBe(1);
    slots = removeSiteSlot(slots, 0);
    expect(slots.length).toBe(1);

    const badDate = parseUtcDateHourToEpochIndex(
      '2026-10-01',
      0,
      dataset.mission_window.timestamps_utc,
    );
    expect(badDate.valid).toBe(false);
    expect(badDate.errorMessage).toMatch(/2026-11-15/);

    const goodDate = parseUtcDateHourToEpochIndex(
      '2026-11-20',
      6,
      dataset.mission_window.timestamps_utc,
    );
    expect(goodDate.valid).toBe(true);
    const slice7d = computeWindowSlice(dataset.mission_window.timestamps_utc, goodDate.startIdx!, 7);
    expect(slice7d.totalHours).toBe(168);

    const winMetrics = evaluateWindowMetrics(live, dataset.mission_window, DEFAULT_CONFIG, slice7d);
    expect(winMetrics.meanIllumFraction).toBeGreaterThanOrEqual(0);
    expect(winMetrics.combinedDutyCyclePct).toBeGreaterThanOrEqual(winMetrics.dteDutyCyclePct);

    const outside = findNearestPrecomputedSite(-40, 2.7, dataset.sites);
    expect(outside.withinLolaCoverage).toBe(false);
    expect(outside.site.id).toBeTruthy();
  });

  it('reprojects SPICE Sun/Earth vectors accurately and synthesizes custom unvisited landing sites on LOLA DEM', () => {
    const dataset = parseNavigatorDataset(datasetJson);
    const refSite = dataset.sites[0];
    const targetSite = dataset.sites[3];

    const projected = projectBodySkySeries(
      refSite,
      targetSite.center.latitude_deg,
      targetSite.center.longitude_east_deg,
    );

    const angleDiff = (a: number, b: number) => {
      const d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    };

    for (let i = 0; i < projected.sunAzDeg.length; i += 72) {
      expect(angleDiff(projected.sunAzDeg[i], targetSite.sky_series.sun_az_deg[i])).toBeLessThan(0.08);
      expect(Math.abs(projected.sunElDeg[i] - targetSite.sky_series.sun_el_deg[i])).toBeLessThan(0.05);
      expect(angleDiff(projected.earthAzDeg[i], targetSite.sky_series.earth_az_deg[i])).toBeLessThan(0.25);
      expect(Math.abs(projected.earthElDeg[i] - targetSite.sky_series.earth_el_deg[i])).toBeLessThan(0.25);
    }

    const atlas = buildLunarAtlasData(dataset.sites, 128, 64);

    const customPolar = createCustomLandingSite({
      latDeg: -83.4,
      lonEastDeg: 42.5,
      atlas,
      referenceSites: dataset.sites,
      horizonAzDeg: dataset.horizon_azimuths_deg,
      missionWindow: dataset.mission_window,
    });
    expect(customPolar.name).toBe('Custom (83.40°S, 42.5°E)');
    expect(customPolar.horizon_elev_deg.length).toBe(360);
    expect(customPolar.local_grid.nodes.length).toBe(25);
    expect(Number.isFinite(customPolar.center.elevation_m)).toBe(true);

    const customMid = createCustomLandingSite({
      latDeg: -43.3,
      lonEastDeg: 348.8,
      atlas,
      referenceSites: dataset.sites,
      horizonAzDeg: dataset.horizon_azimuths_deg,
      missionWindow: dataset.mission_window,
    });
    expect(customMid.name).toBe('Custom (43.30°S, 348.8°E)');
    expect(customMid.sky_series.elfo_constellation_visible.some(Boolean)).toBe(false);
    expect(customMid.description).toMatch(/Outside the 80°S–90°S polar ELFO/i);
  });

  it('renders pure-black casual interactive brief without How it works modal and lets users explore data & launch', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /Landing\s*Guide\./i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /How it works/i })).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: /Eternal peaks beside pitch-black craters\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Drag the slider to watch the Sun skim the mountains\./i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /When Earth disappears behind a crater wall\./i })).toBeInTheDocument();
    expect(
      screen.getByAltText(/NASA LRO LOLA LDEM_80S_80M hillshaded elevation map/i),
    ).toBeInTheDocument();

    // Interactive South Pole landmark hotspot
    const missionSection = document.getElementById('mission')!;
    fireEvent.click(within(missionSection).getByRole('button', { name: /^Inspect Malapert Massif$/i }));
    expect(within(missionSection).getByRole('button', { name: /Inspect Malapert Massif in 3D/i })).toBeInTheDocument();

    // Interactive Sunlight horizon scrubber & toggle
    const energySection = document.getElementById('energy')!;
    fireEvent.click(within(energySection).getByRole('button', { name: /Shackleton Crater Floor/i }));
    const slider = within(energySection).getByRole('slider', { name: /Scrub UTC hour across 30 days/i });
    fireEvent.change(slider, { target: { value: '360' } });

    // Interactive Comms ELFO toggle
    const relayBtn = screen.getByRole('button', { name: /Direct Earth Only/i });
    fireEvent.click(relayBtn);
    expect(screen.getByRole('button', { name: /\+ ELFO Relay On/i })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Open Explorer/i })[0]);

    expect(screen.getByRole('button', { name: /Return to Mission Brief/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Charts$/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Data/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Sites \(1\)/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /^Time$/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Orbit 3D' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Astronaut' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('drops custom unvisited landing pins anywhere on the Moon, manages 1–4 sites, and switches Astronaut view', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open Explorer/i })[0]);

    // Drop custom unvisited landing coordinates via SelectionPopover
    fireEvent.click(screen.getByRole('button', { name: /Sites \(1\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Tycho Crater/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Custom \(43\.30°S, 348\.8°E\)/i);

    fireEvent.change(screen.getByLabelText(/Custom latitude degrees/i), { target: { value: '-83.4' } });
    fireEvent.change(screen.getByLabelText(/Custom East longitude degrees/i), { target: { value: '42.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Drop custom pin/i }));
    expect((screen.getByLabelText('Select Site A') as HTMLSelectElement).value).toBe('custom_S83_40_42_50');

    fireEvent.click(screen.getByRole('button', { name: /Add comparison site/i }));
    expect(screen.getByRole('button', { name: /Sites \(2\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Compare with dark PSR/i }));
    expect((screen.getByLabelText('Select Site B') as HTMLSelectElement).value).toBe(
      'shackleton_psr_floor',
    );

    fireEvent.click(screen.getByRole('button', { name: /Add comparison site/i }));
    expect(screen.getByRole('button', { name: /Sites \(3\)/i })).toBeInTheDocument();
    const siteList = screen.getByRole('list', { name: /South Pole candidate sites/i });
    fireEvent.click(within(siteList).getByRole('button', { name: /Malapert Massif/i }));
    expect((screen.getByLabelText('Select Site C') as HTMLSelectElement).value).toBe(
      'malapert_massif',
    );

    // Astronaut view: first-person stage with only the illustrative overlay; the explorer HUD is hidden.
    fireEvent.click(screen.getByRole('button', { name: 'Astronaut' }));
    expect(screen.getByTestId('astronaut-stage')).toBeInTheDocument();
    const nakamura = screen.getByRole('button', { name: /^Nakamura 1979\b/ });
    const lognonne = screen.getByRole('button', { name: /^Lognonné 2003\b/ });
    for (const pill of [nakamura, lognonne]) {
      expect(pill).toHaveAccessibleName(/illustrative/i);
      expect(pill).toHaveAccessibleName(/not catalog data/i);
      expect(pill.textContent ?? '').not.toMatch(/magnitude|\bM\s?\d/i);
      fireEvent.click(pill); // purely visual tremor; must not throw without WebGL
    }
    const lightingNote = screen.getByText(/Illustrative lighting/i);
    expect(lightingNote).toHaveAttribute('title', expect.stringMatching(/drawn 10° above the horizon/));
    expect(lightingNote).toHaveTextContent(/dataset Sun elevation at this time: -?\d+\.\d°/);
    expect(screen.getByTestId('fpv-stick-left')).toBeInTheDocument();
    expect(screen.getByTestId('fpv-stick-right')).toBeInTheDocument();
    for (const name of [/Return to Mission Brief/i, /^Charts$/i, /^Data/i, /Sites \(/i, /^Time$/i, /^Moon$/, /^Topography$/, /^Astronaut$/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Selected lunar sites/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Look Sun/i })).not.toBeInTheDocument();

    // The small exit control returns to Orbit 3D with the HUD restored.
    fireEvent.click(screen.getByRole('button', { name: /Return to Orbit 3D/i }));
    expect(screen.queryByTestId('astronaut-stage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Orbit 3D' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Astronaut' })).toHaveAttribute('aria-pressed', 'false');

    // Esc (without Pointer Lock) also leaves the Astronaut view.
    fireEvent.click(screen.getByRole('button', { name: 'Astronaut' }));
    expect(screen.getByTestId('astronaut-stage')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByTestId('astronaut-stage')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return to Mission Brief/i })).toBeInTheDocument();

    // Data drawer coverage, opened in Orbit 3D mode.
    fireEvent.click(screen.getByRole('button', { name: /^Data/i }));
    expect(screen.getByText(/Comparing 3 lunar sites/i)).toBeInTheDocument();
    expect(screen.getByText(/Where am I looking\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /What does this mean\?/i }));
    expect(screen.getByRole('region', { name: /Glossary of lunar concepts/i })).toBeInTheDocument();

    const advToggle = screen.getByRole('button', { name: /Advanced options/i });
    expect(advToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advToggle);
    expect(advToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/NASA Sources & JPL Horizons Cross-Validation/i)).toBeInTheDocument();

    // Entering the Astronaut view closed the Sites popover; reopen it to reset the comparison.
    fireEvent.click(screen.getByRole('button', { name: /Sites \(3\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /Single site only/i }));
    expect(screen.getByRole('button', { name: /Sites \(1\)/i })).toBeInTheDocument();
  });

  it('toggles accessible HTML charts table and validates UTC dates in Time popover', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open Explorer/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /^Charts$/i }));
    expect(screen.getByRole('img', { name: /Solar illumination curve/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View table/i }));
    expect(screen.getByRole('table')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Time$/i }));
    const dateInput = screen.getByLabelText('Start date (UTC)') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-10-05' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/2026-11-15/);

    fireEvent.click(screen.getByRole('button', { name: /Reset window/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.getByText(/168h evaluated/i)).toBeInTheDocument();
  });

  it('aligns NASA SVS 0-meridian UV projection, dual polar stereographic caps, and toggles Moon ↔ Topography elevation scale', async () => {
    const {
      elevationToTopoRgb,
      latLonToNasaSvsUv,
      latLonToSphereUnit,
      polarStereoUvToSphereUnit,
      sampleAtlasElevationKmBilinear,
      sphereUnitToLatLon,
      sphereUnitToNorthStereoUv,
      sphereUnitToSouthStereoUv,
    } = await import('./landing-guide/lunarTerrainEngine');

    expect(latLonToNasaSvsUv(0, 0)).toEqual({ u: 0.5, v: 0.5 });
    expect(latLonToNasaSvsUv(0, 90)).toEqual({ u: 0.75, v: 0.5 });
    expect(latLonToNasaSvsUv(0, 270)).toEqual({ u: 0.25, v: 0.5 });
    expect(latLonToNasaSvsUv(-90, 0).v).toBe(0);

    const southPoleUnit = latLonToSphereUnit(-90, 0);
    const southCenter = sphereUnitToSouthStereoUv(southPoleUnit.x, southPoleUnit.y, southPoleUnit.z);
    expect(southCenter.u).toBeCloseTo(0.5, 6);
    expect(southCenter.v).toBeCloseTo(0.5, 6);
    const southSample = latLonToSphereUnit(-84.5, 132.4);
    const southUv = sphereUnitToSouthStereoUv(southSample.x, southSample.y, southSample.z);
    const southRoundTrip = polarStereoUvToSphereUnit(southUv.u, southUv.v, true);
    expect(southRoundTrip.x).toBeCloseTo(southSample.x, 5);
    expect(southRoundTrip.y).toBeCloseTo(southSample.y, 5);
    expect(southRoundTrip.z).toBeCloseTo(southSample.z, 5);

    const northPoleUnit = latLonToSphereUnit(90, 0);
    const northCenter = sphereUnitToNorthStereoUv(northPoleUnit.x, northPoleUnit.y, northPoleUnit.z);
    expect(northCenter.u).toBeCloseTo(0.5, 6);
    expect(northCenter.v).toBeCloseTo(0.5, 6);
    const northSample = latLonToSphereUnit(83.2, 248.1);
    const northUv = sphereUnitToNorthStereoUv(northSample.x, northSample.y, northSample.z);
    const northRoundTrip = polarStereoUvToSphereUnit(northUv.u, northUv.v, false);
    expect(northRoundTrip.x).toBeCloseTo(northSample.x, 5);
    expect(northRoundTrip.y).toBeCloseTo(northSample.y, 5);
    expect(northRoundTrip.z).toBeCloseTo(northSample.z, 5);

    const unit = latLonToSphereUnit(-89.45, 222.5);
    const back = sphereUnitToLatLon(unit.x, unit.y, unit.z);
    expect(back.latDeg).toBeCloseTo(-89.45, 4);
    expect(back.lonEastDeg).toBeCloseTo(222.5, 3);

    const low = elevationToTopoRgb(-9.0);
    const high = elevationToTopoRgb(8.5);
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(high[0]).toBeGreaterThan(high[2]);

    const dataset = parseNavigatorDataset(datasetJson);
    const atlas = buildLunarAtlasData(dataset.sites, 128, 64);
    expect(atlas.albedoRgba.length).toBe(128 * 64 * 4);
    expect(atlas.topoRgba.length).toBe(128 * 64 * 4);
    expect(atlas.normalRgba.length).toBe(128 * 64 * 4);
    expect(atlas.dispRgba.length).toBe(128 * 64 * 4);
    expect(atlas.southCapAlbedoRgba.length).toBe(atlas.southCapWidth * atlas.southCapWidth * 4);
    expect(atlas.southCapTopoRgba.length).toBe(atlas.southCapWidth * atlas.southCapWidth * 4);
    expect(atlas.southCapNormalRgba.length).toBe(atlas.southCapWidth * atlas.southCapWidth * 4);
    expect(atlas.northCapAlbedoRgba.length).toBe(atlas.northCapWidth * atlas.northCapWidth * 4);
    expect(atlas.northCapTopoRgba.length).toBe(atlas.northCapWidth * atlas.northCapWidth * 4);
    expect(atlas.northCapNormalRgba.length).toBe(atlas.northCapWidth * atlas.northCapWidth * 4);

    const hWrap0 = sampleAtlasElevationKmBilinear(atlas, -45, 0.01);
    const hWrap360 = sampleAtlasElevationKmBilinear(atlas, -45, 359.99);
    expect(Math.abs(hWrap0 - hWrap360)).toBeLessThan(0.2);
    const hPole = sampleAtlasElevationKmBilinear(atlas, -90, 129);
    expect(Number.isFinite(hPole)).toBe(true);

    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /Open Explorer/i })[0]);

    const btnMoon = screen.getByRole('button', { name: 'Moon' });
    const btnTopo = screen.getByRole('button', { name: 'Topography' });
    expect(btnMoon).toHaveAttribute('aria-pressed', 'true');
    expect(btnTopo).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: /Topographic elevation scale/i })).not.toBeInTheDocument();

    fireEvent.click(btnTopo);
    expect(btnTopo).toHaveAttribute('aria-pressed', 'true');
    expect(btnMoon).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('region', { name: /Topographic elevation scale/i })).toBeInTheDocument();
  });
});
