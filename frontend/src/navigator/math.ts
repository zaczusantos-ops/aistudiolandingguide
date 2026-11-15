import {
  EngineeringConfig,
  LandingSiteEntry,
  LocalGridNode,
  MissionWindow,
  ScoreSummary,
  ScoreWeightsConfig,
} from './types';
import { analyzeSampledRuns, integrateSavedSeries } from './sampledIntervals';

export const SOLAR_CONSTANT_1AU_W_M2 = 1361.0;

export const DEFAULT_CONFIG: EngineeringConfig = {
  panelAreaM2: 4.0,
  panelEfficiency: 0.28,
  panelMode: 'tracking',
  survivalLoadW: 100.0,
  antennaMaskDeg: 5.0,
  dteMarginMode: 'full_disk',
  relayEnabled: true,
  weights: {
    safety: 0.25,
    power: 0.35,
    comms: 0.25,
    science_psr: 0.15,
  },
};

export interface InterpolatedTerrain {
  dxM: number;
  dyM: number;
  latitudeDeg: number;
  longitudeEastDeg: number;
  elevationM: number;
  slopeDeg: number;
  psrDistanceM: number;
  isPsr: boolean;
  horizonElevDeg: number[];
}

export interface LiveEpochState {
  fIllum: number;
  irradianceWM2: number;
  powerW: number;
  horizonAtSunDeg: number;
  horizonAtEarthDeg: number;
  dteVisible: boolean;
  elfoPrimaryVisible: boolean;
  elfoConstellationVisible: boolean;
  lroVisible: boolean;
  combinedLinkVisible: boolean;
}

export interface LiveSiteAnalysis {
  terrain: InterpolatedTerrain;
  solar: {
    meanIllumFraction: number;
    sunlitHours: number;
    maxContinuousShadowHours: number;
    energyCycleWh: number;
    energyPerM2Wh: number;
    minBatteryWh: number;
    peakPowerW: number;
  };
  comms: {
    dteDutyCyclePct: number;
    elfoConstellationDutyCyclePct: number;
    lroDutyCyclePct: number;
    combinedDutyCyclePct: number;
    relayCoverageGainPct: number;
    maxBlackoutDteHours: number;
    maxBlackoutCombinedHours: number;
  };
  score: ScoreSummary;
  epochStates: LiveEpochState[];
}

function clamp(val: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, val));
}

export function interpolateHorizon(
  azDeg: number,
  horizonAzDeg: number[],
  horizonElevDeg: number[],
): number {
  const n = horizonAzDeg.length;
  if (n === 0) return 0;
  const az = ((azDeg % 360) + 360) % 360;
  const step = 360 / n;
  const idxFloat = az / step;
  const i0 = Math.floor(idxFloat) % n;
  const i1 = (i0 + 1) % n;
  const frac = idxFloat - Math.floor(idxFloat);
  return horizonElevDeg[i0] * (1 - frac) + horizonElevDeg[i1] * frac;
}

export function computeSolarIllumFraction(
  sunElDeg: number,
  horizonElevDeg: number,
  solarAngularRadiusDeg: number,
): number {
  const radius = Math.max(solarAngularRadiusDeg, 1e-6);
  const u = (sunElDeg - horizonElevDeg) / radius;
  if (u >= 1) return 1;
  if (u <= -1) return 0;
  return (1 / Math.PI) * Math.acos(-u) + (u / Math.PI) * Math.sqrt(Math.max(0, 1 - u * u));
}

export function interpolateLocalGrid(
  site: LandingSiteEntry,
  xNorm: number,
  yNorm: number,
): InterpolatedTerrain {
  const grid = site.local_grid;
  const size = grid.grid_size;
  const nodesMap = new Map<string, LocalGridNode>();
  for (const node of grid.nodes) {
    nodesMap.set(`${node.row},${node.col}`, node);
  }
  const getNode = (r: number, c: number): LocalGridNode =>
    nodesMap.get(`${clamp(r, 0, size - 1)},${clamp(c, 0, size - 1)}`) ?? grid.nodes[0];

  const colF = clamp(((1 + xNorm) * 0.5) * (size - 1), 0, size - 1);
  const rowF = clamp(((1 - yNorm) * 0.5) * (size - 1), 0, size - 1);
  const c0 = Math.floor(colF);
  const r0 = Math.floor(rowF);
  const c1 = Math.min(c0 + 1, size - 1);
  const r1 = Math.min(r0 + 1, size - 1);
  const tc = colF - c0;
  const tr = rowF - r0;

  const n00 = getNode(r0, c0);
  const n01 = getNode(r0, c1);
  const n10 = getNode(r1, c0);
  const n11 = getNode(r1, c1);

  const w00 = (1 - tr) * (1 - tc);
  const w01 = (1 - tr) * tc;
  const w10 = tr * (1 - tc);
  const w11 = tr * tc;

  const bilerp = (a: number, b: number, c: number, d: number) =>
    w00 * a + w01 * b + w10 * c + w11 * d;

  const horizonLen = n00.horizon_elev_deg.length;
  const horizonElevDeg = new Array<number>(horizonLen);
  for (let i = 0; i < horizonLen; i++) {
    horizonElevDeg[i] = bilerp(
      n00.horizon_elev_deg[i],
      n01.horizon_elev_deg[i],
      n10.horizon_elev_deg[i],
      n11.horizon_elev_deg[i],
    );
  }

  const psrDistanceM = bilerp(
    n00.psr_distance_m,
    n01.psr_distance_m,
    n10.psr_distance_m,
    n11.psr_distance_m,
  );
  const nearest = getNode(Math.round(rowF), Math.round(colF));

  return {
    dxM: bilerp(n00.dx_m, n01.dx_m, n10.dx_m, n11.dx_m),
    dyM: bilerp(n00.dy_m, n01.dy_m, n10.dy_m, n11.dy_m),
    latitudeDeg: bilerp(n00.latitude_deg, n01.latitude_deg, n10.latitude_deg, n11.latitude_deg),
    longitudeEastDeg: bilerp(
      n00.longitude_east_deg,
      n01.longitude_east_deg,
      n10.longitude_east_deg,
      n11.longitude_east_deg,
    ),
    elevationM: bilerp(n00.elevation_m, n01.elevation_m, n10.elevation_m, n11.elevation_m),
    slopeDeg: bilerp(n00.slope_deg, n01.slope_deg, n10.slope_deg, n11.slope_deg),
    psrDistanceM,
    isPsr: nearest.is_psr || psrDistanceM <= 80,
    horizonElevDeg,
  };
}

export function computeCompositeScore(
  slopeDeg: number,
  meanIllumFraction: number,
  maxContinuousShadowHours: number,
  dteDutyPct: number,
  combinedDutyPct: number,
  psrDistanceM: number,
  isPsr: boolean,
  weights: ScoreWeightsConfig,
  relayEnabled: boolean,
): ScoreSummary {
  const safety = clamp((100 * (15 - slopeDeg)) / 13, 0, 100);
  const shadowRes = clamp(100 * (1 - maxContinuousShadowHours / 360), 0, 100);
  const power = clamp(0.7 * (meanIllumFraction * 100) + 0.3 * shadowRes, 0, 100);
  const comms = relayEnabled
    ? clamp(0.65 * combinedDutyPct + 0.35 * dteDutyPct, 0, 100)
    : clamp(dteDutyPct, 0, 100);

  let sciencePsr = 15;
  if (!isPsr) {
    if (psrDistanceM <= 500) {
      sciencePsr = 100;
    } else if (psrDistanceM <= 5000) {
      sciencePsr = clamp(100 - (80 * (psrDistanceM - 500)) / 4500, 0, 100);
    } else {
      sciencePsr = clamp(20 * (1 - (psrDistanceM - 5000) / 5000), 0, 100);
    }
  }

  const wSum = Math.max(weights.safety + weights.power + weights.comms + weights.science_psr, 1e-9);
  const total =
    (weights.safety * safety +
      weights.power * power +
      weights.comms * comms +
      weights.science_psr * sciencePsr) /
    wSum;

  return {
    total_0_100: Number(clamp(total, 0, 100).toFixed(2)),
    safety_slope_0_100: Number(safety.toFixed(2)),
    power_0_100: Number(power.toFixed(2)),
    comms_0_100: Number(comms.toFixed(2)),
    science_psr_0_100: Number(sciencePsr.toFixed(2)),
  };
}

function longestFalseRunHours(flags: readonly (boolean | null)[], timestamps: readonly string[]): number {
  const runs = analyzeSampledRuns(timestamps, flags.map(ok => ok === null ? null : !ok));
  return runs.status === 'known' ? runs.longestMatchingSpan?.hours ?? 0 : Number.NaN;
}

export function evaluateLiveSite(
  site: LandingSiteEntry,
  xNorm: number,
  yNorm: number,
  horizonAzDeg: number[],
  missionWindow: MissionWindow,
  config: EngineeringConfig,
): LiveSiteAnalysis {
  const isExactCenter = Math.abs(xNorm) < 1e-6 && Math.abs(yNorm) < 1e-6;
  const terrain: InterpolatedTerrain = isExactCenter
    ? {
        dxM: 0,
        dyM: 0,
        latitudeDeg: site.center.latitude_deg,
        longitudeEastDeg: site.center.longitude_east_deg,
        elevationM: site.center.elevation_m,
        slopeDeg: site.center.slope_deg,
        psrDistanceM: site.center.psr_distance_m,
        isPsr: site.center.is_psr,
        horizonElevDeg: site.horizon_elev_deg,
      }
    : interpolateLocalGrid(site, xNorm, yNorm);

  const sky = site.sky_series;
  const n = missionWindow.timestamps_utc.length;
  const epochStates = new Array<LiveEpochState>(n);

  let illumSum = 0;
  let peakPowerW = 0;
  const sunlitFlags = new Array<boolean | null>(n);
  const powerSamples = new Array<number>(n);

  let dteCount = 0;
  let elfoCount = 0;
  let lroCount = 0;
  let combinedCount = 0;
  const dteFlags = new Array<boolean>(n);
  const combFlags = new Array<boolean>(n);

  for (let i = 0; i < n; i++) {
    const sunAz = sky.sun_az_deg[i];
    const sunEl = sky.sun_el_deg[i];
    const earthAz = sky.earth_az_deg[i];
    const earthEl = sky.earth_el_deg[i];
    const sunRadius = missionWindow.solar_angular_radius_deg[i];
    const earthRadius = missionWindow.earth_angular_radius_deg[i];
    const distAu = missionWindow.sun_dist_au[i];

    const hSun = interpolateHorizon(sunAz, horizonAzDeg, terrain.horizonElevDeg);
    const hEarth = interpolateHorizon(earthAz, horizonAzDeg, terrain.horizonElevDeg);
    const fIllum = computeSolarIllumFraction(sunEl, hSun, sunRadius);
    const irradianceWM2 = SOLAR_CONSTANT_1AU_W_M2 / (distAu * distAu);

    const elRad = (sunEl * Math.PI) / 180;
    const azRad = (sunAz * Math.PI) / 180;
    let incidenceFactor = 0;
    if (config.panelMode === 'tracking') {
      incidenceFactor = Math.max(0, Math.cos(elRad));
    } else if (config.panelMode === 'fixed_north') {
      incidenceFactor = Math.max(0, Math.cos(elRad) * Math.cos(azRad));
    } else {
      incidenceFactor = Math.max(0, Math.sin(elRad));
    }

    const powerW =
      config.panelEfficiency * config.panelAreaM2 * irradianceWM2 * fIllum * incidenceFactor;
    if (powerW > peakPowerW) peakPowerW = powerW;

    illumSum += fIllum;
    powerSamples[i] = powerW;
    sunlitFlags[i] = Number.isFinite(fIllum) ? fIllum > 0 : null;

    const dteMargin = config.dteMarginMode === 'full_disk' ? earthRadius : 0;
    const dteVisible = earthEl - dteMargin > hEarth;

    const hElfoPrim = interpolateHorizon(
      sky.elfo_primary_az_deg[i],
      horizonAzDeg,
      terrain.horizonElevDeg,
    );
    const elfoPrimaryVisible =
      sky.elfo_primary_earth_los[i] &&
      sky.elfo_primary_range_km[i] <= 12000 &&
      sky.elfo_primary_el_deg[i] > hElfoPrim + config.antennaMaskDeg;

    // For center/grid, scale precomputed 3-sat visibility while respecting mask delta when >5 deg
    const centerHorizPrim = interpolateHorizon(
      sky.elfo_primary_az_deg[i],
      horizonAzDeg,
      site.horizon_elev_deg,
    );
    const terrainDelta = hElfoPrim - centerHorizPrim + (config.antennaMaskDeg - 5.0);
    const elfoConstellationVisible =
      sky.elfo_constellation_visible[i] &&
      (elfoPrimaryVisible || terrainDelta <= 2.5);

    const lroVisible = sky.lro_visible[i];
    const combinedVisible = config.relayEnabled
      ? dteVisible || elfoConstellationVisible
      : dteVisible;

    dteFlags[i] = dteVisible;
    combFlags[i] = combinedVisible;
    if (dteVisible) dteCount++;
    if (elfoConstellationVisible) elfoCount++;
    if (lroVisible) lroCount++;
    if (combinedVisible) combinedCount++;

    epochStates[i] = {
      fIllum,
      irradianceWM2,
      powerW,
      horizonAtSunDeg: hSun,
      horizonAtEarthDeg: hEarth,
      dteVisible,
      elfoPrimaryVisible,
      elfoConstellationVisible,
      lroVisible,
      combinedLinkVisible: combinedVisible,
    };
  }

  const meanIllumFraction = illumSum / n;
  // A span joins saved observations; it does not resolve a physical rise/set event.
  const maxContinuousShadowHours = longestFalseRunHours(sunlitFlags, missionWindow.timestamps_utc);
  const energy = integrateSavedSeries(missionWindow.timestamps_utc, powerSamples);
  const sunlight = integrateSavedSeries(missionWindow.timestamps_utc,
    sunlitFlags.map(flag => flag === null ? Number.NaN : Number(flag)));
  const energyCycleWh = energy.status === 'known' ? energy.valueHours : Number.NaN;
  const energyPerM2Wh = energyCycleWh / Math.max(config.panelAreaM2, 1e-6);
  const minBatteryWh = n < 2 ? Number.NaN : config.survivalLoadW * maxContinuousShadowHours;

  const dteDutyCyclePct = (dteCount / n) * 100;
  const elfoConstellationDutyCyclePct = (elfoCount / n) * 100;
  const combinedDutyCyclePct = (combinedCount / n) * 100;
  const relayCoverageGainPct = config.relayEnabled ? combinedDutyCyclePct - dteDutyCyclePct : 0;

  // Use accurate 5-min precomputed LRO duty cycle at center or scaled near center
  const lroDutyCyclePct = isExactCenter
    ? site.engineering_summary.comms.lro_duty_cycle_pct
    : (lroCount / n) * 100;

  const score = computeCompositeScore(
    terrain.slopeDeg,
    meanIllumFraction,
    maxContinuousShadowHours,
    dteDutyCyclePct,
    combinedDutyCyclePct,
    terrain.psrDistanceM,
    terrain.isPsr,
    config.weights,
    config.relayEnabled,
  );

  return {
    terrain,
    solar: {
      meanIllumFraction,
      sunlitHours: sunlight.status === 'known' ? sunlight.valueHours : Number.NaN,
      maxContinuousShadowHours,
      energyCycleWh,
      energyPerM2Wh,
      minBatteryWh,
      peakPowerW,
    },
    comms: {
      dteDutyCyclePct,
      elfoConstellationDutyCyclePct,
      lroDutyCyclePct,
      combinedDutyCyclePct,
      relayCoverageGainPct,
      maxBlackoutDteHours: longestFalseRunHours(dteFlags, missionWindow.timestamps_utc),
      maxBlackoutCombinedHours: longestFalseRunHours(combFlags, missionWindow.timestamps_utc),
    },
    score,
    epochStates,
  };
}
