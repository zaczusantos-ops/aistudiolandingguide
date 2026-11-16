import React, { useEffect, useMemo, useState } from 'react';
import rawDataset from './data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from './contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from './navigator/math';
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
import { LunarViewport } from './landing-guide/LunarViewport';
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

const defaultDataset: NavigatorDatasetV1 = parseNavigatorDataset(rawDataset);

export interface AppProps {
  dataset?: NavigatorDatasetV1;
}

function getInitialAutostart(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autostart') === '1';
}

function getInitialViewportMode(): ViewportMode {
  if (typeof window === 'undefined') return '3d';
  return new URLSearchParams(window.location.search).get('view') === 'astronaut' ? 'astronaut' : '3d';
}

function detectIsMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 820px)').matches;
}

export function App({ dataset = defaultDataset }: AppProps) {
  const [hasStarted, setHasStarted] = useState<boolean>(getInitialAutostart);
  const [viewportMode, setViewportMode] = useState<ViewportMode>(getInitialViewportMode);
  const [surfaceMode, setSurfaceMode] = useState<SurfaceMode>('realistic');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('cursor');

  const [slots, setSlots] = useState<SiteSlotState[]>(() => [
    { siteId: dataset.sites[0].id, offsetXNorm: 0, offsetYNorm: 0 },
  ]);
  const [customSites, setCustomSites] = useState<Record<string, LandingSiteEntry>>({});
  const [activeSlotIdx, setActiveSlotIdx] = useState<number>(0);

  const [startIdx, setStartIdx] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<DurationDays>(30);
  const [epochIdx, setEpochIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [config, setConfig] = useState<EngineeringConfig>(DEFAULT_CONFIG);

  const [chartsOpen, setChartsOpen] = useState<boolean>(false);
  const [dataOpen, setDataOpen] = useState<boolean>(false);
  const [activePopover, setActivePopover] = useState<'time' | 'selection' | null>(null);

  const [reticleCoords, setReticleCoords] = useState<{ latDeg: number; lonEastDeg: number }>({
    latDeg: -85,
    lonEastDeg: 12,
  });
  const [coverageNotice, setCoverageNotice] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(detectIsMobile);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.started = hasStarted ? 'true' : 'false';
      document.body.dataset.started = hasStarted ? 'true' : 'false';
    }
  }, [hasStarted]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(max-width: 820px)');
    const onChange = (ev: MediaQueryListEvent) => setIsMobile(ev.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!hasStarted) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activePopover !== null) {
          setActivePopover(null);
        } else if (chartsOpen || dataOpen) {
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

  const handleStart = (siteId?: string) => {
    if (siteId) {
      setSlots((prev) => setSiteSlotAt(prev, 0, siteId));
      setActiveSlotIdx(0);
    }
    setHasStarted(true);
    setDataOpen(false);
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
  };

  const handleCoordinatePick = (
    latDeg: number,
    lonEastDeg: number,
    slotIdx: number,
    atlas?: LunarAtlasData,
  ) => {
    const effectiveAtlas =
      atlas ?? getLoadedRealAtlasSync() ?? buildLunarAtlasData(dataset.sites, 256, 128);
    const customSite = createCustomLandingSite({
      latDeg,
      lonEastDeg,
      atlas: effectiveAtlas,
      referenceSites: dataset.sites,
      horizonAzDeg: dataset.horizon_azimuths_deg,
      missionWindow: dataset.mission_window,
    });
    setCustomSites((prev) => ({ ...prev, [customSite.id]: customSite }));
    setSlots((prev) => setSiteSlotAt(prev, slotIdx, customSite.id));
    if (latDeg > -78) {
      setCoverageNotice(
        `Unvisited pin dropped at ${customSite.name}: 360° horizon ray-marched on global LOLA DEM with SPICE Sun/Earth tracks (polar ELFO relay applies inside 80°S–90°S).`,
      );
    } else {
      setCoverageNotice(null);
    }
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
      if (next && isMobile) {
        setDataOpen(false);
        setActivePopover(null);
      }
      return next;
    });
  };

  const toggleData = () => {
    setDataOpen((prev) => {
      const next = !prev;
      if (next && isMobile) {
        setChartsOpen(false);
        setActivePopover(null);
      }
      return next;
    });
  };

  const togglePopover = (pop: 'time' | 'selection') => {
    setActivePopover((prev) => {
      const next = prev === pop ? null : pop;
      if (next && isMobile) {
        setChartsOpen(false);
        setDataOpen(false);
      }
      return next;
    });
  };

  const handleEnterAstronaut = () => {
    // The explorer HUD is hidden while walking; close its drawers so Orbit 3D comes back clean.
    setChartsOpen(false);
    setDataOpen(false);
    setActivePopover(null);
    setViewportMode('astronaut');
  };

  const handleResetTime = () => {
    setIsPlaying(false);
    setStartIdx(0);
    setDurationDays(30);
    setEpochIdx(0);
  };

  return (
    <div className="guide-shell" data-started={hasStarted ? 'true' : 'false'}>
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

      {/* 1st-Person Astronaut Surface View (the explorer HUD is hidden while walking) */}
      {hasStarted && viewportMode === 'astronaut' && (
        <AstronautViewport
          entries={entries}
          activeSlotIdx={safeActiveIdx}
          epochIdx={clampedEpochIdx}
          onExit={() => setViewportMode('3d')}
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

      {hasStarted && viewportMode === '3d' && (
        <>
          {/* Top-Left: Brief & Charts */}
          <div className="hud-corner hud-top-left">
            <button
              type="button"
              className="hud-btn hud-btn-muted"
              onClick={handleReturnToBrief}
              aria-label="Return to Mission Brief"
            >
              <span aria-hidden="true">←</span>
              <span>Brief</span>
            </button>
            <button
              type="button"
              className={`hud-btn ${chartsOpen ? 'active' : ''}`}
              aria-expanded={chartsOpen}
              onClick={toggleCharts}
            >
              <span>Charts</span>
            </button>
          </div>

          {/* Top-Center: Moon | Topography */}
          <div className="hud-top-center">
            <div className="surface-switch-pill" role="group" aria-label="Surface display mode">
              <button
                type="button"
                className={`hud-seg-btn ${surfaceMode === 'realistic' ? 'active' : ''}`}
                aria-pressed={surfaceMode === 'realistic'}
                onClick={() => setSurfaceMode('realistic')}
              >
                Moon
              </button>
              <button
                type="button"
                className={`hud-seg-btn ${surfaceMode === 'topography' ? 'active' : ''}`}
                aria-pressed={surfaceMode === 'topography'}
                onClick={() => setSurfaceMode('topography')}
              >
                Topography
              </button>
            </div>

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
              aria-expanded={activePopover === 'selection'}
              onClick={() => togglePopover('selection')}
            >
              <span>Sites ({entries.length})</span>
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
          {!chartsOpen && !dataOpen && activePopover === null && (
            <div className="ab-floating-dock" aria-label="Selected lunar sites">
              <div className="ab-dock-row">
                {entries.map((entry, idx) => {
                  const ep = entry.analysis.epochStates[clampedEpochIdx];
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
                        <span className="ab-chip" aria-hidden="true">
                          {entry.label}
                        </span>
                        <div className="ab-card-text">
                          <strong>{entry.site.name}</strong>
                          <span>
                            {Math.abs(entry.analysis.terrain.latitudeDeg).toFixed(2)}°{' '}
                            {entry.analysis.terrain.latitudeDeg < 0 ? 'S' : 'N'} · Sun{' '}
                            {(ep.fIllum * 100).toFixed(0)}%
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
                    aria-label="Add comparison site"
                  >
                    + Site
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bottom-Left: Orbit 3D / Astronaut (this HUD only renders in Orbit 3D; the Astronaut
              view has its own small "Orbit 3D" exit control + Esc) */}
          <div className="hud-corner hud-bottom-left">
            <div className="mode-switch-pill" role="group" aria-label="Switch Orbit 3D and Astronaut surface view">
              <button type="button" className="hud-seg-btn active" aria-pressed="true">
                Orbit 3D
              </button>
              <button type="button" className="hud-seg-btn" aria-pressed="false" onClick={handleEnterAstronaut}>
                Astronaut
              </button>
            </div>
          </div>

          {/* Bottom-Center: Time (UTC) */}
          <div className="hud-bottom-center">
            <div className="time-pill" role="group" aria-label="UTC epoch playback controls">
              <button
                type="button"
                className={`time-pill-trigger ${activePopover === 'time' ? 'active' : ''}`}
                aria-expanded={activePopover === 'time'}
                onClick={() => togglePopover('time')}
              >
                <span>Time</span>
              </button>
              <div className="time-pill-readout">
                <strong>{formatUtcShort(currentUtc)}</strong>
                <span>{durationDays}d window</span>
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
              aria-expanded={dataOpen}
              onClick={toggleData}
            >
              <span>Data</span>
              <span className="hud-badge" aria-label={`${entries.length} selected sites`}>
                {entries.length}
              </span>
            </button>
          </div>

          {/* Popovers */}
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
              onChangeDuration={(days) => setDurationDays(days)}
              onTogglePlay={() => setIsPlaying((p) => !p)}
              onResetTime={handleResetTime}
              onChangeSpeed={(sp) => setSpeed(sp)}
              onClose={() => setActivePopover(null)}
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
              onClose={() => setChartsOpen(false)}
            />
          )}

          {dataOpen && (
            <DataDrawer
              entries={entries}
              activeSlotIdx={safeActiveIdx}
              onSelectActiveSlot={setActiveSlotIdx}
              summary={plainSummary}
              slice={slice}
              config={config}
              provenance={dataset.provenance}
              onChangeOffset={handleChangeOffset}
              onChangeConfig={setConfig}
              onClose={() => setDataOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
