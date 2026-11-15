import React, { useEffect, useMemo, useState } from 'react';
import rawDataset from './data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from './contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from './navigator/math';
import { createGeometrySite } from './explorer/geometry';
import { decodeScenarioUrl, encodeScenarioUrl, ScenarioUrlState } from './explorer/scenarioUrl';
import { findNextJointVisibility } from './navigator/jointVisibility';
import { EngineeringConfig, LandingSiteEntry, NavigatorDatasetV1 } from './navigator/types';
import { AstronautViewport } from './landing-guide/AstronautViewport';
import { ChartsDrawer } from './landing-guide/ChartsDrawer';
import { createCustomLandingSite } from './landing-guide/customSiteBuilder';
import { DataDrawer } from './landing-guide/DataDrawer';
import { HomeOverlay } from './landing-guide/HomeOverlay';
import {
  buildLunarAtlasData,
  getLoadedRealAtlasSync,
  LunarAtlasData,
  SurfaceMode,
  TOPO_LEGEND_STOPS,
} from './landing-guide/lunarTerrainEngine';
import { OriginalLunarViewport as LunarViewport } from './landing-guide/OriginalLunarViewport';
import { SelectionPopover } from './landing-guide/SelectionPopover';
import {
  addSiteSlot,
  buildPlainSummary,
  computeWindowSlice,
  DurationDays,
  EvaluatedSlotEntry,
  evaluateWindowMetrics,
  formatUtcShort,
  MAX_SITE_SLOTS,
  PlaybackSpeed,
  removeSiteSlot,
  SelectionMode,
  setSiteSlotAt,
  SiteSlotState,
  SLOT_LABELS,
  SLOT_META,
  swapSiteSlots,
  ViewportMode,
} from './landing-guide/state';
import { TimePopover } from './landing-guide/TimePopover';
import { buildSiteReadout } from './landing-guide/siteReadings';
import { ScenarioActions } from './landing-guide/ScenarioActions';
import { ViewOptions } from './landing-guide/ViewOptions';
import './landing-guide/explorer-clean.css';

const defaultDataset: NavigatorDatasetV1 = parseNavigatorDataset(rawDataset);

export interface AppProps {
  dataset?: NavigatorDatasetV1;
}

function getInitialAutostart(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autostart') === '1';
}

function createSelectedPoint(
  dataset: NavigatorDatasetV1, latDeg: number, lonEastDeg: number, atlas?: LunarAtlasData,
): LandingSiteEntry {
  const geometry = createGeometrySite(dataset, latDeg, lonEastDeg);
  const site = createCustomLandingSite({
    latDeg, lonEastDeg,
    atlas: atlas ?? getLoadedRealAtlasSync() ?? buildLunarAtlasData(dataset.sites, 256, 128),
    referenceSites: dataset.sites,
    horizonAzDeg: dataset.horizon_azimuths_deg,
    missionWindow: dataset.mission_window,
  });
  // Keep the astronaut's existing visual scaffold separate from sky readings.
  // Nearby chosen points must not share the scaffold's rounded display ID.
  site.id = `custom_${geometry.center.latitude_deg}_${geometry.center.longitude_east_deg}`;
  site.center.latitude_deg = geometry.center.latitude_deg;
  site.center.longitude_east_deg = geometry.center.longitude_east_deg;
  site.sky_series = { ...site.sky_series, ...geometry.sky_series };
  return site;
}

function loadInitialScenario(dataset: NavigatorDatasetV1): {
  scenario: ScenarioUrlState | null; customSite: LandingSiteEntry | null; error: string | null;
} {
  if (typeof window === 'undefined') return { scenario: null, customSite: null, error: null };
  const decoded = decodeScenarioUrl(window.location.search, dataset);
  if (decoded.status === 'absent') return { scenario: null, customSite: null, error: null };
  if (decoded.status === 'invalid') return { scenario: null, customSite: null, error: decoded.error };
  try {
    const point = decoded.scenario.site;
    return {
      scenario: decoded.scenario,
      customSite: point.kind === 'coordinates'
        ? createSelectedPoint(dataset, point.latDeg, point.lonEastDeg) : null,
      error: null,
    };
  } catch {
    return { scenario: null, customSite: null, error: 'This point could not be reconstructed.' };
  }
}

function actionContext(
  slot: SiteSlotState, site: LandingSiteEntry, config: EngineeringConfig, epochIdx: number, startIdx: number, durationDays: DurationDays,
): string {
  return JSON.stringify([slot, site.center.latitude_deg, site.center.longitude_east_deg, config, epochIdx, startIdx, durationDays]);
}

export function LegacyApp({ dataset = defaultDataset }: AppProps) {
  const [initial] = useState(() => loadInitialScenario(dataset));
  const [scenarioError, setScenarioError] = useState(initial.error);
  const [hasStarted, setHasStarted] = useState<boolean>(() => !!initial.scenario || getInitialAutostart());
  const [viewportMode, setViewportMode] = useState<ViewportMode>('3d');
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('realistic');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('cursor');

  const [slots, setSlots] = useState<SiteSlotState[]>(() => [
    {
      siteId: initial.scenario?.site.kind === 'named'
        ? initial.scenario.site.siteId : initial.customSite?.id ?? dataset.sites[0].id,
      offsetXNorm: initial.scenario?.offsetXNorm ?? 0,
      offsetYNorm: initial.scenario?.offsetYNorm ?? 0,
    },
  ]);
  const [customSites, setCustomSites] = useState<Record<string, LandingSiteEntry>>(
    () => initial.customSite ? { [initial.customSite.id]: initial.customSite } : {},
  );
  const [activeSlotIdx, setActiveSlotIdx] = useState<number>(0);

  const [startIdx, setStartIdx] = useState<number>(initial.scenario?.startIdx ?? 0);
  const [durationDays, setDurationDays] = useState<DurationDays>(initial.scenario?.durationDays ?? 30);
  const [epochIdx, setEpochIdx] = useState<number>(initial.scenario?.epochIdx ?? 0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [config, setConfig] = useState<EngineeringConfig>(initial.scenario?.config ?? DEFAULT_CONFIG);

  const [chartsOpen, setChartsOpen] = useState<boolean>(false);
  const [dataOpen, setDataOpen] = useState<boolean>(!!initial.scenario);
  const [activePopover, setActivePopover] = useState<'time' | 'selection' | 'view' | null>(null);

  const [reticleCoords, setReticleCoords] = useState<{ latDeg: number; lonEastDeg: number }>({
    latDeg: -85,
    lonEastDeg: 12,
  });
  const [coverageNotice, setCoverageNotice] = useState<string | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<{ context: string; text: string } | null>(null);
  const [shareFeedback, setShareFeedback] = useState<{
    context: string; url: string; message: string; manualCopy: boolean;
  } | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.started = hasStarted ? 'true' : 'false';
      document.body.dataset.started = hasStarted ? 'true' : 'false';
    }
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;
    const panel = activePopover ? document.querySelector('[role="dialog"]')
      : dataOpen ? document.querySelector('.condition-panel')
        : chartsOpen ? document.querySelector('[aria-label="Conditions over time"]') : null;
    const heading = panel?.querySelector<HTMLElement>('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [hasStarted, activePopover, dataOpen, chartsOpen]);

  useEffect(() => {
    if (!hasStarted) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activePopover !== null) {
          document.getElementById(activePopover === 'selection' ? 'place-trigger' : `${activePopover}-trigger`)?.focus();
          setActivePopover(null);
        } else if (chartsOpen || dataOpen) {
          document.getElementById(dataOpen ? 'conditions-trigger' : 'overtime-trigger')?.focus();
          setChartsOpen(false);
          setDataOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasStarted, activePopover, chartsOpen, dataOpen]);

  const safeActiveIdx = Math.max(0, Math.min(slots.length - 1, activeSlotIdx));

  const slice = useMemo(
    () => computeWindowSlice(dataset.mission_window.timestamps_utc, startIdx, durationDays),
    [dataset.mission_window.timestamps_utc, startIdx, durationDays],
  );

  const clampedEpochIdx = Math.max(slice.startIdx, Math.min(slice.endIdx, epochIdx));
  const currentUtc = dataset.mission_window.timestamps_utc[clampedEpochIdx];

  useEffect(() => {
    if (!isPlaying) return undefined;
    const timer = window.setInterval(() => {
      setEpochIdx((prev) => {
        const next = prev + speed;
        return next > slice.endIdx ? slice.startIdx : next;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [isPlaying, speed, slice.startIdx, slice.endIdx]);

  const siteLookup = useMemo(() => {
    const map = new Map<string, LandingSiteEntry>();
    for (const s of dataset.sites) map.set(s.id, s);
    for (const s of Object.values(customSites)) map.set(s.id, s);
    return map;
  }, [dataset.sites, customSites]);

  const entries = useMemo<EvaluatedSlotEntry[]>(() => {
    return slots.map((slot, idx) => {
      const label = SLOT_LABELS[idx] ?? 'A';
      const site = siteLookup.get(slot.siteId) ?? dataset.sites[0];
      const analysis = evaluateLiveSite(
        site,
        slot.offsetXNorm,
        slot.offsetYNorm,
        dataset.horizon_azimuths_deg,
        dataset.mission_window,
        config,
      );
      const metrics = evaluateWindowMetrics(analysis, dataset.mission_window, config, slice);
      return {
        label,
        meta: SLOT_META[label],
        slot,
        site,
        analysis,
        metrics,
      };
    });
  }, [slots, siteLookup, dataset.sites, dataset.horizon_azimuths_deg, dataset.mission_window, config, slice]);

  const plainSummary = useMemo(
    () =>
      buildPlainSummary({
        entries,
        epochIdx: clampedEpochIdx,
        currentUtc,
        slice,
        relayEnabled: config.relayEnabled,
      }),
    [entries, clampedEpochIdx, currentUtc, slice, config.relayEnabled],
  );

  const readouts = useMemo(
    () => entries.map((entry) => buildSiteReadout({
      dataset,
      site: entry.site,
      terrainHorizonDeg: entry.analysis.terrain.horizonElevDeg,
      epochIdx: clampedEpochIdx,
      config,
    })),
    [entries, dataset, clampedEpochIdx, config],
  );
  const terrainSiteIds = useMemo(() => dataset.sites.map(site => site.id), [dataset.sites]);
  const activeEntry = entries[safeActiveIdx];
  const activeContext = actionContext(activeEntry.slot, activeEntry.site, config, clampedEpochIdx, startIdx, durationDays);

  const handleFindNext = () => {
    setIsPlaying(false);
    const timestamps = dataset.mission_window.timestamps_utc;
    if (clampedEpochIdx + 1 >= timestamps.length) {
      setSearchFeedback({ context: activeContext, text: 'No later samples remain in this dataset.' });
      return;
    }
    if (readouts[safeActiveIdx]?.kind !== 'terrain') return;
    const result = findNextJointVisibility({
      site: activeEntry.site,
      terrainHorizonDeg: activeEntry.analysis.terrain.horizonElevDeg,
      horizonAzimuthDeg: dataset.horizon_azimuths_deg,
      sunAngularRadiusDeg: dataset.mission_window.solar_angular_radius_deg,
      earthAngularRadiusDeg: dataset.mission_window.earth_angular_radius_deg,
      timestamps,
      fromEpochIdx: clampedEpochIdx + 1,
      earthCriterion: config.dteMarginMode === 'center' ? 'center' : 'full-disk',
    });
    if (result.status === 'unavailable') {
      setSearchFeedback({ context: activeContext, text: 'A valid next-sample search is unavailable for these inputs.' });
      return;
    }
    if (result.status === 'not-found') {
      setSearchFeedback({ context: activeContext, text: result.unknownSamples > 0
        ? 'No matching later sample was found among the available data. Some samples could not be assessed.'
        : `No matching later sample was found through ${formatUtcShort(timestamps[timestamps.length - 1])}.` });
      return;
    }
    const nextIdx = result.startEpochIdx;
    const shiftedWindow = nextIdx > slice.endIdx;
    if (shiftedWindow) setStartIdx(nextIdx);
    setEpochIdx(nextIdx);
    setSearchFeedback({
      context: actionContext(activeEntry.slot, activeEntry.site, config, nextIdx, shiftedWindow ? nextIdx : startIdx, durationDays),
      text: `Showing the next matching hourly sample: ${formatUtcShort(timestamps[nextIdx])}. Exact transition time is not resolved.${result.unknownSamplesBefore > 0 ? ' Earlier data are incomplete.' : ''}${shiftedWindow ? ' The analysis period now starts here.' : ''}`,
    });
  };

  const handleShare = async () => {
    setIsPlaying(false);
    const catalogued = terrainSiteIds.includes(activeEntry.site.id);
    const state: ScenarioUrlState = {
      site: catalogued
        ? { kind: 'named', siteId: activeEntry.site.id }
        : { kind: 'coordinates', latDeg: activeEntry.site.center.latitude_deg, lonEastDeg: activeEntry.site.center.longitude_east_deg },
      epochIdx: clampedEpochIdx, startIdx, durationDays,
      offsetXNorm: catalogued ? activeEntry.slot.offsetXNorm : 0,
      offsetYNorm: catalogued ? activeEntry.slot.offsetYNorm : 0,
      config,
    };
    try {
      const url = encodeScenarioUrl(window.location.href, state, dataset);
      let message = 'Copy the scenario link below.';
      let manualCopy = true;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          message = 'Scenario link copied.';
          manualCopy = false;
        }
      } catch {
        // Keep a selectable link when clipboard permission is unavailable.
      }
      setShareFeedback({ context: activeContext, url, message, manualCopy });
    } catch {
      setShareFeedback({ context: activeContext, url: '', manualCopy: false, message: 'This scenario could not be shared. Check its site, UTC and assumptions.' });
    }
  };

  const handleStart = (siteId?: string, sampleIdx?: number) => {
    if (siteId) {
      setSlots((prev) => setSiteSlotAt(prev, 0, siteId));
      setActiveSlotIdx(0);
    }
    if (sampleIdx !== undefined && dataset.mission_window.timestamps_utc[sampleIdx]) {
      setIsPlaying(false);
      setStartIdx(0);
      setDurationDays(30);
      setEpochIdx(sampleIdx);
    }
    setHasStarted(true);
    setDataOpen(true);
    setChartsOpen(false);
    setActivePopover(null);
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0 });
    }
  };

  const handleReturnToBrief = () => {
    setIsPlaying(false);
    setDataOpen(false);
    setChartsOpen(false);
    setActivePopover(null);
    setHasStarted(false);
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0 });
    }
  };

  const handleAssignSiteAt = (slotIdx: number, siteId: string) => {
    setCoverageNotice(null);
    setSlots((prev) => setSiteSlotAt(prev, slotIdx, siteId));
    setActivePopover(null);
    setChartsOpen(false);
    setDataOpen(true);
  };

  const handleCoordinatePick = (
    latDeg: number,
    lonEastDeg: number,
    slotIdx: number,
    atlas?: LunarAtlasData,
  ) => {
    let customSite: LandingSiteEntry;
    try {
      customSite = createSelectedPoint(dataset, latDeg, lonEastDeg, atlas);
    } catch {
      setCoverageNotice('This point could not be assessed. Choose valid lunar coordinates.');
      return;
    }
    setCustomSites((prev) => ({ ...prev, [customSite.id]: customSite }));
    setSlots((prev) => setSiteSlotAt(prev, slotIdx, customSite.id));
    setActivePopover(null);
    setChartsOpen(false);
    setDataOpen(true);
    setCoverageNotice(null);
  };

  const handleAddSlot = () => {
    setCoverageNotice(null);
    setSlots((prev) => {
      const next = addSiteSlot(prev, dataset.sites);
      if (next.length > prev.length) {
        setActiveSlotIdx(next.length - 1);
      }
      return next;
    });
    setChartsOpen(false);
    setDataOpen(false);
    setActivePopover('selection');
  };

  const handleRemoveSlot = (idx: number) => {
    setCoverageNotice(null);
    setSlots((prev) => {
      const next = removeSiteSlot(prev, idx);
      setActiveSlotIdx((cur) => Math.max(0, Math.min(next.length - 1, cur >= idx && cur > 0 ? cur - 1 : cur)));
      return next;
    });
  };

  const handleKeepOnlyOne = () => {
    setCoverageNotice(null);
    const keep = slots[safeActiveIdx] ?? slots[0];
    setSlots([keep]);
    setActiveSlotIdx(0);
  };

  const handleSwapFirstTwo = () => {
    setSlots((prev) => swapSiteSlots(prev, 0, 1));
  };

  const handleCompareWithPsr = () => {
    const psrSite =
      dataset.sites.find((s) => s.center.is_psr && s.id !== slots[0].siteId) ??
      dataset.sites.find((s) => s.id === 'shackleton_psr_floor') ??
      dataset.sites[dataset.sites.length - 1];
    const targetId = slots[0].siteId === psrSite.id ? dataset.sites[0].id : psrSite.id;
    setCoverageNotice(null);
    setSlots((prev) => {
      if (prev.length === 1) {
        return addSiteSlot(prev, dataset.sites, targetId);
      }
      return setSiteSlotAt(prev, 1, targetId);
    });
    setActiveSlotIdx(1);
  };

  const handleChangeOffset = (slotIdx: number, xNorm: number, yNorm: number) => {
    setSlots((prev) =>
      prev.map((s, idx) => (idx === slotIdx ? { ...s, offsetXNorm: xNorm, offsetYNorm: yNorm } : s)),
    );
  };

  const toggleCharts = () => {
    setChartsOpen((prev) => {
      const next = !prev;
      if (next) {
        setDataOpen(false);
        setActivePopover(null);
      }
      return next;
    });
  };

  const toggleData = () => {
    setDataOpen((prev) => {
      const next = !prev;
      if (next) {
        setChartsOpen(false);
        setActivePopover(null);
      }
      return next;
    });
  };

  const togglePopover = (pop: 'time' | 'selection' | 'view') => {
    setActivePopover((prev) => {
      const next = prev === pop ? null : pop;
      if (next) {
        setIsPlaying(false);
        setChartsOpen(false);
        setDataOpen(false);
      }
      return next;
    });
  };

  const handleResetTime = () => {
    setIsPlaying(false);
    setStartIdx(0);
    setDurationDays(30);
    setEpochIdx(0);
  };

  return (
    <div className="guide-shell guide-shell--clean" data-started={hasStarted ? 'true' : 'false'}>
      {scenarioError && (
        <div className="floating-notice" role="alert">
          <span>Could not open shared scenario: {scenarioError} Choose a site and UTC to continue.</span>
          <button type="button" className="btn-link-sm" onClick={() => setScenarioError(null)}>Dismiss</button>
        </div>
      )}
      {/* 3D Orbital Moon Stage (fixed backdrop in Brief Hero, fullscreen in Explorer) */}
      <LunarViewport
        mode={viewportMode}
        surfaceMode={surfaceMode}
        sites={dataset.sites}
        entries={entries}
        activeSlotIdx={safeActiveIdx}
        onSelectActiveSlot={setActiveSlotIdx}
        epochIdx={clampedEpochIdx}
        hasStarted={hasStarted}
        selectionMode={selectionMode}
        onSelectSiteDirect={(siteId, slotIdx) => handleAssignSiteAt(slotIdx, siteId)}
        onOutsidePolarCoverage={handleCoordinatePick}
        onReticleChange={(latDeg, lonEastDeg) => setReticleCoords({ latDeg, lonEastDeg })}
        reticleCoords={reticleCoords}
      />

      {/* 1st-Person Astronaut Surface View */}
      {hasStarted && viewportMode === 'astronaut' && (
        <AstronautViewport
          entries={entries}
          activeSlotIdx={safeActiveIdx}
          onSelectActiveSlot={setActiveSlotIdx}
          surfaceMode={surfaceMode}
          epochIdx={clampedEpochIdx}
          config={config}
          chartsOpen={chartsOpen}
        />
      )}

      {!hasStarted && (
        <HomeOverlay
          sites={dataset.sites}
          horizonAzDeg={dataset.horizon_azimuths_deg}
          missionWindow={dataset.mission_window}
          onStart={handleStart}
        />
      )}

      {hasStarted && (
        <>
          {/* Top-Left: Brief & Charts */}
          <div className="hud-corner hud-top-left">
            <button
              type="button"
              className="hud-btn hud-btn-muted"
              onClick={handleReturnToBrief}
              aria-label="Return to overview"
            >
              <span aria-hidden="true">←</span>
              <span>Overview</span>
            </button>
            <button
              type="button"
              className={`hud-btn ${chartsOpen ? 'active' : ''}`}
              id="overtime-trigger"
              aria-expanded={chartsOpen}
              onClick={toggleCharts}
            >
              <span>Over time</span>
            </button>
          </div>

          {/* Top-Center: Moon | Topography */}
          <div className="hud-top-center">
            <button type="button" className={`hud-btn ${activePopover === 'view' ? 'active' : ''}`}
              id="view-trigger" aria-expanded={activePopover === 'view'} onClick={() => togglePopover('view')}>
              View
            </button>

            {surfaceMode === 'topography' && (
              <div className="topo-legend-bar" role="region" aria-label="Topographic elevation scale in kilometers">
                <span className="topo-legend-title">LOLA Elevation</span>
                <div className="topo-ramp-track" aria-hidden="true" />
                <div className="topo-ramp-labels">
                  {TOPO_LEGEND_STOPS.map((stop) => (
                    <span key={stop.elevKm}>{stop.label}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Top-Right: Sites (1–4) */}
          <div className="hud-corner hud-top-right">
            <button
              type="button"
              className={`hud-btn ${activePopover === 'selection' ? 'active' : ''}`}
              id="place-trigger"
              aria-expanded={activePopover === 'selection'}
              onClick={() => togglePopover('selection')}
            >
              <span>{entries.length === 1 ? 'Place' : `Places (${entries.length})`}</span>
            </button>
          </div>

          {coverageNotice && activePopover !== 'selection' && (
            <div className="floating-notice" role="status">
              <span>{coverageNotice}</span>
              <button
                type="button"
                className="btn-link-sm"
                onClick={() => setCoverageNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Minimal 1..4 Site Dock above bottom bar (Orbit 3D mode) */}
          {viewportMode === '3d' && !chartsOpen && !dataOpen && activePopover === null && (
            <div className="ab-floating-dock" aria-label="Selected lunar sites">
              <div className="ab-dock-row">
                {entries.map((entry, idx) => {
                  const isArmed = idx === safeActiveIdx;
                  return (
                    <div
                      key={`${entry.label}-${idx}`}
                      className={`ab-summary-card ${isArmed ? 'is-armed' : ''}`}
                    >
                      <button
                        type="button"
                        className="ab-card-main-btn"
                        aria-pressed={isArmed}
                        onClick={() => {
                          if (isArmed) {
                            setActivePopover('selection');
                          } else {
                            setActiveSlotIdx(idx);
                          }
                        }}
                      >
                        {entries.length > 1 && <span className="ab-chip" aria-hidden="true">{entry.label}</span>}
                        <div className="ab-card-text">
                          <strong>{entry.site.name}</strong>
                          <span>
                            {readouts[idx]?.summary ?? 'Conditions not assessed'}
                          </span>
                        </div>
                      </button>
                      {entries.length > 1 && (
                        <button
                          type="button"
                          className="ab-card-remove"
                          aria-label={`Remove Site ${entry.label}`}
                          onClick={() => handleRemoveSlot(idx)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}

                {entries.length < MAX_SITE_SLOTS && (
                  <button
                    type="button"
                    className="ab-add-btn"
                    onClick={handleAddSlot}
                    aria-label={entries.length === 1 ? "Compare places" : "Add comparison place"}
                  >
                    {entries.length === 1 ? 'Compare' : '+ Place'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bottom-Center: Time (UTC) */}
          <div className="hud-bottom-center">
            <div className="time-pill" role="group" aria-label="UTC epoch playback controls">
              <button
                type="button"
                className={`time-pill-trigger ${activePopover === 'time' ? 'active' : ''}`}
                id="time-trigger"
                aria-expanded={activePopover === 'time'}
                onClick={() => togglePopover('time')}
              >
                <span>Time</span>
              </button>
              <div className="time-pill-readout">
                <strong>{formatUtcShort(currentUtc)}</strong>
                <span>{slice.epochCount < 2 ? "One saved instant" : `${slice.totalHours}h analysis period`}</span>
              </div>
              <button
                type="button"
                className="time-pill-play"
                aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
                onClick={() => setIsPlaying((p) => !p)}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          </div>

          {/* Bottom-Right: Data */}
          <div className="hud-corner hud-bottom-right">
            <button
              type="button"
              className={`hud-btn ${dataOpen ? 'active' : ''}`}
              id="conditions-trigger"
              aria-expanded={dataOpen}
              onClick={toggleData}
            >
              <span>Conditions</span>
            </button>
          </div>

          {/* Popovers */}
          {activePopover === 'view' && (
            <ViewOptions viewportMode={viewportMode} surfaceMode={surfaceMode}
              onChangeViewport={(mode) => { setViewportMode(mode); setActivePopover(null); document.getElementById('view-trigger')?.focus(); }}
              onChangeSurface={setSurfaceMode}
              onClose={() => { setActivePopover(null); document.getElementById('view-trigger')?.focus(); }} />
          )}
          {activePopover === 'time' && (
            <TimePopover
              timestampsUtc={dataset.mission_window.timestamps_utc}
              epochIdx={clampedEpochIdx}
              startIdx={startIdx}
              durationDays={durationDays}
              slice={slice}
              isPlaying={isPlaying}
              speed={speed}
              onChangeStartIdx={(idx) => {
                setIsPlaying(false);
                setStartIdx(idx);
              }}
              onChangeEpochIdx={(idx) => {
                setIsPlaying(false);
                setEpochIdx(idx);
              }}
              onChangeDuration={(days) => {
                setIsPlaying(false);
                const proposed = computeWindowSlice(dataset.mission_window.timestamps_utc, startIdx, days);
                if (clampedEpochIdx > proposed.endIdx) setStartIdx(clampedEpochIdx);
                setDurationDays(days);
              }}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              onResetTime={handleResetTime}
              onChangeSpeed={(sp) => setSpeed(sp)}
              onClose={() => { setActivePopover(null); document.getElementById('time-trigger')?.focus(); }}
            />
          )}

          {activePopover === 'selection' && (
            <SelectionPopover
              sites={dataset.sites}
              entries={entries}
              activeSlotIdx={safeActiveIdx}
              selectionMode={selectionMode}
              reticleCoords={reticleCoords}
              coverageNotice={coverageNotice}
              onChangeSelectionMode={setSelectionMode}
              onSelectActiveSlot={setActiveSlotIdx}
              onAssignSiteAt={handleAssignSiteAt}
              onPickCustomCoords={(lat, lon, idx) => handleCoordinatePick(lat, lon, idx)}
              onAddSlot={handleAddSlot}
              onRemoveSlot={handleRemoveSlot}
              onSwapFirstTwo={handleSwapFirstTwo}
              onFixReticleToActive={() =>
                handleCoordinatePick(reticleCoords.latDeg, reticleCoords.lonEastDeg, safeActiveIdx)
              }
              onCompareWithPsr={handleCompareWithPsr}
              onKeepOnlyOne={handleKeepOnlyOne}
              onClose={() => setActivePopover(null)}
            />
          )}

          {/* Side Drawers */}
          {chartsOpen && (
            <ChartsDrawer
              entries={entries}
              terrainSiteIds={terrainSiteIds}
              activeSlotIdx={safeActiveIdx}
              horizonAzDeg={dataset.horizon_azimuths_deg}
              missionWindow={dataset.mission_window}
              slice={slice}
              epochIdx={clampedEpochIdx}
              config={config}
              onSelectEpoch={(idx) => {
                setIsPlaying(false);
                setEpochIdx(idx);
              }}
              onClose={() => { setChartsOpen(false); document.getElementById('overtime-trigger')?.focus(); }}
            />
          )}

          {dataOpen && (
            <DataDrawer
              entries={entries}
              readouts={readouts}
              activeSlotIdx={safeActiveIdx}
              onSelectActiveSlot={setActiveSlotIdx}
              summary={plainSummary}
              slice={slice}
              periodStartUtc={dataset.mission_window.timestamps_utc[slice.startIdx]}
              periodEndUtc={dataset.mission_window.timestamps_utc[slice.endIdx]}
              config={config}
              provenance={dataset.provenance}
              onChangeOffset={handleChangeOffset}
              onChangeConfig={setConfig}
              scenarioActions={(
                <ScenarioActions
                  canSearch={readouts[safeActiveIdx]?.kind === 'terrain'}
                  hasLaterSamples={clampedEpochIdx + 1 < dataset.mission_window.timestamps_utc.length}
                  jointSatisfied={readouts[safeActiveIdx]?.jointVisibilitySatisfied ?? null}
                  coverageEnd={formatUtcShort(dataset.mission_window.timestamps_utc[dataset.mission_window.timestamps_utc.length - 1])}
                  earthCriterion={config.dteMarginMode === 'center' ? 'center above the horizon' : 'whole disk above the horizon'}
                  searchNotice={searchFeedback?.context === activeContext ? searchFeedback.text : null}
                  shareMessage={shareFeedback?.context === activeContext ? shareFeedback.message : null}
                  shareUrl={shareFeedback?.context === activeContext && shareFeedback.manualCopy ? shareFeedback.url || null : null}
                  onFindNext={handleFindNext}
                  onShare={handleShare}
                />
              )}
              onClose={() => { setDataOpen(false); document.getElementById('conditions-trigger')?.focus(); }}
            />
          )}
        </>
      )}
    </div>
  );
}
