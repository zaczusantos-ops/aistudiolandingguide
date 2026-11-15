import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from '../navigator/math';
import { ConditionReadout } from './ConditionReadout';
import { DataDrawer } from './DataDrawer';
import { computeWindowSlice, evaluateWindowMetrics, SLOT_META, type EvaluatedSlotEntry } from './state';
import type { SiteReadout } from './siteReadings';

afterEach(cleanup);

const dataset = parseNavigatorDataset(rawDataset);
const slice = computeWindowSlice(dataset.mission_window.timestamps_utc, 0, 1);
const analysis = evaluateLiveSite(dataset.sites[0], 0, 0, dataset.horizon_azimuths_deg, dataset.mission_window, DEFAULT_CONFIG);
const terrainEntry: EvaluatedSlotEntry = {
  label: 'A', meta: SLOT_META.A,
  slot: { siteId: dataset.sites[0].id, offsetXNorm: 0, offsetYNorm: 0 },
  site: dataset.sites[0], analysis,
  metrics: evaluateWindowMetrics(analysis, dataset.mission_window, DEFAULT_CONFIG, slice),
};

const reading: SiteReadout = {
  kind: 'terrain', timestamp: '2026-11-15T00:00:00Z',
  sun: { label: 'Some sunlight', detail: 'The terrain hides part of the Sun.', angle: 'Sun center: +1.0°' },
  earth: { label: 'Earth hidden', detail: 'The terrain blocks the view of Earth.', angle: 'Earth center: +2.0°' },
  basis: 'Calculated against the local terrain horizon.',
  energyNote: 'Sunlight can support solar generation; output depends on the panel assumptions.',
  communicationNote: 'A visible Earth direction does not guarantee a radio link.',
  modelNote: 'The display texture is not the terrain calculation.',
};

function drawerProps() {
  return {
    entries: [terrainEntry], readouts: [reading], activeSlotIdx: 0,
    onSelectActiveSlot: vi.fn(),
    summary: { whereText: 'legacy summary must not appear', nowText: 'legacy now must not appear', periodText: 'legacy period must not appear', limitationNote: 'legacy limit must not appear' },
    slice, config: DEFAULT_CONFIG, provenance: dataset.provenance,
    onChangeOffset: vi.fn(), onChangeConfig: vi.fn(), onClose: vi.fn(),
  };
}

describe('minimal condition reading', () => {
  it('uses the selected site, UTC timestamp and model wording without rewriting the result', () => {
    const { container, rerender } = render(<ConditionReadout siteName="Ridge A" readout={reading} />);
    expect(screen.getByText('Ridge A')).toBeInTheDocument();
    expect(screen.getByText('2026-11-15 00:00 UTC')).toHaveAttribute('dateTime', reading.timestamp);
    expect(within(screen.getByRole('region', { name: 'Earth reading' })).getByText(reading.earth.detail)).toBeInTheDocument();
    expect(screen.getByText('Why does this matter?').tagName).toBe('SUMMARY');
    expect(container.querySelectorAll('.plain-card')).toHaveLength(0);

    rerender(<ConditionReadout siteName="Chosen point" readout={{ ...reading, kind: 'geometric', timestamp: '2026-11-16T03:00:00Z', sun: { label: 'Above the horizon', detail: 'Sun center is above a smooth horizon.', angle: null } }} />);
    expect(screen.getByText('2026-11-16 03:00 UTC')).toBeInTheDocument();
    expect(screen.queryByText('Sun center: +1.0°')).not.toBeInTheDocument();
    expect(screen.queryByText('Ridge A')).not.toBeInTheDocument();
  });

  it('does not invent conditions or a date when the reading is unavailable', () => {
    render(<ConditionReadout siteName="Selected point" />);
    expect(screen.getByText('Time not available')).toBeInTheDocument();
    expect(screen.getByText('Sun and Earth conditions are not available for this selection.')).toBeInTheDocument();
    expect(screen.queryByText('Why does this matter?')).not.toBeInTheDocument();
  });
});

describe('DataDrawer capability boundary', () => {
  it('keeps geometry selectable while hiding synthetic terrain, energy, offsets and validation', () => {
    const props = drawerProps();
    const chosenEntry = {
      ...terrainEntry,
      site: { ...terrainEntry.site, name: 'Chosen point', center: { ...terrainEntry.site.center, latitude_deg: 45, longitude_east_deg: 90 } },
    };
    render(<DataDrawer {...props} entries={[chosenEntry]} readouts={[{ ...reading, kind: 'geometric' }]} />);
    expect(screen.getAllByRole('cell')).toHaveLength(8);
    for (const cell of screen.getAllByRole('cell')) expect(cell).toHaveTextContent(/^—$/);
    expect(screen.queryByText('legacy now must not appear')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources/ }));
    expect(screen.getByText(/45\.000°, 90\.000° E \(approximate model\)/)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'East-West dx offset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Solar panel geometry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/m\/pixel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/maximum Sun elevation difference/)).not.toBeInTheDocument();
  });

  it('uses the configured slope threshold and never fills missing validation errors', () => {
    const props = drawerProps();
    const entry = { ...terrainEntry, analysis: { ...analysis, terrain: { ...analysis.terrain, slopeDeg: 22 } } };
    const provenance = {
      ...dataset.provenance,
      conventions: { ...dataset.provenance.conventions, clps_slope_limit_deg: 20 },
      horizons_validation: { ...dataset.provenance.horizons_validation, max_sun_el_diff_deg: null, max_earth_el_diff_deg: null },
    };
    render(<DataDrawer {...props} entries={[entry]} provenance={provenance} />);
    expect(screen.getByText('22.0° (≥20°)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources/ }));
    expect(screen.getByRole('slider', { name: 'East-West dx offset' })).toBeInTheDocument();
    expect(screen.getByText(/maximum Sun elevation difference not available; Earth not available/)).toBeInTheDocument();
    expect(screen.getByText(/16 epochs at one location/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.00002/)).not.toBeInTheDocument();
  });

  it('gates every comparison column independently without borrowing another site’s reading', () => {
    const props = drawerProps();
    const second = { ...terrainEntry, label: 'B' as const, meta: SLOT_META.B };
    render(<DataDrawer {...props} entries={[terrainEntry, second]} readouts={[reading]} activeSlotIdx={1} />);
    for (const row of screen.getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell');
      expect(cells[0]).not.toHaveTextContent(/^—$/);
      expect(cells[1]).toHaveTextContent(/^—$/);
    }
    expect(screen.getByText('Sun and Earth conditions are not available for this selection.')).toBeInTheDocument();
    expect(screen.queryByText(reading.sun.detail)).not.toBeInTheDocument();
  });
});
