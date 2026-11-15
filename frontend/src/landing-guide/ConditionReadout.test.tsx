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
    periodStartUtc: dataset.mission_window.timestamps_utc[slice.startIdx],
    periodEndUtc: dataset.mission_window.timestamps_utc[slice.endIdx],
    onChangeOffset: vi.fn(), onChangeConfig: vi.fn(), onClose: vi.fn(),
  };
}

function openDetails(name: string): void {
  fireEvent.click(screen.getByText(name).closest('summary')!);
}

describe('minimal condition reading', () => {
  it('keeps site, UTC, energy and communication meanings visible; hides raw angles until requested', () => {
    const { container } = render(<ConditionReadout siteName="Ridge A" readout={reading} />);
    expect(screen.getByText('Ridge A')).toBeVisible();
    expect(screen.getByText('2026-11-15 00:00 UTC')).toHaveAttribute('dateTime', reading.timestamp);
    expect(within(screen.getByRole('region', { name: 'Sun reading' })).getByText(reading.energyNote)).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Earth reading' })).getByText(reading.communicationNote)).toBeVisible();
    expect(screen.getByText(reading.basis)).toBeVisible();
    expect(screen.getByText(reading.earth.detail)).not.toBeVisible();
    expect(screen.getByText('Sun center: +1.0°')).not.toBeVisible();
    expect(container.querySelectorAll('.plain-card')).toHaveLength(0);
    openDetails('Angles, assumptions and sources');
    expect(screen.getByText(reading.earth.detail)).toBeVisible();
    expect(screen.getByText('Sun center: +1.0°')).toBeVisible();
    expect(screen.getByText(reading.modelNote)).toBeVisible();
  });

  it('keeps unsupported terrain visible for approximate geometry without a technical disclosure', () => {
    const { rerender } = render(<ConditionReadout siteName="Ridge A" readout={reading} />);
    rerender(<ConditionReadout siteName="Chosen point" readout={{ ...reading, kind: 'geometric', timestamp: '2026-11-16T03:00:00Z', basis: 'Approximate geometry · geometric horizon', sun: { label: 'Sun center above horizon', detail: 'Sun center is above a smooth horizon.', angle: null } }} />);
    expect(screen.getByText('2026-11-16 03:00 UTC')).toBeVisible();
    expect(screen.getByText('Approximate geometry · geometric horizon')).toBeVisible();
    expect(screen.getByText(/Approximate directions only; local terrain, energy and relay availability are not assessed/)).toBeVisible();
    expect(screen.queryByText('Sun center: +1.0°')).not.toBeInTheDocument();
    expect(screen.queryByText('Ridge A')).not.toBeInTheDocument();
  });

  it('does not invent a model, conditions or date when the reading is unavailable', () => {
    render(<ConditionReadout siteName="Selected point" />);
    expect(screen.getByText('Time not available')).toBeVisible();
    expect(screen.getByText('Data unavailable')).toBeVisible();
    expect(screen.getByText('Sun and Earth conditions are not available for this selection.')).toBeVisible();
  });
});

describe('Conditions hierarchy and capability boundary', () => {
  it('has two native disclosures, accurate period endpoints and no first-line glossary/report', () => {
    const props = drawerProps();
    const { container } = render(<DataDrawer {...props} scenarioActions={<button type="button">Scenario action survives</button>} />);
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Scenario action survives' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close conditions panel' })).toBeVisible();
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Glossary' })).not.toBeInTheDocument();
    expect(container.querySelector('table')).not.toBeVisible();
    expect(screen.queryByText('legacy now must not appear')).not.toBeInTheDocument();
    openDetails('Over a period');
    expect(screen.getByRole('table').querySelector('caption')).toHaveTextContent('2026-11-15 00:00 UTC to 2026-11-16 00:00 UTC. 24 h elapsed');
    expect(screen.getByText(/Earth percentages are shares of samples/)).toBeVisible();
    expect(screen.getByText(/a span touching a period boundary may continue outside it/)).toBeVisible();
  });

  it('keeps geometry selectable while suppressing synthetic terrain, energy, offsets and validation', () => {
    const props = drawerProps();
    const chosenEntry = { ...terrainEntry, site: { ...terrainEntry.site, name: 'Chosen point', center: { ...terrainEntry.site.center, latitude_deg: 45, longitude_east_deg: 90 } } };
    render(<DataDrawer {...props} entries={[chosenEntry]} readouts={[{ ...reading, kind: 'geometric' }]} />);
    openDetails('Over a period');
    for (const cell of screen.getAllByRole('cell')) expect(cell).toHaveTextContent(/^—$/);
    expect(screen.getAllByRole('cell')).toHaveLength(8);
    openDetails('Angles, assumptions and sources');
    expect(screen.getByText(/45\.000°, 90\.000° E \(approximate model\)/)).toBeVisible();
    expect(screen.queryByRole('slider', { name: 'East-West dx offset' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Solar panel geometry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/m\/pixel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/maximum Sun elevation difference/)).not.toBeInTheDocument();
  });

  it('summarizes active assumptions, preserves controls and uses the configured slope limit', () => {
    const props = drawerProps();
    const entry = { ...terrainEntry, analysis: { ...analysis, terrain: { ...analysis.terrain, slopeDeg: 22 } } };
    const provenance = { ...dataset.provenance, conventions: { ...dataset.provenance.conventions, clps_slope_limit_deg: 20 }, horizons_validation: { ...dataset.provenance.horizons_validation, max_sun_el_diff_deg: null, max_earth_el_diff_deg: null } };
    render(<DataDrawer {...props} entries={[entry]} provenance={provenance} config={{ ...DEFAULT_CONFIG, panelAreaM2: 6.5, panelMode: 'fixed_horiz', relayEnabled: false }} />);
    expect(screen.getByText('6.5 m² · fixed horizontal · modelled relays off')).toBeVisible();
    openDetails('Angles, assumptions and sources');
    fireEvent.change(screen.getByRole('slider', { name: 'East-West dx offset' }), { target: { value: '0.3' } });
    expect(props.onChangeOffset).toHaveBeenCalledWith(0, 0.3, 0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Solar panel geometry' }), { target: { value: 'fixed_north' } });
    expect(props.onChangeConfig).toHaveBeenCalledWith(expect.objectContaining({ panelMode: 'fixed_north' }));
    expect(screen.getByText(/maximum Sun elevation difference not available; Earth not available/)).toBeVisible();
    expect(screen.getByText(/16 epochs at one location/)).toBeVisible();
    openDetails('Over a period');
    expect(screen.getByText('22.0° (≥20°)')).toBeVisible();
    expect(screen.queryByText(/0\.00002/)).not.toBeInTheDocument();
  });

  it('gates every comparison column independently without borrowing another site’s reading', () => {
    const props = drawerProps();
    const second = { ...terrainEntry, label: 'B' as const, meta: SLOT_META.B };
    render(<DataDrawer {...props} entries={[terrainEntry, second]} readouts={[reading]} activeSlotIdx={1} />);
    openDetails('Over a period');
    for (const row of screen.getAllByRole('row').slice(1)) {
      const cells = within(row).getAllByRole('cell');
      expect(cells[0]).not.toHaveTextContent(/^—$/);
      expect(cells[1]).toHaveTextContent(/^—$/);
    }
    expect(screen.getByText('Sun and Earth conditions are not available for this selection.')).toBeVisible();
    expect(screen.queryByText(reading.sun.detail)).not.toBeInTheDocument();
  });

  it('never presents one instant as accumulated duration, sunlight or energy, including stale nonzero metrics', () => {
    const props = drawerProps();
    const lastIdx = dataset.mission_window.timestamps_utc.length - 1;
    const timestamp = dataset.mission_window.timestamps_utc[lastIdx];
    render(<DataDrawer {...props} slice={{ ...slice, startIdx: lastIdx, endIdx: lastIdx, epochCount: 1, totalHours: 1 }} periodStartUtc={timestamp} periodEndUtc={timestamp} />);
    openDetails('Over a period');
    expect(screen.getByText('One instant is selected. A duration, accumulated sunlight and solar energy are not evaluated.')).toBeVisible();
    expect(screen.getByRole('table').querySelector('caption')).toHaveTextContent('One instant, no period totals');
    for (const cell of screen.getAllByRole('cell')) expect(cell).toHaveTextContent(/^—$/);
    expect(screen.getAllByRole('cell')).toHaveLength(8);
    expect(screen.queryByText(/1 h elapsed/)).not.toBeInTheDocument();
  });
});
