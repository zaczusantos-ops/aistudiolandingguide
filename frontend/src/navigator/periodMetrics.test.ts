import { describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { computeWindowSlice, evaluateWindowMetrics } from '../landing-guide/state';
import { DEFAULT_CONFIG, evaluateLiveSite, type LiveSiteAnalysis } from './math';
import type { LandingSiteEntry, MissionWindow, SkySeries } from './types';

const dataset = parseNavigatorDataset(rawDataset);
const mission = dataset.mission_window;
const siteById = (id: string): LandingSiteEntry => {
  const site = dataset.sites.find(entry => entry.id === id);
  if (!site) throw new Error(`Missing period regression fixture: ${id}`);
  return site;
};
const ridge = siteById('shackleton_ridge');
const floor = siteById('shackleton_psr_floor');
const evaluate = (site: LandingSiteEntry, window = mission) => evaluateLiveSite(
  site, 0, 0, dataset.horizon_azimuths_deg, window, DEFAULT_CONFIG,
);
const ridgeAnalysis = evaluate(ridge);
const floorAnalysis = evaluate(floor);

describe('period metrics use saved time coverage', () => {
  it('keeps full-dataset crater-floor shadow and direct-Earth gap spans within the actual 720 hours', () => {
    expect(mission.timestamps_utc).toHaveLength(721);
    expect(floorAnalysis.solar.maxContinuousShadowHours).toBe(720);
    expect(floorAnalysis.solar.minBatteryWh).toBe(72_000);
    expect(floorAnalysis.comms.maxBlackoutDteHours).toBe(720);
    expect(floorAnalysis.solar.sunlitHours).toBe(0);
    expect(floorAnalysis.solar.energyCycleWh).toBe(0);
  });

  it('gives the 30-day crater-floor window the same bounded sampled spans as the full analysis', () => {
    const slice = computeWindowSlice(mission.timestamps_utc, 0, 30);
    const metrics = evaluateWindowMetrics(floorAnalysis, mission, DEFAULT_CONFIG, slice);
    expect(slice).toMatchObject({ startIdx: 0, endIdx: 720, epochCount: 721, totalHours: 720 });
    expect(metrics.maxContinuousShadowHours).toBe(720);
    expect(metrics.maxBlackoutDteHours).toBe(720);
    expect(metrics.minBatteryWh).toBe(72_000);
    expect(metrics.blackoutCountDte).toBe(1);
  });

  it('does not create period totals from the final saved instant', () => {
    const slice = computeWindowSlice(mission.timestamps_utc, 720, 1);
    const metrics = evaluateWindowMetrics(ridgeAnalysis, mission, DEFAULT_CONFIG, slice);
    expect(slice).toMatchObject({ startIdx: 720, endIdx: 720, epochCount: 1, totalHours: 0, clampedByEnd: true });
    expect(metrics.energyCycleWh).toBeNaN();
    expect(metrics.sunlitHours).toBeNaN();
    expect(metrics.minBatteryWh).toBeNaN();
    // An instantaneous fraction is still available; the missing period is not darkness.
    expect(metrics.meanIllumFraction).toBe(1);
    expect(ridgeAnalysis.epochStates[720].fIllum).toBe(1);
  });

  it('also keeps a one-instant full analysis unknown for integrated outputs', () => {
    // Restrict existing saved values to their last instant, without synthesizing a next hour.
    const lastSky = Object.fromEntries(
      Object.entries(ridge.sky_series).map(([key, values]) => [key, values.slice(-1)]),
    ) as unknown as SkySeries;
    const singleMission: MissionWindow = {
      ...mission, start_utc: mission.end_utc,
      timestamps_utc: mission.timestamps_utc.slice(-1), sun_dist_au: mission.sun_dist_au.slice(-1),
      earth_angular_radius_deg: mission.earth_angular_radius_deg.slice(-1),
      solar_angular_radius_deg: mission.solar_angular_radius_deg.slice(-1),
    };
    const single = evaluate({ ...ridge, sky_series: lastSky }, singleMission);
    expect(single.epochStates).toHaveLength(1);
    expect(single.epochStates[0].fIllum).toBe(1);
    expect(single.solar.energyCycleWh).toBeNaN();
    expect(single.solar.energyPerM2Wh).toBeNaN();
    expect(single.solar.sunlitHours).toBeNaN();
    expect(single.solar.minBatteryWh).toBeNaN();
  });

  it('preserves ordinary multi-sample energy integration and agrees between full and full-window consumers', () => {
    const fullSlice = computeWindowSlice(mission.timestamps_utc, 0, 30);
    const fullWindow = evaluateWindowMetrics(ridgeAnalysis, mission, DEFAULT_CONFIG, fullSlice);
    expect(fullWindow.energyCycleWh).toBeCloseTo(ridgeAnalysis.solar.energyCycleWh, 8);
    expect(fullWindow.sunlitHours).toBe(720);
    expect(fullWindow.sunlitHours).toBe(ridgeAnalysis.solar.sunlitHours);
    expect(fullWindow.meanIllumFraction).toBe(ridgeAnalysis.solar.meanIllumFraction);
    expect(fullWindow.dteDutyCyclePct).toBe(ridgeAnalysis.comms.dteDutyCyclePct);
    expect(fullWindow.maxBlackoutDteHours).toBe(ridgeAnalysis.comms.maxBlackoutDteHours);

    const oneDay = evaluateWindowMetrics(ridgeAnalysis, mission, DEFAULT_CONFIG,
      computeWindowSlice(mission.timestamps_utc, 0, 1));
    // Archived output before the duration fix: ordinary adjacent-pair integration is retained.
    expect(oneDay.energyCycleWh).toBeCloseTo(37_452.55333742069, 6);
    expect(oneDay.sunlitHours).toBe(24);
    expect(oneDay.maxBlackoutDteHours).toBe(24);
  });

  it('does not change the saved instantaneous Sun and Earth conditions while correcting period totals', () => {
    expect(ridgeAnalysis.epochStates[0]).toMatchObject({ fIllum: 1, dteVisible: false });
    expect(ridgeAnalysis.epochStates[168]).toMatchObject({ fIllum: 1, dteVisible: true });
    expect(floorAnalysis.epochStates[0]).toMatchObject({ fIllum: 0, dteVisible: false });
    expect(floorAnalysis.epochStates[168]).toMatchObject({ fIllum: 0, dteVisible: false });
  });
});

describe('window consumers retain sampled-run and unknown semantics', () => {
  /** Synthetic epoch states exercise the consumer; they are not lunar predictions. */
  const boundaryFixture = (): { analysis: LiveSiteAnalysis; mission: MissionWindow } => ({
    analysis: {
      ...ridgeAnalysis,
      epochStates: ridgeAnalysis.epochStates.slice(0, 5).map((epoch, index) => ({
        ...epoch, fIllum: index === 2 ? 1 : 0, powerW: index === 2 ? 10 : 0,
        dteVisible: index === 2, combinedLinkVisible: index === 2,
      })),
    },
    mission: { ...mission, timestamps_utc: mission.timestamps_utc.slice(0, 5) },
  });

  it('counts two observed gaps but measures each only between its matching saved instants', () => {
    const fixture = boundaryFixture();
    const slice = computeWindowSlice(fixture.mission.timestamps_utc, 0, 1);
    const metrics = evaluateWindowMetrics(fixture.analysis, fixture.mission, DEFAULT_CONFIG, slice);
    expect(slice.totalHours).toBe(4);
    expect(metrics.blackoutCountDte).toBe(2);
    expect(metrics.maxBlackoutDteHours).toBe(1);
    expect(metrics.maxBlackoutCombinedHours).toBe(1);
    expect(metrics.maxContinuousShadowHours).toBe(1);
    expect(metrics.minBatteryWh).toBe(100);
    expect(metrics.energyCycleWh).toBe(10);
    expect(metrics.sunlitHours).toBe(1);
  });

  it('propagates missing solar samples as unknown totals instead of zero generation or a joined shadow run', () => {
    const fixture = boundaryFixture();
    fixture.analysis.epochStates[2] = {
      ...fixture.analysis.epochStates[2], fIllum: Number.NaN, powerW: Number.NaN,
    };
    const slice = computeWindowSlice(fixture.mission.timestamps_utc, 0, 1);
    const metrics = evaluateWindowMetrics(fixture.analysis, fixture.mission, DEFAULT_CONFIG, slice);
    expect(metrics.energyCycleWh).toBeNaN();
    expect(metrics.sunlitHours).toBeNaN();
    expect(metrics.maxContinuousShadowHours).toBeNaN();
    expect(metrics.minBatteryWh).toBeNaN();
    // Independent known Earth flags remain assessed; missing Sun does not invent an RF result.
    expect(metrics.blackoutCountDte).toBe(2);
    expect(metrics.maxBlackoutDteHours).toBe(1);
  });
});
