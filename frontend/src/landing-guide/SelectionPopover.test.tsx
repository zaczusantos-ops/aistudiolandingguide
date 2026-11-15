import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { createGeometrySite } from '../explorer/geometry';
import type { LandingSiteEntry } from '../navigator/types';
import { createCustomLandingSite } from './customSiteBuilder';
import { buildLunarAtlasData } from './lunarTerrainEngine';
import { SelectionPopover } from './SelectionPopover';
import { EvaluatedSlotEntry, SLOT_META, SlotLabel } from './state';

const dataset = parseNavigatorDataset(rawDataset);
const sites = dataset.sites;

function entry(site = sites[0], label: SlotLabel = 'A'): EvaluatedSlotEntry {
  return {
    label,
    meta: SLOT_META[label],
    site,
    slot: { siteId: site.id, offsetXNorm: 0, offsetYNorm: 0 },
    // Choosing a point must not depend on inferred lighting/engineering cards.
    get analysis() { throw new Error('Selection must not read an analysis'); },
    get metrics() { throw new Error('Selection must not read metrics'); },
  } as unknown as EvaluatedSlotEntry;
}

function props(entries = [entry()], activeSlotIdx = 0) {
  return {
    sites,
    entries,
    activeSlotIdx,
    selectionMode: 'cursor' as const,
    reticleCoords: { latDeg: 0, lonEastDeg: 0 },
    coverageNotice: null,
    onChangeSelectionMode: vi.fn(),
    onSelectActiveSlot: vi.fn(),
    onAssignSiteAt: vi.fn(),
    onPickCustomCoords: vi.fn(),
    onAddSlot: vi.fn(),
    onRemoveSlot: vi.fn(),
    onSwapFirstTwo: vi.fn(),
    onFixReticleToActive: vi.fn(),
    onCompareWithPsr: vi.fn(),
    onKeepOnlyOne: vi.fn(),
    onClose: vi.fn(),
  };
}

function openCoordinates() {
  const summary = screen.getByText('Enter coordinates', { selector: 'summary' });
  fireEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
  return {
    latitude: screen.getByRole('spinbutton', { name: 'Latitude (degrees)' }),
    longitude: screen.getByRole('spinbutton', { name: 'Longitude east (degrees)' }),
    submit: screen.getByRole('button', { name: 'Use coordinates' }),
  };
}

afterEach(cleanup);

describe('minimal place selection', () => {
  it('uses one complete named-site select, without comparison chrome or duplicate site controls', () => {
    const handlers = props();
    render(<SelectionPopover {...handlers} />);
    const dialog = screen.getByRole('dialog', { name: 'Choose a place' });
    const select = within(dialog).getByRole('combobox', { name: 'Named sites' });
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(1);
    expect(within(select).getAllByRole('option')).toHaveLength(10);
    expect(select).toHaveFocus();
    expect(within(dialog).queryByRole('group', { name: 'Places to compare' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('searchbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    // jsdom does not implement a closed details element's native descendant
    // visibility. Check its semantic closed state, rather than that emulation.
    expect(screen.getByText('Enter coordinates', { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
    expect(dialog).not.toHaveTextContent(/1 to 4|Active points|Unvisited|Sunlit Ridges|Click Anywhere|Center Reticle|Swap|Mean sun/);
    expect(screen.getAllByRole('button', { name: 'Compare places' })).toHaveLength(1);

    fireEvent.change(select, { target: { value: 'malapert_massif' } });
    expect(handlers.onAssignSiteAt).toHaveBeenCalledExactlyOnceWith(0, 'malapert_massif');
    expect(handlers.onChangeSelectionMode).not.toHaveBeenCalled();
  });

  it('includes only the active free point beside the ten named choices', () => {
    const customA: LandingSiteEntry = { ...sites[0], id: 'free-a', name: 'Custom point 12, 34' };
    const customB: LandingSiteEntry = { ...sites[0], id: 'free-b', name: 'Custom point 56, 78' };
    render(<SelectionPopover {...props([entry(customA, 'A'), entry(customB, 'B')], 1)} />);
    const select = screen.getByRole('combobox', { name: 'Named sites' });
    expect(select).toHaveValue('free-b');
    expect(within(select).getAllByRole('option')).toHaveLength(11);
    expect(within(select).getByRole('option', { name: customB.name })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: customA.name })).not.toBeInTheDocument();
  });

  it('associates coordinate errors, focuses the invalid field, and never submits blank or out-of-range values', () => {
    const handlers = props();
    render(<SelectionPopover {...handlers} />);
    const { latitude, longitude, submit } = openCoordinates();
    fireEvent.change(latitude, { target: { value: '' } });
    fireEvent.click(submit);
    expect(handlers.onPickCustomCoords).not.toHaveBeenCalled();
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent('Enter a latitude from -90 to 90 degrees.');
    expect(latitude).toHaveAttribute('aria-invalid', 'true');
    expect(latitude).toHaveAttribute('aria-describedby', expect.stringContaining(error.id));
    expect(latitude).toHaveFocus();

    fireEvent.change(latitude, { target: { value: '91' } });
    fireEvent.click(submit);
    expect(handlers.onPickCustomCoords).not.toHaveBeenCalled();

    fireEvent.change(latitude, { target: { value: '-83.4' } });
    fireEvent.change(longitude, { target: { value: '361' } });
    fireEvent.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an east longitude from -360 to 360 degrees.');
    expect(longitude).toHaveAttribute('aria-invalid', 'true');
    expect(longitude).toHaveFocus();
    expect(handlers.onPickCustomCoords).not.toHaveBeenCalled();

    fireEvent.change(longitude, { target: { value: '-12.5' } });
    fireEvent.click(submit);
    expect(handlers.onPickCustomCoords).toHaveBeenCalledExactlyOnceWith(-83.4, -12.5, 0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(longitude).not.toHaveAttribute('aria-invalid');
  });

  it('accepts both poles and exercises the existing geometry/scaffold boundary without a crash', () => {
    // This is a boundary compatibility check, not validation of visual terrain
    // or its engineering fields. The orbital reading uses the geometry result.
    const atlas = buildLunarAtlasData(sites, 32, 16);
    const handlers = props();
    const onPick = vi.fn((latitude: number, longitude: number) => {
      const geometry = createGeometrySite(dataset, latitude, longitude);
      expect(geometry.center.latitude_deg).toBe(latitude);
      expect(Number.isFinite(geometry.sky_series.sun_el_deg[0])).toBe(true);
      expect(() => createCustomLandingSite({
        latDeg: latitude,
        lonEastDeg: longitude,
        atlas,
        referenceSites: sites,
        horizonAzDeg: dataset.horizon_azimuths_deg,
        missionWindow: dataset.mission_window,
      })).not.toThrow();
    });
    render(<SelectionPopover {...handlers} onPickCustomCoords={onPick} />);
    const { latitude, longitude, submit } = openCoordinates();
    for (const pole of [-90, 90]) {
      fireEvent.change(latitude, { target: { value: String(pole) } });
      fireEvent.change(longitude, { target: { value: '-360' } });
      fireEvent.click(submit);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
    expect(onPick).toHaveBeenNthCalledWith(1, -90, -360, 0);
    expect(onPick).toHaveBeenNthCalledWith(2, 90, -360, 0);
  });

  it('reveals comparison actions only after adding a place and routes changes to the active slot', () => {
    const handlers = props();
    const { rerender } = render(<SelectionPopover {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare places' }));
    expect(handlers.onAddSlot).toHaveBeenCalledOnce();

    const compared = [entry(sites[0], 'A'), entry(sites[1], 'B')];
    rerender(<SelectionPopover {...handlers} entries={compared} activeSlotIdx={1} />);
    const group = screen.getByRole('group', { name: 'Places to compare' });
    expect(within(group).getByRole('button', { name: `Edit place B: ${sites[1].name}` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Compare places' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add place' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Named sites' }), { target: { value: 'malapert_massif' } });
    expect(handlers.onAssignSiteAt).toHaveBeenCalledExactlyOnceWith(1, 'malapert_massif');
    fireEvent.click(within(group).getByRole('button', { name: `Edit place A: ${sites[0].name}` }));
    expect(handlers.onSelectActiveSlot).toHaveBeenCalledExactlyOnceWith(0);
    fireEvent.click(within(group).getByRole('button', { name: `Remove place B: ${sites[1].name}` }));
    expect(handlers.onRemoveSlot).toHaveBeenCalledExactlyOnceWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep only this place' }));
    expect(handlers.onKeepOnlyOne).toHaveBeenCalledOnce();
    expect(handlers.onSwapFirstTwo).not.toHaveBeenCalled();
    expect(handlers.onCompareWithPsr).not.toHaveBeenCalled();
  });

  it('respects the four-place limit without exposing another add action', () => {
    const labels: SlotLabel[] = ['A', 'B', 'C', 'D'];
    render(<SelectionPopover {...props(labels.map((label, index) => entry(sites[index], label)), 3)} />);
    expect(screen.getAllByRole('button', { name: /^Remove place/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Add place' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare places' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep only this place' })).toBeInTheDocument();
  });

  it('keeps a draft across playback rerenders and never applies it to another selected point', () => {
    const handlers = props([entry(sites[0], 'A'), entry(sites[1], 'B')]);
    const { rerender } = render(<SelectionPopover {...handlers} />);
    const { latitude, longitude, submit } = openCoordinates();
    fireEvent.change(latitude, { target: { value: '12.5' } });
    fireEvent.change(longitude, { target: { value: '123' } });
    rerender(<SelectionPopover {...handlers} entries={[entry(sites[0], 'A'), entry(sites[1], 'B')]} />);
    expect(latitude).toHaveValue(12.5);
    expect(longitude).toHaveValue(123);

    rerender(<SelectionPopover {...handlers} activeSlotIdx={1} />);
    expect(latitude).toHaveValue(sites[1].center.latitude_deg);
    expect(longitude).toHaveValue(sites[1].center.longitude_east_deg);
    fireEvent.click(submit);
    expect(handlers.onPickCustomCoords).toHaveBeenCalledExactlyOnceWith(
      sites[1].center.latitude_deg, sites[1].center.longitude_east_deg, 1,
    );
  });

  it('supports Escape and Close and restores focus to the opening control', () => {
    const onClose = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Places</button>
        {open && <SelectionPopover {...props()} onClose={() => { onClose(); setOpen(false); }} />}
      </>;
    }
    render(<React.StrictMode><Harness /></React.StrictMode>);
    const opener = screen.getByRole('button', { name: 'Places' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('combobox', { name: 'Named sites' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Named sites' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    openCoordinates();
    fireEvent.click(screen.getByRole('button', { name: 'Close site selection' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
