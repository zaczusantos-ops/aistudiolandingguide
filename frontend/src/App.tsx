import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import rawDataset from './data/south_pole_precomputed.v1.json';
import type { NavigatorDatasetV1 } from './navigator/types';
import { Explanation } from './explorer/Explanation';
import { formatElevation, getConditions } from './explorer/geometry';
import { createCustomScenario, createNamedScenario, formatCoordinates, formatUtc, parseUtcInput, type Scenario } from './explorer/scenario';
import type { SurfaceMode } from './landing-guide/lunarTerrainEngine';

// The checked-in fixture is validated in contract tests, without compiling
// Ajv and revalidating 1.4 MB before the first browser render.
const defaultDataset = rawDataset as NavigatorDatasetV1;
const LunarViewport = lazy(() => import('./landing-guide/LunarViewport').then(module => ({ default: module.LunarViewport })));
const STEPS = ['Location', 'Date & time', 'Sunlight & energy', 'Earth & communication'];
const TITLES = ['Choose a point.', 'Choose the time.', 'Sunlight, then energy.', 'A path to Earth.'];
const NEXT = ['Continue to date & time', 'Continue to sunlight & energy', 'Continue to Earth & communication'];
export interface AppProps { dataset?: NavigatorDatasetV1 }

function MoonPoster({ unavailable = false }: { unavailable?: boolean }) {
  return <div className="moon-poster"><img src="/assets/lunar/moon-poster.jpg" alt="NASA LRO photographic Moon mosaic; reference image with illustrative lighting" width="1024" height="1024" fetchPriority="high" /><p role="status">{unavailable ? '3D view unavailable. Use the location list to keep exploring.' : 'Loading the interactive Moon…'}</p></div>;
}
class MoonBoundary extends React.Component<React.PropsWithChildren<{ onUnavailable: () => void }>, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable(); }
  render() { return this.state.failed ? <MoonPoster unavailable /> : this.props.children; }
}

function TimeEditor({ scenario, dataset, onCommit, comparison = false }: { scenario: Scenario; dataset: NavigatorDatasetV1; onCommit: (epoch: number, continueNext?: boolean) => void; comparison?: boolean }) {
  const timestamps = dataset.mission_window.timestamps_utc, iso = timestamps[scenario.epochIdx];
  const [date, setDate] = useState(iso.slice(0, 10));
  const [hour, setHour] = useState(String(new Date(iso).getUTCHours()));
  const [error, setError] = useState<string | null>(null);
  const inputId = React.useId();
  useEffect(() => { setDate(iso.slice(0, 10)); setHour(String(new Date(iso).getUTCHours())); setError(null); }, [iso]);
  return <form className="field-stack" id={comparison ? `${inputId}-form` : 'scenario-time-form'} noValidate onSubmit={event => {
    event.preventDefault(); const result = parseUtcInput(date, hour, timestamps);
    if (!result.valid) { setError(result.error); return; }
    setError(null); onCommit(result.epochIdx, (event.nativeEvent as SubmitEvent).submitter?.hasAttribute('data-continue') ?? false);
  }}>
    <div className="field-pair">
      <label className="field-label" htmlFor={`${inputId}-date`}>{comparison ? 'Comparison date (UTC)' : 'Date (UTC)'}
        <input id={`${inputId}-date`} type="date" value={date} min={timestamps[0].slice(0, 10)} max={timestamps.at(-1)!.slice(0, 10)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined} onChange={event => setDate(event.target.value)} />
      </label>
      <label className="field-label" htmlFor={`${inputId}-hour`}>{comparison ? 'Comparison hour (UTC)' : 'Hour (UTC)'}
        <input id={`${inputId}-hour`} type="number" inputMode="numeric" min="0" max="23" step="1" value={hour} aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined} onChange={event => setHour(event.target.value)} />
      </label>
    </div>
    {error && <p className="inline-error" id={`${inputId}-error`} role="alert">{error} The results still show the last valid time.</p>}
    <button className="text-action" type="submit">{comparison ? 'Use comparison time' : 'Use this time'} <span aria-hidden="true">↗</span></button>
  </form>;
}

function Conditions({ scenario, compact = false, label }: { scenario: Scenario; compact?: boolean; label?: string }) {
  const conditions = getConditions(scenario.site, scenario.epochIdx);
  return <div className={compact ? 'comparison-values' : 'conditions-strip'} role="region" aria-label={label ?? (compact ? 'Comparison Sun and Earth conditions' : 'Sun and Earth conditions')}>
    {(['sun', 'earth'] as const).map(body => <p className="condition-item" key={body}>
      <span>{body === 'sun' ? 'Sun center' : 'Earth center'}</span>
      <span className="condition-value">{formatElevation(conditions[body].elevationDeg)}</span>
      <span className="condition-state">{conditions[body].position} geometric horizon</span>
    </p>)}
  </div>;
}

export function App({ dataset = defaultDataset }: AppProps) {
  const [step, setStep] = useState(0);
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [createNamedScenario(dataset, dataset.sites[0].id)]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [surface, setSurface] = useState<SurfaceMode>('realistic');
  const [moonStatus, setMoonStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [rotating, setRotating] = useState(() => !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [coordinateError, setCoordinateError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [hasChosen, setHasChosen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const comparisonHeading = useRef<HTMLHeadingElement>(null);
  const comparisonLauncher = useRef<HTMLButtonElement>(null);
  const sources = useRef<HTMLDetailsElement>(null);
  const previousStep = useRef(step);
  const safeIndex = Math.min(activeIndex, scenarios.length - 1), current = scenarios[safeIndex];
  const currentUtc = dataset.mission_window.timestamps_utc[current.epochIdx];
  const entries = useMemo(() => scenarios.map((scenario, index) => ({ label: index === 0 ? 'A' as const : 'B' as const, site: scenario.site })), [scenarios]);
  useEffect(() => { document.documentElement.removeAttribute('data-started'); document.body.removeAttribute('data-started'); }, []);
  useEffect(() => { setLatitude(current.site.center.latitude_deg.toFixed(4)); setLongitude(current.site.center.longitude_east_deg.toFixed(4)); setCoordinateError(null); }, [current.site.id]);
  useEffect(() => { if (previousStep.current !== step) { previousStep.current = step; if (step > 0) setRotating(false); heading.current?.focus(); } }, [step]);

  const updateScenario = (index: number, scenario: Scenario) => {
    setHasChosen(true);
    setScenarios(previous => previous.map((entry, idx) => idx === index ? scenario : entry));
    setAnnouncement(`${scenario.site.name}. ${formatUtc(dataset.mission_window.timestamps_utc[scenario.epochIdx])}. ${scenario.origin === 'approximate' ? 'Approximate' : 'Precomputed'} geometry.`);
  };
  const chooseNamed = (id: string, index = safeIndex) => { updateScenario(index, createNamedScenario(dataset, id, scenarios[index].epochIdx)); setRotating(false); };
  const pickCoordinates = (lat: number, lon: number, index = safeIndex) => { updateScenario(index, createCustomScenario(dataset, lat, lon, scenarios[index].epochIdx)); setRotating(false); };
  const changeTime = (index: number, epochIdx: number) => updateScenario(index, { ...scenarios[index], epochIdx });
  const showSources = () => {
    if (sources.current) { sources.current.open = true; sources.current.scrollIntoView({ block: 'start', behavior: 'auto' }); sources.current.querySelector('summary')?.focus(); }
  };

  return <div className="lunar-app">
    <a className="skip-link" href="#guide-controls">Skip to controls</a>
    <header className="minimal-header">
      <a href="#guide-controls" className="wordmark" onClick={() => setStep(0)}>Lunar <span>/ landing guide</span></a>
      <nav className="top-links" aria-label="Page navigation">
        <button className="text-action" onClick={() => setStep(0)}>Explore</button>
        <button className="text-action" onClick={() => setStep(2)}>Guide</button>
        <button className="text-action" onClick={showSources}>Sources</button>
      </nav>
    </header>
    <main className="explore-main">
      <section className="moon-column" aria-label="Explore the Moon">
        <div className="moon-frame"><MoonBoundary onUnavailable={() => setMoonStatus('unavailable')}><Suspense fallback={<MoonPoster />}>
          <LunarViewport mode="3d" surfaceMode={surface} sites={dataset.sites} entries={entries} activeSlotIdx={safeIndex} epochIdx={current.epochIdx}
            hasStarted embedded autoRotate={rotating} onAutoRotateChange={setRotating} onStatusChange={setMoonStatus} selectionEnabled={step === 0}
            showSkyMarkers={false} showCameraTools onSelectActiveSlot={setActiveIndex} selectionMode="cursor"
            onSelectSiteDirect={(id, index) => chooseNamed(id, index)} onOutsidePolarCoverage={pickCoordinates}
            reticleCoords={{ latDeg: current.site.center.latitude_deg, lonEastDeg: current.site.center.longitude_east_deg }} />
        </Suspense></MoonBoundary></div>
        <div className="moon-caption"><span>{step === 0 ? 'Drag to turn · select a point' : 'Drag to turn · change location in step 1'}</span>
          {moonStatus === 'ready' && <button className="text-action" onClick={() => setSurface(previous => previous === 'realistic' ? 'topography' : 'realistic')} aria-pressed={surface === 'topography'}>{surface === 'topography' ? 'Show surface' : 'Show topography'}</button>}
        </div>
        {surface === 'topography' && moonStatus === 'ready' && <div className="topography-key"><span>Display elevation (km)</span><div className="topography-ramp" role="img" aria-label="Elevation scale: blue and purple are lower, green is zero, yellow and red are higher" /><div className="topography-labels"><span>−9</span><span>0</span><span>+8.5</span></div><p>Visual relief only. Terrain blockage is not calculated.</p></div>}
      </section>
      <section className="guide-column" id="guide-controls" tabIndex={-1} aria-label="Location, time and explanations">
        <nav className="guide-progress" aria-label="Exploration steps">{STEPS.map((label, index) => <button className="guide-step" type="button" key={label} aria-current={index === step ? 'step' : undefined} onClick={() => setStep(index)}>{label}</button>)}</nav>
        <h1 className="step-heading" ref={heading} tabIndex={-1}>{TITLES[step]}</h1>
        <section className="source-line" role="region" aria-label="Current scenario"><p>{current.site.name}</p><p>{formatCoordinates(current.site.center.latitude_deg, current.site.center.longitude_east_deg)} · {formatUtc(currentUtc)}</p><p>{!hasChosen && 'Example · '}{current.origin === 'approximate' ? 'Approximate geometry' : 'Precomputed geometry'}</p></section>
        {step === 0 && <>
          <p className="step-intro">Choose a point on the Moon, or use the location list.</p>
          <label className="field-label">Location<select className="native-select" aria-label="Location" value={current.site.id} onChange={event => chooseNamed(event.target.value)}>
            {current.origin === 'approximate' && <option value={current.site.id}>{current.site.name}</option>}
            {dataset.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select></label>
          <details className="coordinate-fields"><summary>Enter coordinates</summary>
            <form className="field-stack" noValidate onSubmit={event => {
              event.preventDefault(); const lat = Number(latitude), lon = Number(longitude);
              if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -360 || lon > 360) { setCoordinateError('Enter a latitude from −90° to 90° and an east longitude from −360° to 360°.'); return; }
              setCoordinateError(null); pickCoordinates(lat, lon);
            }}>
              <div className="field-pair">
                <label className="field-label">Latitude (degrees)<input type="number" inputMode="decimal" step="any" min="-90" max="90" value={latitude} aria-invalid={coordinateError ? true : undefined} aria-describedby={coordinateError ? 'coordinate-error' : undefined} onChange={event => setLatitude(event.target.value)} /></label>
                <label className="field-label">Longitude east (degrees)<input type="number" inputMode="decimal" step="any" min="-360" max="360" value={longitude} aria-invalid={coordinateError ? true : undefined} aria-describedby={coordinateError ? 'coordinate-error' : undefined} onChange={event => setLongitude(event.target.value)} /></label>
              </div>
              {coordinateError && <p role="alert" className="inline-error" id="coordinate-error">{coordinateError}</p>}
              <button className="text-action" type="submit">Use these coordinates</button>
            </form>
          </details>
        </>}
        {step === 1 && <><p className="step-intro">The terrain stays the same. The Sun and Earth change position.</p>
          <TimeEditor key={`active-time-${safeIndex}`} scenario={current} dataset={dataset} onCommit={(epoch, continueNext) => { changeTime(safeIndex, epoch); if (continueNext) setStep(2); }} />
          <p className="source-line">Available: {formatUtc(dataset.mission_window.timestamps_utc[0])}–{formatUtc(dataset.mission_window.timestamps_utc.at(-1)!)}. Hourly samples.</p>
        </>}
        {step >= 2 && <Explanation topic={step === 2 ? 'sun' : 'earth'} site={current.site} epochIdx={current.epochIdx} currentUtc={currentUtc} />}
        <Conditions scenario={current} /><p className="source-line">Terrain blockage is not calculated.</p>
        <div className="step-actions">{step > 0 && <button type="button" className="text-action" onClick={() => setStep(previous => previous - 1)}>Back</button>}{step === 1 ? <button key="submit-time" className="text-action" type="submit" form="scenario-time-form" data-continue>{NEXT[step]} <span aria-hidden="true">→</span></button> : step < 3 && <button key={`next-${step}`} type="button" className="text-action" onClick={event => { event.preventDefault(); setStep(previous => previous + 1); }}>{NEXT[step]} <span aria-hidden="true">→</span></button>}</div>
        {step === 3 && scenarios.length === 1 && <button ref={comparisonLauncher} className="text-action" onClick={() => { setScenarios(previous => [previous[0], { ...previous[0] }]); window.setTimeout(() => comparisonHeading.current?.focus(), 0); }}>Compare another site or date</button>}
        {scenarios.length === 2 && <section className="comparison" aria-label="Optional comparison">
          <div className="comparison-head"><h2 ref={comparisonHeading} tabIndex={-1}>Compare.</h2><button className="text-action" onClick={() => { setScenarios(previous => [previous[0]]); setActiveIndex(0); setStep(3); window.setTimeout(() => comparisonLauncher.current?.focus(), 0); }}>Remove comparison</button></div>
          <div className="step-actions" role="group" aria-label="Choose the scenario shown on the Moon"><button className="text-action" aria-pressed={safeIndex === 0} onClick={() => setActiveIndex(0)}>Show A on Moon</button><button className="text-action" aria-pressed={safeIndex === 1} onClick={() => setActiveIndex(1)}>Show B on Moon</button></div>
          <p className="source-line">A: {scenarios[0].site.name} · {formatUtc(dataset.mission_window.timestamps_utc[scenarios[0].epochIdx])} · {scenarios[0].origin === 'approximate' ? 'Approximate geometry' : 'Precomputed geometry'}</p>
          <Conditions scenario={scenarios[0]} compact label="Scenario A Sun and Earth conditions" />
          <label className="field-label">Comparison location<select className="native-select" aria-label="Comparison location" value={scenarios[1].site.id} onChange={event => chooseNamed(event.target.value, 1)}>{scenarios[1].origin === 'approximate' && <option value={scenarios[1].site.id}>{scenarios[1].site.name}</option>}{dataset.sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}</select></label>
          <TimeEditor comparison scenario={scenarios[1]} dataset={dataset} onCommit={epoch => changeTime(1, epoch)} />
          <p className="source-line">B: {scenarios[1].site.name} · {formatUtc(dataset.mission_window.timestamps_utc[scenarios[1].epochIdx])} · {scenarios[1].origin === 'approximate' ? 'Approximate geometry' : 'Precomputed geometry'}</p>
          <Conditions scenario={scenarios[1]} compact /><p className="source-line">{scenarios[0].site.id === scenarios[1].site.id ? scenarios[0].epochIdx === scenarios[1].epochIdx ? 'Same point and time. Change either to compare.' : 'Same point, different times.' : scenarios[0].epochIdx === scenarios[1].epochIdx ? 'Different points at the same time.' : 'Different points and times; either change can affect the angles.'}</p>
        </section>}
        <details className="source-section" ref={sources}><summary>Sources &amp; limits</summary>
          <p>Named locations use saved SPICE-based positions. Custom points use an approximate reprojection on a spherical Moon. These are calculations, not live observations.</p>
          <p>The geometric horizon ignores mountains and crater rims. Sunlight and Earth direction do not determine electricity, battery life or radio performance.</p>
          <p>Display imagery and relief are separate from these results. The reference image and 3D shading are illustrative; neither shows sunlight at your selected time.</p>
          <p><a href="https://svs.gsfc.nasa.gov/5001/" target="_blank" rel="noreferrer">Moon mosaic — NASA’s Scientific Visualization Studio</a> · <a href="https://svs.gsfc.nasa.gov/4720/" target="_blank" rel="noreferrer">LROC / LOLA display sources</a> · <a href="https://naif.jpl.nasa.gov/naif/" target="_blank" rel="noreferrer">NAIF SPICE</a></p>
          <p>The saved Horizons check covers sixteen times at one site. It does not validate all global locations, terrain, energy or radio links.</p>
        </details>
      </section>
    </main>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
  </div>;
}
