import React, { useEffect, useId, useRef, useState } from 'react';
import { bodyDirectionAt, type ExplorerSite } from '../explorer/geometry';
import type { LandingSiteEntry } from '../navigator/types';
import type { LunarAtlasData, SurfaceMode } from './lunarTerrainEngine';
import { SLOT_META, type SelectionMode, type SlotLabel, type ViewportMode } from './state';
import type { MoonMarker, MoonRuntime, MoonRuntimeOptions, ProjectedMoonMarker } from './moonRuntime';

export interface LunarViewportProps {
  mode: ViewportMode;
  surfaceMode: SurfaceMode;
  sites: LandingSiteEntry[];
  entries: { label: SlotLabel; site: ExplorerSite }[];
  activeSlotIdx: number;
  onSelectActiveSlot: (index: number) => void;
  epochIdx: number;
  hasStarted: boolean;
  showSkyMarkers?: boolean;
  selectionMode: SelectionMode;
  onSelectSiteDirect: (siteId: string, slotIdx: number) => void;
  onOutsidePolarCoverage: (latDeg: number, lonEastDeg: number, slotIdx: number, atlas?: LunarAtlasData) => void;
  onReticleChange?: (latDeg: number, lonEastDeg: number) => void;
  reticleCoords: { latDeg: number; lonEastDeg: number };
  embedded?: boolean;
  autoRotate?: boolean;
  onAutoRotateChange?: (enabled: boolean) => void;
  selectionEnabled?: boolean;
  showCameraTools?: boolean;
  onStatusChange?: (status: 'loading' | 'ready' | 'unavailable') => void;
}

export function LunarViewport({
  mode, surfaceMode, sites, entries, activeSlotIdx, onSelectActiveSlot,
  epochIdx, hasStarted, showSkyMarkers = false, selectionMode,
  onSelectSiteDirect, onOutsidePolarCoverage, onReticleChange, reticleCoords,
  embedded = false, autoRotate = true, onAutoRotateChange,
  selectionEnabled = true, showCameraTools = true, onStatusChange,
}: LunarViewportProps) {
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<MoonRuntime | null>(null);
  const markerElements = useRef(new Map<string, HTMLButtonElement | HTMLSpanElement>());
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [referenceReady, setReferenceReady] = useState(false);
  const [referenceError, setReferenceError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [detail, setDetail] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [detailStatus, setDetailStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [topographyStatus, setTopographyStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const statusCallback = useRef(onStatusChange);
  statusCallback.current = onStatusChange;
  useEffect(() => { statusCallback.current?.(renderStatus); }, [renderStatus]);
  const instructionsId = useId();
  const activeEntry = entries[activeSlotIdx] ?? entries[0];
  const callbacks = useRef({ onOutsidePolarCoverage, onReticleChange, onAutoRotateChange, activeSlotIdx, selectionMode });
  callbacks.current = { onOutsidePolarCoverage, onReticleChange, onAutoRotateChange, activeSlotIdx, selectionMode };
  const selectedIds = new Set(entries.map(entry => entry.site.id));
  const markers: MoonMarker[] = [
    ...sites.filter(site => !selectedIds.has(site.id)).map(site => ({ id: site.id, latDeg: site.center.latitude_deg, lonEastDeg: site.center.longitude_east_deg })),
    ...entries.map(entry => ({ id: `slot-${entry.label}`, latDeg: entry.site.center.latitude_deg, lonEastDeg: entry.site.center.longitude_east_deg })),
  ];
  if (showSkyMarkers && activeEntry) {
    const sun = bodyDirectionAt(activeEntry.site, epochIdx, 'sun');
    const earth = bodyDirectionAt(activeEntry.site, epochIdx, 'earth');
    markers.push({ id: 'body-sun', ...sun }, { id: 'body-earth', ...earth });
  }
  const options: MoonRuntimeOptions = {
    autoRotate: autoRotate && !paused && !reducedMotion,
    selectionEnabled: selectionEnabled && hasStarted && selectionMode === 'cursor',
    detail,
    topography: surfaceMode === 'topography',
    active: mode === '3d',
    markers,
  };
  const currentOptions = useRef(options);
  currentOptions.current = options;
  const pause = () => { setPaused(true); callbacks.current.onAutoRotateChange?.(false); };
  const project = (projected: ProjectedMoonMarker[]) => {
    for (const point of projected) {
      const element = markerElements.current.get(point.id);
      if (!element) continue;
      element.style.visibility = point.visible ? 'visible' : 'hidden';
      element.style.transform = `translate(-50%, -50%) translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px)`;
    }
  };

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(media?.matches ?? false);
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, []);
  useEffect(() => { if (autoRotate) setPaused(false); }, [autoRotate]);

  useEffect(() => {
    let cancelled = false;
    let owned: MoonRuntime | null = null;
    // Defer the Three.js chunk until after the static image can start loading.
    const frame = requestAnimationFrame(() => {
      import('./moonRuntime').then(({ createMoonRuntime }) => {
        if (cancelled || !mount.current) return;
        try {
          owned = createMoonRuntime(mount.current, currentOptions.current, {
            ready: () => { if (!cancelled) setRenderStatus('ready'); },
            unavailable: () => { if (!cancelled) { setRenderStatus('unavailable'); pause(); } },
            pause: () => { if (!cancelled) pause(); },
            detail: status => { if (!cancelled) setDetailStatus(status); },
            topography: status => { if (!cancelled) setTopographyStatus(status); },
            project,
            pick: (lat, lon) => {
              const callback = callbacks.current;
              if (callback.selectionMode === 'cursor') callback.onOutsidePolarCoverage(lat, lon, callback.activeSlotIdx);
            },
            reticle: (lat, lon) => callbacks.current.onReticleChange?.(lat, lon),
          });
          runtime.current = owned;
        } catch {
          if (!cancelled) setRenderStatus('unavailable');
        }
      }).catch(() => { if (!cancelled) setRenderStatus('unavailable'); });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); owned?.dispose(); runtime.current = null; };
  }, []);

  // Updating the active scenario never recreates the GPU resources or resets the camera.
  useEffect(() => { runtime.current?.update(currentOptions.current); });

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || renderStatus !== 'ready') return;
    const amount = (event.shiftKey ? 10 : 4) * Math.PI / 180;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => runtime.current?.orbit(-amount, 0), ArrowRight: () => runtime.current?.orbit(amount, 0),
      ArrowUp: () => runtime.current?.orbit(0, -amount), ArrowDown: () => runtime.current?.orbit(0, amount),
      '+': () => runtime.current?.zoom(0.18), '=': () => runtime.current?.zoom(0.18), '-': () => runtime.current?.zoom(-0.18),
    };
    if (actions[event.key]) { event.preventDefault(); pause(); actions[event.key](); }
  };
  const controlStyle: React.CSSProperties = { minWidth: 44, minHeight: 44, padding: '8px 12px', border: 0, borderRadius: 0, background: 'transparent', color: '#f4f4f5', fontSize: 16, cursor: 'pointer' };
  const pinStyle: React.CSSProperties = { position: 'absolute', top: 0, left: 0, visibility: 'hidden', border: 0, borderRadius: '50%', background: 'transparent', color: '#101216', minWidth: 44, minHeight: 44, padding: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, pointerEvents: selectionEnabled ? 'auto' : 'none' };
  const status = renderStatus === 'unavailable'
    ? '3D view unavailable. Static NASA Moon image; choose a location from the list.'
    : renderStatus === 'loading'
      ? 'Loading 3D Moon. Static NASA image; illustrative lighting.'
      : options.topography && topographyStatus === 'loading'
        ? 'Loading LOLA elevation colors · LROC mosaic shown'
        : options.topography && topographyStatus === 'unavailable'
          ? 'LOLA elevation unavailable · LROC mosaic shown'
          : options.topography && topographyStatus === 'ready'
            ? 'LOLA elevation colors · visual relief only'
      : options.detail && detailStatus === 'ready'
        ? 'LOLA polar reference · lighting is illustrative'
        : options.detail && detailStatus === 'unavailable'
          ? 'Surface reference · polar detail unavailable'
          : 'Surface reference · lighting is illustrative';

  const sceneBottom = renderStatus === 'unavailable' ? 80 : showCameraTools ? (viewOptionsOpen ? 148 : 96) : 48;
  const sceneStyle: React.CSSProperties = { position: 'absolute', left: 0, right: 0, top: 0, bottom: sceneBottom, height: 'auto' };

  return (
    <div className={`lunar-stage${embedded ? ' lunar-stage--embedded' : ''}`}
      style={embedded ? { position: 'relative', inset: 'auto', width: '100%', height: '100%', minHeight: 320, zIndex: 0, overflow: 'hidden', background: 'transparent' } : undefined}
      data-viewport-mode={mode} data-surface-mode={surfaceMode} data-render-status={renderStatus}
      data-site-a={entries[0]?.site.id ?? ''} data-slots-count={entries.length}
      tabIndex={hasStarted && mode === '3d' && renderStatus === 'ready' ? 0 : -1}
      role="region" aria-label="Interactive Moon" aria-describedby={instructionsId} onKeyDown={keyDown}
      onFocus={event => { if (event.target === event.currentTarget) pause(); }}>
      <div style={{ ...sceneStyle, display: renderStatus === 'ready' ? 'none' : 'grid', placeItems: 'center', pointerEvents: 'none' }}>
        <img src="/assets/lunar/moon-poster.jpg" alt="NASA Moon reference image. Its lighting is illustrative and does not represent the chosen date. Use the location list to select a point."
          loading="eager" fetchPriority="high" decoding="async" onLoad={() => setReferenceReady(true)} onError={() => setReferenceError(true)}
          style={{ display: referenceError ? 'none' : 'block', width: 'min(80%, 480px)', height: 'auto', maxHeight: '85%', objectFit: 'contain' }} />
        {!referenceReady && <span style={{ position: 'absolute', color: '#a1a1aa', fontSize: 14 }}>{referenceError ? 'Lunar image unavailable. Use the location list.' : 'Loading lunar image…'}</span>}
      </div>
      <div ref={mount} data-testid="lunar-webgl-canvas" className="lunar-webgl-mount" style={{ ...sceneStyle, opacity: renderStatus === 'ready' ? 1 : 0, visibility: mode === '3d' ? 'visible' : 'hidden', pointerEvents: renderStatus === 'ready' ? 'auto' : 'none' }} aria-hidden="true" />
      {renderStatus === 'ready' && <div aria-label="Lunar site markers" style={{ ...sceneStyle, pointerEvents: 'none', overflow: 'hidden' }}>
        {sites.filter(site => !selectedIds.has(site.id)).map(site => <button key={site.id} ref={element => { if (element) markerElements.current.set(site.id, element); else markerElements.current.delete(site.id); }} type="button"
          style={pinStyle} disabled={!selectionEnabled} tabIndex={selectionEnabled ? 0 : -1} aria-label={`Choose ${site.name}`}
          onFocus={pause} onClick={() => { pause(); onSelectSiteDirect(site.id, activeSlotIdx); }} title={site.name}><span style={{ display: 'block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #101216', background: '#e5e7eb' }} /></button>)}
        {entries.map((entry, index) => <button key={entry.label} ref={element => { const id = `slot-${entry.label}`; if (element) markerElements.current.set(id, element); else markerElements.current.delete(id); }} type="button"
          style={pinStyle} disabled={!selectionEnabled} aria-label={`Site ${entry.label}: ${entry.site.name}`} aria-pressed={index === activeSlotIdx}
          onFocus={pause} onClick={() => { pause(); onSelectActiveSlot(index); }} tabIndex={selectionEnabled ? 0 : -1}><span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: '50%', border: '2px solid #101216', background: SLOT_META[entry.label].color }}>{entry.label}</span></button>)}
        {showSkyMarkers && ['sun', 'earth'].map(body => <span key={body} ref={element => { const id = `body-${body}`; if (element) markerElements.current.set(id, element); else markerElements.current.delete(id); }} style={{ ...pinStyle, background: '#15181e', color: '#f4f4f5', borderRadius: 4, padding: '3px 6px', pointerEvents: 'none' }}>{body === 'sun' ? 'Sun direction' : 'Earth direction'}</span>)}
      </div>}
      {hasStarted && selectionEnabled && selectionMode === 'crosshair' && renderStatus === 'ready' && <span aria-hidden="true" style={{ position: 'absolute', left: '50%', top: `calc((100% - ${sceneBottom}px) / 2)`, color: '#fff', pointerEvents: 'none', transform: 'translate(-50%,-50%)', fontSize: 30 }}>＋</span>}
      {showCameraTools && renderStatus === 'ready' && <div className="viewport-camera-tools" role="group" aria-label="Moon camera controls" style={{ position: 'absolute', left: 8, right: 8, bottom: 40, display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'nowrap', zIndex: 8 }}>
        <button type="button" className="cam-btn" style={controlStyle} aria-label="Zoom in" onClick={() => runtime.current?.zoom(0.18)}>+</button>
        <button type="button" className="cam-btn" style={controlStyle} aria-label="Zoom out" onClick={() => runtime.current?.zoom(-0.18)}>−</button>
        {!reducedMotion && <button type="button" className="cam-btn" style={controlStyle} onClick={() => { const enabled = !options.autoRotate; setPaused(!enabled); callbacks.current.onAutoRotateChange?.(enabled); }}>{options.autoRotate ? 'Pause rotation' : 'Resume rotation'}</button>}
        <details className="moon-view-options" onToggle={event => { setViewOptionsOpen(event.currentTarget.open); if (event.currentTarget.open) pause(); }}>
          <summary className="cam-btn" aria-label="More view options" style={{ ...controlStyle, display: 'flex', alignItems: 'center', listStyle: 'none' }}>More</summary>
          <div role="group" aria-label="More Moon view options" style={{ position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4 }}>
            <button type="button" className="cam-btn" style={controlStyle} onClick={() => runtime.current?.view('globe')}>Globe</button>
            <button type="button" className="cam-btn" style={controlStyle} onClick={() => runtime.current?.view('south')}>South pole</button>
            <button type="button" className="cam-btn" style={controlStyle} aria-pressed={detail} onClick={() => { pause(); setDetail(value => !value); }}>Polar detail</button>
          </div>
        </details>
      </div>}
      <p className="viewport-status" role="status" aria-label="3D view status" style={{ top: 'auto', bottom: 4, left: 8, right: 8, maxWidth: 'none', textAlign: 'center', padding: 0, margin: 0, background: 'transparent', fontSize: 15, lineHeight: '18px', color: '#a1a1aa' }}>{status}</p>
      <span id={instructionsId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {selectionEnabled ? 'Click a point or use the location list. ' : 'Location selection is paused during this step. '}
        Drag with a mouse or two fingers to rotate. When this view is focused, use arrow keys to rotate and plus or minus to zoom. Display lighting does not calculate terrain blockage.
        {selectionMode === 'crosshair' ? ` Reticle ${reticleCoords.latDeg.toFixed(1)} degrees latitude, ${reticleCoords.lonEastDeg.toFixed(1)} degrees east.` : ''}
      </span>
    </div>
  );
}
