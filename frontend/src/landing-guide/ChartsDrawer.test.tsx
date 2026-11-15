import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import datasetJson from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from '../navigator/math';
import { EngineeringConfig } from '../navigator/types';
import { ChartsDrawer } from './ChartsDrawer';
import {
  computeWindowSlice,
  EvaluatedSlotEntry,
  evaluateWindowMetrics,
  SLOT_META,
  SlotLabel,
} from './state';

const dataset = parseNavigatorDataset(datasetJson);
const slice = computeWindowSlice(dataset.mission_window.timestamps_utc, 0, 1);
const terrainSiteIds = dataset.sites.map((site) => site.id);

function namedEntry(
  siteIndex: number,
  label: SlotLabel,
  config: EngineeringConfig = DEFAULT_CONFIG,
): EvaluatedSlotEntry {
  const site = dataset.sites[siteIndex];
  const analysis = evaluateLiveSite(
    site, 0, 0, dataset.horizon_azimuths_deg, dataset.mission_window, config,
  );
  return {
    label,
    meta: SLOT_META[label],
    site,
    slot: { siteId: site.id, offsetXNorm: 0, offsetYNorm: 0 },
    analysis,
    metrics: evaluateWindowMetrics(analysis, dataset.mission_window, config, slice),
  };
}

// A free point deliberately has no terrain/engineering payload: filtering must happen
// before either chart calculations or a table can touch those fields.
function freePoint(label: SlotLabel = 'A'): EvaluatedSlotEntry {
  return {
    label,
    site: { id: 'free-point', name: 'Uncataloged point' },
    get analysis() { throw new Error('Free-point terrain must not be consumed'); },
    get metrics() { throw new Error('Free-point metrics must not be consumed'); },
  } as unknown as EvaluatedSlotEntry;
}

function show(
  entries: EvaluatedSlotEntry[],
  activeSlotIdx = 0,
  config: EngineeringConfig = DEFAULT_CONFIG,
) {
  const onClose = vi.fn();
  const onSelectEpoch = vi.fn();
  const result = render(
    <ChartsDrawer
      entries={entries}
      terrainSiteIds={terrainSiteIds}
      activeSlotIdx={activeSlotIdx}
      horizonAzDeg={dataset.horizon_azimuths_deg}
      missionWindow={dataset.mission_window}
      slice={slice}
      epochIdx={0}
      config={config}
      onSelectEpoch={onSelectEpoch}
      onClose={onClose}
    />,
  );
  return { ...result, onClose, onSelectEpoch };
}

afterEach(cleanup);

describe('cataloged-terrain charts', () => {
  it('omits a free point before reading its terrain and keeps the named site usable in the table', () => {
    const named = namedEntry(0, 'B');
    show([freePoint(), named]);

    expect(screen.getByText(/Free points are omitted/)).toHaveTextContent(/See Data/);
    expect(screen.queryByText('Uncataloged point')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Visible solar disk fraction/ })).toHaveAccessibleName(
      `Visible solar disk fraction for ${named.site.name}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'B: Visible Sun disk (%)' })).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^A:/ })).not.toBeInTheDocument();
    expect(within(table).getByText('2026-11-15 00:00 UTC')).toBeInTheDocument();
    expect(within(table).getAllByText('100%').length).toBeGreaterThan(0);
    expect(table).not.toHaveTextContent(/Blackout|ELFO Relay|DTE \(Earth\)/);
  });

  it('shows a closeable explanation, with no charts, table or invented numbers, when only free points exist', () => {
    const { container, onClose } = show([freePoint()]);

    expect(screen.getByRole('heading', { name: 'Charts' })).toBeInTheDocument();
    expect(screen.getByText(/These charts need a cataloged terrain horizon/)).toHaveTextContent(/approximate geometry/);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View table' })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent(/\d|%|W\/m|Blackout/);
    fireEvent.click(screen.getByRole('button', { name: 'Close charts panel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('remaps an active named slot by both site and label after a free point is filtered out', () => {
    // The same catalog site in B and C must preserve C, rather than find the first ID match.
    const namedB = namedEntry(0, 'B');
    const namedC = namedEntry(0, 'C');
    show([freePoint(), namedB, namedC], 2);

    expect(screen.getByRole('heading', { name: '3. Sky & 360° Horizon (C)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '3. Sky & 360° Horizon (B)' })).not.toBeInTheDocument();
  });

  it('falls back to the first named slot when the active point is free or the active index is invalid', () => {
    const namedB = namedEntry(1, 'B');
    const namedC = namedEntry(0, 'C');
    const { rerender } = show([freePoint(), namedB, namedC]);
    expect(screen.getByRole('heading', { name: '3. Sky & 360° Horizon (B)' })).toBeInTheDocument();

    rerender(<ChartsDrawer
      entries={[freePoint(), namedB, namedC]}
      terrainSiteIds={terrainSiteIds}
      activeSlotIdx={20}
      horizonAzDeg={dataset.horizon_azimuths_deg}
      missionWindow={dataset.mission_window}
      slice={slice}
      epochIdx={0}
      config={DEFAULT_CONFIG}
      onSelectEpoch={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(screen.getByRole('heading', { name: '3. Sky & 360° Horizon (B)' })).toBeInTheDocument();
  });

  it('keeps UTC table navigation and close controls functional, with model criteria instead of radio guarantees', () => {
    const config = { ...DEFAULT_CONFIG, relayEnabled: false, dteMarginMode: 'center' as const };
    const { onSelectEpoch, onClose } = show([namedEntry(0, 'A', config)], 0, config);
    expect(screen.getByText('Earth center clears terrain')).toBeInTheDocument();
    expect(screen.getByText(/markers show centers/)).toBeInTheDocument();
    expect(screen.queryByText(/Assumed relay mask/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View table' }));
    expect(screen.getByRole('button', { name: 'View charts' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('columnheader', { name: 'A: Modelled visibility state' })).toBeInTheDocument();
    expect(screen.getAllByText('Earth criterion not met').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to epoch 2026-11-15 01:00 UTC' }));
    expect(onSelectEpoch).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'View charts' }));
    expect(screen.getByRole('button', { name: 'View table' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Close charts panel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can switch between free-only and terrain views without consuming stale free-point results', () => {
    const { rerender } = show([freePoint()]);
    const named = namedEntry(0, 'B');
    const props = {
      terrainSiteIds,
      activeSlotIdx: 0,
      horizonAzDeg: dataset.horizon_azimuths_deg,
      missionWindow: dataset.mission_window,
      slice,
      epochIdx: 0,
      config: DEFAULT_CONFIG,
      onSelectEpoch: vi.fn(),
      onClose: vi.fn(),
    };
    rerender(<ChartsDrawer {...props} entries={[named]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View table' }));
    expect(screen.getByRole('table')).toBeInTheDocument();

    rerender(<ChartsDrawer {...props} entries={[freePoint()]} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(<ChartsDrawer {...props} entries={[named]} />);
    expect(screen.getByRole('button', { name: 'View table' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img', { name: /Visible solar disk fraction/ })).toBeInTheDocument();
  });
});
