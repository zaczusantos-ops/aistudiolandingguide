import React, { useState } from 'react';
import { ConditionReadout } from './ConditionReadout';
import type { SiteReadout } from './siteReadings';
import {
  EngineeringConfig,
  NavigatorProvenance,
  PanelMode,
} from '../navigator/types';
import {
  EvaluatedSlotEntry,
  GLOSSARY_ITEMS,
  PlainLanguageSummary,
  WindowSlice,
} from './state';

interface DataDrawerProps {
  entries: EvaluatedSlotEntry[];
  readouts: SiteReadout[];
  activeSlotIdx: number;
  onSelectActiveSlot: (index: number) => void;
  summary: PlainLanguageSummary;
  slice: WindowSlice;
  config: EngineeringConfig;
  provenance: NavigatorProvenance;
  onChangeOffset: (slotIdx: number, xNorm: number, yNorm: number) => void;
  onChangeConfig: (next: EngineeringConfig) => void;
  scenarioActions?: React.ReactNode;
  onClose: () => void;
}

export const DataDrawer: React.FC<DataDrawerProps> = ({
  entries,
  readouts,
  activeSlotIdx,
  onSelectActiveSlot,
  slice,
  config,
  provenance,
  onChangeOffset,
  onChangeConfig,
  scenarioActions,
  onClose,
}) => {
  const [showGlossary, setShowGlossary] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const clpsLimit = provenance.conventions.clps_slope_limit_deg;
  const activeIndex = entries[activeSlotIdx] ? activeSlotIdx : 0;
  const activeEntry = entries[activeIndex];
  const activeReadout = readouts[activeIndex];
  const hasTerrain = (index: number) => readouts[index]?.kind === 'terrain';
  const activeHasTerrain = hasTerrain(activeIndex);
  const hasMissingMetrics = entries.some((_, index) => !hasTerrain(index));
  const metric = (index: number, value: number, decimals: number, unit: string) => (
    hasTerrain(index) && Number.isFinite(value) ? `${value.toFixed(decimals)}${unit}` : '—'
  );
  const validationError = (value: number | null | undefined) => (
    typeof value === 'number' && Number.isFinite(value) ? `${value}°` : 'not available'
  );

  if (!activeEntry) return null;

  return (
    <aside className="side-drawer drawer-right" aria-label="Site metrics and scientific provenance drawer">
      <div className="drawer-header">
        <div>
          <span className="drawer-eyebrow">Metrics &amp; Provenance</span>
          <h2>Data</h2>
        </div>
        <button
          type="button"
          className="btn-close-panel"
          onClick={onClose}
          aria-label="Close data panel"
        >
          Close
        </button>
      </div>

      <div className="drawer-scroll">
        <section className="data-section" aria-label="Plain language summary">
          <div className="section-title-row">
            <h3>1. Sun &amp; Earth</h3>
            <button
              type="button"
              className="btn-link-sm"
              aria-expanded={showGlossary}
              onClick={() => setShowGlossary((v) => !v)}
            >
              Glossary
            </button>
          </div>

          <ConditionReadout siteName={activeEntry.site.name} readout={activeReadout} />
          {scenarioActions}

          {showGlossary && (
            <div className="glossary-box" role="region" aria-label="Glossary of lunar concepts">
              <h4>Key Concepts</h4>
              <ul>
                {GLOSSARY_ITEMS.map((item) => (
                  <li key={item.id}>
                    <strong>{item.term}:</strong> {item.shortDesc}{' '}
                    <span className="muted-caption">{item.detailDesc}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="data-section" aria-label="Window metrics table">
          <h3>2. Window Metrics</h3>
          {hasMissingMetrics && (
            <p className="condition-table-note">
              — Not calculated for chosen points: terrain, energy and relay coverage.
              Their Sun and Earth reading describes the selected instant only.
            </p>
          )}
          <div className="accessible-table-wrap">
            <table className="data-table">
              <caption>
                Estimated over {slice.totalHours} h — {entries.map((e) => `${e.label}: ${e.site.name}`).join(', ')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {entries.map((e) => (
                    <th key={e.label} scope="col">
                      {e.meta.glyph} {e.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Mean sunlight</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.meanIllumFraction * 100, 1, '%')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Sunlit hours</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.sunlitHours, 0, ' h')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Longest shadow</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.maxContinuousShadowHours, 1, ' h')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Direct Earth visibility</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.dteDutyCyclePct, 1, '%')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Earth + modelled relay visibility</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.combinedDutyCyclePct, 1, '%')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Longest visibility gap</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.maxBlackoutCombinedHours, 1, ' h')}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Slope (limit &lt; {clpsLimit}°)</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>
                      {hasTerrain(idx) && Number.isFinite(e.analysis.terrain.slopeDeg)
                        ? `${e.analysis.terrain.slopeDeg.toFixed(1)}° (${e.analysis.terrain.slopeDeg < clpsLimit ? '<' : '≥'}${clpsLimit}°)`
                        : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Estimated solar energy ({config.panelAreaM2.toFixed(1)} m²)</th>
                  {entries.map((e, idx) => (
                    <td key={e.label}>{metric(idx, e.metrics.energyCycleWh / 1000, 1, ' kWh')}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="data-section" aria-label="Advanced options">
          <button
            type="button"
            className="btn-advanced-toggle"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <span>3. Assumptions &amp; sources</span>
            <span aria-hidden="true">{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <div className="advanced-body">
              <div className="adv-block">
                <h4>Coordinates</h4>
                {entries.map((e, idx) => (
                  <p key={e.label} className="condition-coordinate">
                    <strong>{e.label} ({e.site.name}):</strong>{' '}
                    {hasTerrain(idx) ? (
                      <>
                        {e.analysis.terrain.latitudeDeg.toFixed(3)}°,{' '}
                        {e.analysis.terrain.longitudeEastDeg.toFixed(3)}° E. Elevation{' '}
                        {e.analysis.terrain.elevationM.toFixed(0)} m. Permanently shadowed region:{' '}
                        {e.analysis.terrain.isPsr ? 'inside' : `${e.analysis.terrain.psrDistanceM.toFixed(0)} m away`}.
                      </>
                    ) : (
                      <>
                        {e.site.center.latitude_deg.toFixed(3)}°,{' '}
                        {e.site.center.longitude_east_deg.toFixed(3)}° E (approximate model).
                        {' '}Elevation and permanently shadowed regions are not calculated.
                      </>
                    )}
                  </p>
                ))}
              </div>

              <div className="adv-block">
                {entries.length > 1 && (
                  <div className="chip-row" role="group" aria-label="Select site for assumptions and sources">
                    {entries.map((e, idx) => (
                      <button
                        key={e.label}
                        type="button"
                        className={`btn-filter-chip ${idx === activeIndex ? 'active' : ''}`}
                        aria-pressed={idx === activeIndex}
                        onClick={() => onSelectActiveSlot(idx)}
                      >
                        {e.meta.glyph} {e.label}
                      </button>
                    ))}
                  </div>
                )}

                {activeHasTerrain ? <>
                <div className="section-title-row">
                  <h4>Local grid (Site {activeEntry.label})</h4>
                  <button
                    type="button"
                    className="btn-link-sm"
                    onClick={() => onChangeOffset(activeIndex, 0, 0)}
                  >
                    Center (0, 0)
                  </button>
                </div>
                <label className="field-block">
                  <span>East–West offset (dx): {activeEntry.analysis.terrain.dxM.toFixed(0)} m</span>
                  <input
                    type="range"
                    aria-label="East-West dx offset"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={activeEntry.slot.offsetXNorm}
                    onChange={(e) =>
                      onChangeOffset(activeIndex, Number(e.target.value), activeEntry.slot.offsetYNorm)
                    }
                  />
                </label>
                <label className="field-block">
                  <span>North–South offset (dy): {activeEntry.analysis.terrain.dyM.toFixed(0)} m</span>
                  <input
                    type="range"
                    aria-label="North-South dy offset"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={activeEntry.slot.offsetYNorm}
                    onChange={(e) =>
                      onChangeOffset(activeIndex, activeEntry.slot.offsetXNorm, Number(e.target.value))
                    }
                  />
                </label>
                </> : <p className="condition-source-note">Local terrain offsets are not calculated for this point.</p>}
              </div>

              {activeHasTerrain && (
              <div className="adv-block">
                <h4>Solar energy &amp; relay assumptions</h4>
                <p className="condition-source-note">
                  Estimated solar generation, before storage and system losses. Panel efficiency:{' '}
                  {(config.panelEfficiency * 100).toFixed(0)}%. Relay visibility uses a modelled constellation,
                  not an operating communication service or a checked radio link.
                </p>
                <label className="toggle-control">
                  <input
                    type="checkbox"
                    checked={config.relayEnabled}
                    onChange={(e) =>
                      onChangeConfig({ ...config, relayEnabled: e.target.checked })
                    }
                  />
                  <span>Include modelled ELFO relays</span>
                </label>

                <label className="field-block">
                  <span>Solar panel geometry</span>
                  <select
                    aria-label="Solar panel geometry"
                    value={config.panelMode}
                    onChange={(e) =>
                      onChangeConfig({ ...config, panelMode: e.target.value as PanelMode })
                    }
                  >
                    <option value="tracking">Vertical azimuth tracking</option>
                    <option value="fixed_north">Fixed vertical (North-facing)</option>
                    <option value="fixed_horiz">Fixed horizontal (top-mounted)</option>
                  </select>
                </label>

                <label className="field-block">
                  <span>Solar panel area: {config.panelAreaM2.toFixed(1)} m²</span>
                  <input
                    type="range"
                    aria-label="Solar panel area"
                    min={1}
                    max={20}
                    step={0.5}
                    value={config.panelAreaM2}
                    onChange={(e) =>
                      onChangeConfig({ ...config, panelAreaM2: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              )}

              <div className="adv-block">
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
                  {' '}The archived comparison covers 16 epochs at one location. It does not validate all sites,
                  terrain, energy estimates or radio links.
                </p>
                <details className="condition-source-details">
                  <summary>Dataset notes</summary>
                  <ul>
                    {[...new Set([...provenance.horizons_validation.notes, ...provenance.limitations])]
                      .map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </details>
                </> : <p className="condition-source-note">
                  {activeReadout?.modelNote ?? 'Model details are not available for this point.'}
                  {' '}The terrain dataset and its archived validation do not apply to this point.
                </p>}
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
