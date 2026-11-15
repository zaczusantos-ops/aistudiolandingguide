import React, { useMemo, useState } from 'react';
import { LiveSiteAnalysis } from '../navigator/math';
import { EngineeringConfig, MissionWindow } from '../navigator/types';
import { EvaluatedSlotEntry, formatUtcShort, WindowSlice } from './state';

interface ChartsDrawerProps {
  entries: EvaluatedSlotEntry[];
  terrainSiteIds: readonly string[];
  activeSlotIdx: number;
  horizonAzDeg: number[];
  missionWindow: MissionWindow;
  slice: WindowSlice;
  epochIdx: number;
  config: EngineeringConfig;
  onSelectEpoch: (idx: number) => void;
  onClose: () => void;
}

function toPlotY(elDeg: number, yMin: number, yMax: number, top: number, h: number): number {
  const clamped = Math.max(yMin, Math.min(yMax, elDeg));
  const frac = (clamped - yMin) / (yMax - yMin);
  return top + h * (1 - frac);
}

interface LinkSegment {
  start: number;
  end: number;
  kind: 'dte' | 'elfo' | 'blackout';
}

function buildCommsSegments(
  analysis: LiveSiteAnalysis,
  startIdx: number,
  endIdx: number,
  relayEnabled: boolean,
): LinkSegment[] {
  const segments: LinkSegment[] = [];
  const kindAt = (i: number): 'dte' | 'elfo' | 'blackout' => {
    const ep = analysis.epochStates[i];
    if (ep.dteVisible) return 'dte';
    if (relayEnabled && ep.elfoConstellationVisible) return 'elfo';
    return 'blackout';
  };
  let curKind = kindAt(startIdx);
  let segStart = startIdx;
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const k = kindAt(i);
    if (k !== curKind) {
      segments.push({ start: segStart, end: i - 1, kind: curKind });
      curKind = k;
      segStart = i;
    }
  }
  segments.push({ start: segStart, end: endIdx, kind: curKind });
  return segments;
}

export const ChartsDrawer: React.FC<ChartsDrawerProps> = (props) => {
  const { entries, terrainSiteIds, activeSlotIdx, onClose } = props;
  const terrainIds = new Set(terrainSiteIds);
  const terrainEntries = entries.filter((entry) => terrainIds.has(entry.site.id));
  const activeEntry = entries[activeSlotIdx];
  const filteredActiveIdx = terrainEntries.findIndex(
    (entry) => entry.site.id === activeEntry?.site.id && entry.label === activeEntry?.label,
  );
  const excludedFreePoints = terrainEntries.length !== entries.length;

  if (terrainEntries.length === 0) {
    return (
      <aside className="side-drawer drawer-left" aria-label="Comparison charts drawer">
        <div className="drawer-header">
          <div><h2>Charts</h2></div>
          <div className="drawer-head-actions">
            <button type="button" className="btn-close-panel" onClick={onClose} aria-label="Close charts panel">
              Close
            </button>
          </div>
        </div>
        <div className="drawer-scroll">
          <p>These charts need a cataloged terrain horizon. See Data for this point's approximate geometry.</p>
        </div>
      </aside>
    );
  }

  return (
    <TerrainCharts
      {...props}
      entries={terrainEntries}
      activeSlotIdx={Math.max(0, filteredActiveIdx)}
      excludedFreePoints={excludedFreePoints}
    />
  );
};

const TerrainCharts: React.FC<ChartsDrawerProps & { excludedFreePoints: boolean }> = ({
  entries,
  activeSlotIdx,
  horizonAzDeg,
  missionWindow,
  slice,
  epochIdx,
  config,
  onSelectEpoch,
  onClose,
  excludedFreePoints,
}) => {
  const [tableMode, setTableMode] = useState(false);

  const primaryEntry = entries[activeSlotIdx] ?? entries[0];
  const w = 380;
  const left = 36;
  const right = 12;
  const plotW = w - left - right;
  const span = Math.max(1, slice.endIdx - slice.startIdx);
  const idxToX = (i: number) => left + ((i - slice.startIdx) / span) * plotW;

  const hSolar = 130;
  const solarTop = 14;
  const solarH = 88;

  const solarSeriesPoints = useMemo(() => {
    return entries.map((entry) => {
      const pts: string[] = [];
      for (let i = slice.startIdx; i <= slice.endIdx; i++) {
        const f = entry.analysis.epochStates[i].fIllum;
        pts.push(`${idxToX(i).toFixed(1)},${(solarTop + solarH * (1 - f)).toFixed(1)}`);
      }
      return { entry, points: pts.join(' ') };
    });
  }, [entries, slice.startIdx, slice.endIdx]);

  const commsTimelineRows = useMemo(() => {
    return entries.map((entry) => ({
      entry,
      segments: buildCommsSegments(entry.analysis, slice.startIdx, slice.endIdx, config.relayEnabled),
    }));
  }, [entries, slice.startIdx, slice.endIdx, config.relayEnabled]);

  const commsSvgHeight = 20 + entries.length * 28;

  const hSky = 148;
  const skyTop = 14;
  const skyH = 104;
  const allHorizonVals = entries.flatMap((e) => e.analysis.terrain.horizonElevDeg);
  const hMin = Math.min(
    ...allHorizonVals,
    primaryEntry.site.sky_series.sun_el_deg[epochIdx],
    primaryEntry.site.sky_series.earth_el_deg[epochIdx],
  );
  const hMax = Math.max(
    ...allHorizonVals,
    primaryEntry.site.sky_series.sun_el_deg[epochIdx],
    primaryEntry.site.sky_series.earth_el_deg[epochIdx],
    14,
  );
  const yMin = Math.floor(Math.min(-6, hMin - 2));
  const yMax = Math.ceil(Math.max(20, Math.min(85, hMax + 4)));
  const azToX = (az: number) => left + ((((az % 360) + 360) % 360) / 360) * plotW;

  const terrainLines = entries.map((entry) => {
    const hArr = entry.analysis.terrain.horizonElevDeg;
    const line = horizonAzDeg
      .map(
        (az, i) =>
          `${azToX(az).toFixed(1)},${toPlotY(hArr[i], yMin, yMax, skyTop, skyH).toFixed(1)}`,
      )
      .join(' ');
    return { entry, line };
  });

  const primaryHorizonLine = terrainLines[activeSlotIdx]?.line ?? terrainLines[0]?.line ?? '';
  const primaryTerrainPoly = `${left},${skyTop + skyH} ${primaryHorizonLine} ${left + plotW},${skyTop + skyH}`;
  const primaryHorizon = primaryEntry.analysis.terrain.horizonElevDeg;
  const maskLinePrimary = horizonAzDeg
    .map(
      (az, i) =>
        `${azToX(az).toFixed(1)},${toPlotY(primaryHorizon[i] + config.antennaMaskDeg, yMin, yMax, skyTop, skyH).toFixed(1)}`,
    )
    .join(' ');

  const sunSegments: string[] = [];
  let curSeg: string[] = [];
  for (let i = slice.startIdx; i <= slice.endIdx; i++) {
    const az = primaryEntry.site.sky_series.sun_az_deg[i];
    const el = primaryEntry.site.sky_series.sun_el_deg[i];
    if (i > slice.startIdx && Math.abs(az - primaryEntry.site.sky_series.sun_az_deg[i - 1]) > 180) {
      if (curSeg.length > 1) sunSegments.push(`M ${curSeg.join(' L ')}`);
      curSeg = [];
    }
    curSeg.push(`${azToX(az).toFixed(1)},${toPlotY(el, yMin, yMax, skyTop, skyH).toFixed(1)}`);
  }
  if (curSeg.length > 1) sunSegments.push(`M ${curSeg.join(' L ')}`);

  const playheadX = idxToX(Math.max(slice.startIdx, Math.min(slice.endIdx, epochIdx)));

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const xSvg = ((e.clientX - rect.left) / rect.width) * w;
    const frac = Math.max(0, Math.min(1, (xSvg - left) / plotW));
    onSelectEpoch(Math.round(slice.startIdx + frac * span));
  };

  const tableRows = useMemo(() => {
    const step = slice.totalHours <= 72 ? 1 : slice.totalHours <= 168 ? 3 : 6;
    const indices = new Set<number>();
    for (let i = slice.startIdx; i <= slice.endIdx; i += step) {
      indices.add(i);
    }
    indices.add(slice.endIdx);
    if (epochIdx >= slice.startIdx && epochIdx <= slice.endIdx) {
      indices.add(epochIdx);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [slice.startIdx, slice.endIdx, slice.totalHours, epochIdx]);

  const linkLabel = (ep: LiveSiteAnalysis['epochStates'][number]) => {
    if (ep.dteVisible) return config.dteMarginMode === 'full_disk'
      ? 'Whole-Earth criterion met'
      : 'Earth-center criterion met';
    if (config.relayEnabled && ep.elfoConstellationVisible) return 'Relay model criterion met';
    return config.relayEnabled ? 'Neither criterion met' : 'Earth criterion not met';
  };

  const curSunX = azToX(primaryEntry.site.sky_series.sun_az_deg[epochIdx]);
  const curSunY = toPlotY(primaryEntry.site.sky_series.sun_el_deg[epochIdx], yMin, yMax, skyTop, skyH);
  const curEarthX = azToX(primaryEntry.site.sky_series.earth_az_deg[epochIdx]);
  const curEarthY = toPlotY(primaryEntry.site.sky_series.earth_el_deg[epochIdx], yMin, yMax, skyTop, skyH);
  const curElfoX = azToX(primaryEntry.site.sky_series.elfo_primary_az_deg[epochIdx]);
  const curElfoY = toPlotY(primaryEntry.site.sky_series.elfo_primary_el_deg[epochIdx], yMin, yMax, skyTop, skyH);

  return (
    <aside className="side-drawer drawer-left" aria-label="Comparison charts drawer">
      <div className="drawer-header">
        <div>
          <span className="drawer-eyebrow">Window ({slice.totalHours}h)</span>
          <h2>Charts</h2>
        </div>
        <div className="drawer-head-actions">
          <button
            type="button"
            className="btn-secondary-sm"
            aria-pressed={tableMode}
            onClick={() => setTableMode((v) => !v)}
          >
            {tableMode ? 'View charts' : 'View table'}
          </button>
          <button
            type="button"
            className="btn-close-panel"
            onClick={onClose}
            aria-label="Close charts panel"
          >
            Close
          </button>
        </div>
      </div>

      <div className="drawer-scroll">
        {excludedFreePoints && (
          <p className="muted-caption">
            Free points are omitted: these charts need a cataloged terrain horizon. See Data for approximate point geometry.
          </p>
        )}
        <div className="legend-strip" aria-label="Site line styles">
          {entries.map((entry) => (
            <span key={entry.label} className="legend-tag">
              {entry.meta.glyph} <strong>{entry.label}</strong> {entry.site.name} ({entry.meta.dashDesc})
            </span>
          ))}
        </div>

        {!tableMode ? (
          <div className="charts-stack">
            <section className="chart-card" aria-label="Visible solar disk fraction">
              <div className="chart-head">
                <h3>1. Visible Sun disk (%)</h3>
                <span className="chart-stat">
                  Mean{' '}
                  {entries
                    .map((e) => `${e.label}: ${(e.metrics.meanIllumFraction * 100).toFixed(1)}%`)
                    .join(' | ')}
                </span>
              </div>
              <svg
                viewBox={`0 0 ${w} ${hSolar}`}
                className="chart-svg"
                onClick={handleSvgClick}
                role="img"
                aria-label={`Visible solar disk fraction for ${entries.map((e) => e.site.name).join(', ')}`}
              >
                <rect x={left} y={solarTop} width={plotW} height={solarH} fill="#09090b" stroke="#27272a" />
                {[0, 0.5, 1].map((frac) => {
                  const y = solarTop + solarH * (1 - frac);
                  return (
                    <g key={frac}>
                      <line x1={left} y1={y} x2={left + plotW} y2={y} stroke="#27272a" strokeDasharray="3 3" />
                      <text x={left - 5} y={y + 3} textAnchor="end" className="svg-axis-label">
                        {Math.round(frac * 100)}%
                      </text>
                    </g>
                  );
                })}
                {solarSeriesPoints.map(({ entry, points }) => (
                  <polyline
                    key={entry.label}
                    points={points}
                    fill="none"
                    stroke={entry.meta.color}
                    strokeWidth={entry.label === primaryEntry.label ? 2.2 : 1.7}
                    strokeDasharray={entry.meta.dashArray}
                  />
                ))}
                <line x1={playheadX} y1={solarTop} x2={playheadX} y2={solarTop + solarH} stroke="#ffffff" strokeWidth={1.3} />
                <text x={left} y={solarTop + solarH + 15} className="svg-axis-label">
                  {formatUtcShort(missionWindow.timestamps_utc[slice.startIdx]).slice(5, 16)}
                </text>
                <text x={left + plotW} y={solarTop + solarH + 15} textAnchor="end" className="svg-axis-label">
                  +{slice.totalHours}h
                </text>
              </svg>
              <p className="muted-caption">Visible disk fraction, not panel efficiency or electrical output.</p>
            </section>

            <section className="chart-card" aria-label="Modelled visibility timeline">
              <div className="chart-head">
                <h3>2. Modelled visibility</h3>
                <span className="chart-stat">
                  {entries
                    .map(
                      (e) =>
                        `${e.label}: ${e.metrics.blackoutCountCombined} gaps (max ${e.metrics.maxBlackoutCombinedHours.toFixed(0)}h)`,
                    )
                    .join(' | ')}
                </span>
              </div>
              <svg
                viewBox={`0 0 ${w} ${commsSvgHeight}`}
                className="chart-svg"
                onClick={handleSvgClick}
                role="img"
                aria-label="Timeline of Earth criterion, relay model criterion, and unmet visibility criteria"
              >
                {commsTimelineRows.map(({ entry, segments }, rowIdx) => {
                  const yTop = 10 + rowIdx * 28;
                  return (
                    <g key={entry.label}>
                      <text x={4} y={yTop + 13} fill="#e4e4e7" fontSize={10} fontWeight={700}>
                        {entry.label}
                      </text>
                      <rect x={left} y={yTop} width={plotW} height={18} rx={2} fill="#18181b" />
                      {segments.map((seg, idx) => {
                        const x1 = idxToX(seg.start);
                        const x2 = idxToX(seg.end + 0.9);
                        const fill =
                          seg.kind === 'dte' ? '#ffffff' : seg.kind === 'elfo' ? '#71717a' : '#27272a';
                        return (
                          <rect
                            key={idx}
                            x={x1}
                            y={yTop}
                            width={Math.max(1.5, x2 - x1)}
                            height={18}
                            fill={fill}
                          />
                        );
                      })}
                    </g>
                  );
                })}

                <line
                  x1={playheadX}
                  y1={6}
                  x2={playheadX}
                  y2={commsSvgHeight - 4}
                  stroke="#a1a1aa"
                  strokeWidth={1.5}
                />
              </svg>
              <div className="comms-legend">
                <span><i className="swatch swatch-dte" /> {config.dteMarginMode === 'full_disk' ? 'Whole Earth clears terrain' : 'Earth center clears terrain'}</span>
                <span><i className="swatch swatch-elfo" /> {config.relayEnabled ? 'ELFO model criterion' : 'Relay model off'}</span>
                <span><i className="swatch swatch-blk" /> {config.relayEnabled ? 'Neither criterion met' : 'Earth criterion not met'}</span>
              </div>
              <p className="muted-caption">Visibility criteria, not a working radio link. Gaps are not service outages.</p>
            </section>

            <section className="chart-card" aria-label="360 degree sky and terrain horizon chart">
              <div className="chart-head">
                <h3>3. Sky &amp; 360° Horizon ({primaryEntry.label})</h3>
                <span className="chart-stat">
                  {config.relayEnabled ? `Assumed relay mask +${config.antennaMaskDeg.toFixed(0)}°` : 'Relay model off'}
                </span>
              </div>
              <svg
                viewBox={`0 0 ${w} ${hSky}`}
                className="chart-svg"
                role="img"
                aria-label={`360-degree terrain horizon for ${primaryEntry.site.name}, with schematic Sun and Earth center markers${config.relayEnabled ? ' and modelled ELFO position' : ''}`}
              >
                <rect x={left} y={skyTop} width={plotW} height={skyH} fill="#09090b" stroke="#27272a" />
                {[0, 10, 20].map((yv) => {
                  if (yv < yMin || yv > yMax) return null;
                  const y = toPlotY(yv, yMin, yMax, skyTop, skyH);
                  return (
                    <g key={yv}>
                      <line x1={left} y1={y} x2={left + plotW} y2={y} stroke="#27272a" strokeDasharray="3 3" />
                      <text x={left - 5} y={y + 3} textAnchor="end" className="svg-axis-label">
                        {yv}°
                      </text>
                    </g>
                  );
                })}
                {[0, 90, 180, 270, 360].map((az) => {
                  const x = left + (az / 360) * plotW;
                  return (
                    <text key={az} x={x} y={skyTop + skyH + 14} textAnchor="middle" className="svg-axis-label">
                      {az}°
                    </text>
                  );
                })}

                {sunSegments.map((d, i) => (
                  <path key={i} d={d} fill="none" stroke="rgba(255, 255, 255, 0.45)" strokeWidth={1.2} />
                ))}

                {primaryEntry.site.sky_series.earth_az_deg.map((az, i) =>
                  i >= slice.startIdx && i <= slice.endIdx && i % 4 === 0 ? (
                    <circle
                      key={i}
                      cx={azToX(az)}
                      cy={toPlotY(primaryEntry.site.sky_series.earth_el_deg[i], yMin, yMax, skyTop, skyH)}
                      r={1.0}
                      fill="rgba(212, 212, 216, 0.35)"
                    />
                  ) : null,
                )}

                <polygon points={primaryTerrainPoly} fill="rgba(63, 63, 70, 0.55)" />
                {terrainLines.map(({ entry, line }) => (
                  <polyline
                    key={entry.label}
                    points={line}
                    fill="none"
                    stroke={entry.meta.color}
                    strokeWidth={entry.label === primaryEntry.label ? 1.8 : 1.3}
                    strokeDasharray={entry.meta.dashArray}
                  />
                ))}

                {config.relayEnabled && (
                  <polyline
                    points={maskLinePrimary}
                    fill="none"
                    stroke="#71717a"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                )}

                <circle cx={curEarthX} cy={curEarthY} r={4.4} fill="#a1a1aa" stroke="#ffffff" strokeWidth={1} />
                <text
                  x={curEarthX}
                  y={Math.max(skyTop + 11, curEarthY - 9)}
                  textAnchor="middle"
                  className="svg-sky-earth"
                >
                  Earth
                </text>

                <circle cx={curSunX} cy={curSunY} r={4.6} fill="#ffffff" stroke="#000000" strokeWidth={1} />
                <text
                  x={curSunX}
                  y={Math.max(skyTop + 11, curSunY - 9)}
                  textAnchor="middle"
                  className="svg-sky-sun"
                >
                  Sun
                </text>

                {config.relayEnabled && primaryEntry.site.sky_series.elfo_primary_el_deg[epochIdx] >= yMin - 5 && (
                  <polygon
                    points={`${curElfoX},${curElfoY - 4.5} ${curElfoX + 4.5},${curElfoY} ${curElfoX},${curElfoY + 4.5} ${curElfoX - 4.5},${curElfoY}`}
                    fill="#d4d4d8"
                    stroke="#000000"
                    strokeWidth={1}
                  />
                )}
              </svg>
              <p className="muted-caption">Sun and Earth markers show centers; disk sizes are schematic.</p>
              {config.relayEnabled && <p className="muted-caption">The assumed relay mask is above terrain. It is not the terrain horizon or the Earth-view criterion.</p>}
            </section>
          </div>
        ) : (
          <div className="accessible-table-wrap">
            <table className="data-table">
              <caption>
                Sampled visible Sun disk and modelled visibility criteria across the selected window ({slice.totalHours}h)
              </caption>
              <thead>
                <tr>
                  <th scope="col">UTC Time</th>
                  {entries.map((e) => (
                    <React.Fragment key={e.label}>
                      <th scope="col">{e.label}: Visible Sun disk (%)</th>
                      <th scope="col">{e.label}: Modelled visibility state</th>
                    </React.Fragment>
                  ))}
                  <th scope="col">Jump</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((idx) => {
                  const isCurrent = idx === epochIdx;
                  return (
                    <tr key={idx} className={isCurrent ? 'row-active' : ''}>
                      <td>{formatUtcShort(missionWindow.timestamps_utc[idx])}</td>
                      {entries.map((e) => {
                        const ep = e.analysis.epochStates[idx];
                        return (
                          <React.Fragment key={e.label}>
                            <td>{(ep.fIllum * 100).toFixed(0)}%</td>
                            <td>{linkLabel(ep)}</td>
                          </React.Fragment>
                        );
                      })}
                      <td>
                        <button
                          type="button"
                          className="btn-table-jump"
                          onClick={() => onSelectEpoch(idx)}
                          aria-label={`Jump to epoch ${formatUtcShort(missionWindow.timestamps_utc[idx])}`}
                        >
                          {isCurrent ? 'Now' : 'Go'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </aside>
  );
};
