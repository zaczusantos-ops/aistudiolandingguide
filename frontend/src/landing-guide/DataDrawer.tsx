import React from 'react';
import { ConditionReadout, formatConditionsUtc } from './ConditionReadout';
import type { SiteReadout } from './siteReadings';
import { EngineeringConfig, NavigatorProvenance, PanelMode } from '../navigator/types';
import { EvaluatedSlotEntry, GLOSSARY_ITEMS, PlainLanguageSummary, WindowSlice } from './state';

interface DataDrawerProps {
  entries: EvaluatedSlotEntry[];
  readouts: SiteReadout[];
  activeSlotIdx: number;
  onSelectActiveSlot: (index: number) => void;
  summary: PlainLanguageSummary;
  slice: WindowSlice;
  periodStartUtc?: string;
  periodEndUtc?: string;
  config: EngineeringConfig;
  provenance: NavigatorProvenance;
  onChangeOffset: (slotIdx: number, xNorm: number, yNorm: number) => void;
  onChangeConfig: (next: EngineeringConfig) => void;
  scenarioActions?: React.ReactNode;
  onOpenCharts?: () => void;
  onClose: () => void;
}

const PANEL_NAMES: Record<PanelMode, string> = {
  tracking: 'vertical tracking',
  fixed_north: 'fixed vertical, north-facing',
  fixed_horiz: 'fixed horizontal',
};

export const DataDrawer: React.FC<DataDrawerProps> = ({
  entries, readouts, activeSlotIdx, onSelectActiveSlot, slice, periodStartUtc, periodEndUtc,
  config, provenance, onChangeOffset, onChangeConfig, scenarioActions, onOpenCharts, onClose,
}) => {
  const clpsLimit = provenance.conventions.clps_slope_limit_deg;
  const activeIndex = entries[activeSlotIdx] ? activeSlotIdx : 0;
  const activeEntry = entries[activeIndex];
  const activeReadout = readouts[activeIndex];
  const hasTerrain = (index: number) => readouts[index]?.kind === 'terrain';
  const activeHasTerrain = hasTerrain(activeIndex);
  const hasMissingMetrics = entries.some((_, index) => !hasTerrain(index));
  const singleInstant = slice.epochCount <= 1 || slice.endIdx <= slice.startIdx;
  const metric = (index: number, value: number, decimals: number, unit: string) => (
    !singleInstant && hasTerrain(index) && Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '—'
  );
  const validationError = (value: number | null | undefined) => (
    typeof value === 'number' && Number.isFinite(value) ? `${value}°` : 'not available'
  );
  const periodLabel = periodStartUtc && periodEndUtc
    ? `${formatConditionsUtc(periodStartUtc)} to ${formatConditionsUtc(periodEndUtc)}`
    : 'Period start and end times are not available';
  const assumptionsSummary = activeHasTerrain
    ? `${Number(config.panelAreaM2.toFixed(1))} m² · ${PANEL_NAMES[config.panelMode]} · modelled relays ${config.relayEnabled ? 'on' : 'off'}`
    : 'Terrain and engineering estimates unavailable';

  if (!activeEntry) return null;

  const advancedDetails = <>
    <section className="condition-detail-section" aria-label="Coordinates and terrain">
      <h4>Coordinates</h4>
      {entries.map((entry, index) => (
        <p key={entry.label} className="condition-coordinate">
          <strong>{entries.length > 1 ? `${entry.label} · ` : ''}{entry.site.name}:</strong>{' '}
          {hasTerrain(index) ? <>
            {entry.analysis.terrain.latitudeDeg.toFixed(3)}°,{' '}
            {entry.analysis.terrain.longitudeEastDeg.toFixed(3)}° E. Elevation{' '}
            {entry.analysis.terrain.elevationM.toFixed(0)} m relative to the reference sphere.
            {' '}Permanently shadowed region: {entry.analysis.terrain.isPsr ? 'inside' : `${entry.analysis.terrain.psrDistanceM.toFixed(0)} m away`}.
          </> : <>
            {entry.site.center.latitude_deg.toFixed(3)}°,{' '}
            {entry.site.center.longitude_east_deg.toFixed(3)}° E (approximate model).
            {' '}Elevation and permanently shadowed regions are not calculated.
          </>}
        </p>
      ))}
    </section>

    {entries.length > 1 && (
      <div className="chip-row" role="group" aria-label="Select site for assumptions and sources">
        {entries.map((entry, index) => (
          <button key={entry.label} type="button" className={`btn-filter-chip ${index === activeIndex ? 'active' : ''}`} aria-pressed={index === activeIndex} onClick={() => onSelectActiveSlot(index)}>
            {entry.meta.glyph} {entry.label}
          </button>
        ))}
      </div>
    )}

    {activeHasTerrain ? <>
      <section className="condition-detail-section" aria-label="Local terrain offsets">
        <div className="section-title-row">
          <h4>Local terrain offsets{entries.length > 1 ? ` · Site ${activeEntry.label}` : ''}</h4>
          <button type="button" className="btn-link-sm" onClick={() => onChangeOffset(activeIndex, 0, 0)}>Center (0, 0)</button>
        </div>
        <label className="field-block">
          <span>East–West offset: {activeEntry.analysis.terrain.dxM.toFixed(0)} m</span>
          <input type="range" aria-label="East-West dx offset" min={-1} max={1} step={0.1} value={activeEntry.slot.offsetXNorm} onChange={(event) => onChangeOffset(activeIndex, Number(event.target.value), activeEntry.slot.offsetYNorm)} />
        </label>
        <label className="field-block">
          <span>North–South offset: {activeEntry.analysis.terrain.dyM.toFixed(0)} m</span>
          <input type="range" aria-label="North-South dy offset" min={-1} max={1} step={0.1} value={activeEntry.slot.offsetYNorm} onChange={(event) => onChangeOffset(activeIndex, activeEntry.slot.offsetXNorm, Number(event.target.value))} />
        </label>
      </section>
      <section className="condition-detail-section" aria-label="Solar energy and relay assumptions">
        <h4>Solar energy &amp; relay assumptions</h4>
        <p className="condition-source-note">
          Estimated solar generation, before storage and system losses. Panel efficiency: {(config.panelEfficiency * 100).toFixed(0)}%.
          {' '}Relay visibility uses a modelled constellation, not an operating service or a checked radio link.
        </p>
        <label className="toggle-control">
          <input type="checkbox" checked={config.relayEnabled} onChange={(event) => onChangeConfig({ ...config, relayEnabled: event.target.checked })} />
          <span>Include modelled ELFO relays</span>
        </label>
        <label className="field-block">
          <span>Solar panel geometry</span>
          <select aria-label="Solar panel geometry" value={config.panelMode} onChange={(event) => onChangeConfig({ ...config, panelMode: event.target.value as PanelMode })}>
            <option value="tracking">Vertical azimuth tracking</option>
            <option value="fixed_north">Fixed vertical (North-facing)</option>
            <option value="fixed_horiz">Fixed horizontal (top-mounted)</option>
          </select>
        </label>
        <label className="field-block">
          <span>Solar panel area: {config.panelAreaM2.toFixed(1)} m²</span>
          <input type="range" aria-label="Solar panel area" min={1} max={20} step={0.5} value={config.panelAreaM2} onChange={(event) => onChangeConfig({ ...config, panelAreaM2: Number(event.target.value) })} />
        </label>
      </section>
    </> : <p className="condition-source-note">Local terrain offsets, solar energy and relays are not assessed for this point.</p>}

    <section className="condition-detail-section" aria-label="Sources and checks">
      <h4>Sources &amp; checks</h4>
      {activeHasTerrain ? <>
        <p className="condition-source-note">
          Terrain model: {provenance.dem_product.product_id} ({provenance.dem_product.resolution_m} m/pixel,{' '}
          {(provenance.dem_product.ray_max_distance_m / 1000).toFixed(0)} km horizon search). Body positions:{' '}
          {provenance.ephemeris.engine} in {provenance.ephemeris.frame} ({provenance.ephemeris.correction}).
        </p>
        <p className="condition-source-note">
          Archived JPL Horizons comparison ({provenance.horizons_validation.status}): maximum Sun elevation difference{' '}
          {validationError(provenance.horizons_validation.max_sun_el_diff_deg)}; Earth{' '}
          {validationError(provenance.horizons_validation.max_earth_el_diff_deg)}.
          {' '}The archived comparison covers 16 epochs at one location. It does not validate all sites, terrain, energy estimates or radio links.
        </p>
        <ul className="condition-source-notes">
          {[...new Set([...provenance.horizons_validation.notes, ...provenance.limitations])].map((note) => <li key={note}>{note}</li>)}
        </ul>
      </> : <p className="condition-source-note">The terrain dataset and its archived validation do not apply to this point.</p>}
    </section>

    <section className="condition-detail-section" aria-label="Glossary">
      <h4>Terms</h4>
      <dl className="condition-terms">
        {GLOSSARY_ITEMS.filter((item) => activeHasTerrain || !['clps_slope', 'local_horizon'].includes(item.id)).map((item) => (
          <div key={item.id}>
            <dt>{item.id === 'clps_slope' ? `Terrain slope (configured limit < ${clpsLimit}°)` : item.term}</dt>
            <dd>{item.id === 'clps_slope'
              ? 'A terrain-model estimate compared with a configured limit; it does not certify landing safety.'
              : item.shortDesc}</dd>
          </div>
        ))}
      </dl>
    </section>
  </>;

  return (
    <aside className="side-drawer drawer-right condition-panel" aria-label="Site conditions and model details">
      <div className="drawer-header">
        <h2>Conditions</h2>
        {onOpenCharts && <button type="button" id="overtime-trigger" className="btn-link-sm" aria-expanded="false" onClick={onOpenCharts}>Over time</button>}
        <button type="button" className="btn-close-panel" onClick={onClose} aria-label="Close conditions panel">Close</button>
      </div>
      <div className="drawer-scroll">
        <ConditionReadout siteName={activeEntry.site.name} readout={activeReadout} assumptionsSummary={assumptionsSummary} details={advancedDetails} />
        {scenarioActions}
        <details className="condition-details condition-period">
          <summary>Over a period</summary>
          <div className="condition-detail-content">
            {singleInstant && <p className="condition-table-note">One instant is selected. A duration, accumulated sunlight and solar energy are not evaluated.</p>}
            {hasMissingMetrics && <p className="condition-table-note">— Not calculated for chosen points: terrain, energy and relay coverage. Their Sun and Earth reading describes the selected instant only.</p>}
            <p className="condition-table-note">
              Sun fraction is averaged across sampled instants; Earth percentages are shares of samples meeting the visibility criterion.
              {' '}Sampled shadow and visibility-gap spans are not exact event durations or radio outages;
              a span touching a period boundary may continue outside it.
              {' '}Sunlit hours and estimated solar energy interpolate between saved samples.
            </p>
            <div className="accessible-table-wrap">
              <table className="data-table">
                <caption>
                  {periodLabel}. {singleInstant ? 'One instant, no period totals' : `${slice.totalHours} h elapsed`}.
                  {' '}{entries.map((entry) => `${entries.length > 1 ? `${entry.label}: ` : ''}${entry.site.name}`).join(', ')}
                </caption>
                <thead><tr><th scope="col">Metric</th>{entries.map((entry) => <th key={entry.label} scope="col">{entries.length > 1 ? `${entry.meta.glyph} ${entry.label}` : 'Selected site'}</th>)}</tr></thead>
                <tbody>
                  <tr><th scope="row">Average visible Sun fraction</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.meanIllumFraction * 100, 1, '%')}</td>)}</tr>
                  <tr><th scope="row">Sunlit hours</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.sunlitHours, 0, ' h')}</td>)}</tr>
                  <tr><th scope="row">Longest sampled shadow span</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.maxContinuousShadowHours, 1, ' h')}</td>)}</tr>
                  <tr><th scope="row">Earth-visible samples</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.dteDutyCyclePct, 1, '%')}</td>)}</tr>
                  <tr><th scope="row">Earth or modelled relay samples</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.combinedDutyCyclePct, 1, '%')}</td>)}</tr>
                  <tr><th scope="row">Longest sampled visibility-gap span</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.maxBlackoutCombinedHours, 1, ' h')}</td>)}</tr>
                  <tr><th scope="row">Slope (limit &lt; {clpsLimit}°)</th>{entries.map((entry, index) => <td key={entry.label}>{!singleInstant && hasTerrain(index) && Number.isFinite(entry.analysis.terrain.slopeDeg) ? `${entry.analysis.terrain.slopeDeg.toFixed(1)}° (${entry.analysis.terrain.slopeDeg < clpsLimit ? '<' : '≥'}${clpsLimit}°)` : '—'}</td>)}</tr>
                  <tr><th scope="row">Estimated solar energy ({config.panelAreaM2.toFixed(1)} m²)</th>{entries.map((entry, index) => <td key={entry.label}>{metric(index, entry.metrics.energyCycleWh / 1000, 1, ' kWh')}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </div>
    </aside>
  );
};
