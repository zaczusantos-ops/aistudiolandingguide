import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { formatElevation } from './geometry';
import { App } from '../App';

interface MockViewportProps {
  selectionEnabled?: boolean;
  onOutsidePolarCoverage: (latitude: number, longitude: number, slot: number) => void;
}

// Deliberately exercise the application without a working GPU. Renderer and
// browser behavior need their own checks; this mock only proves that the native
// location/time path and text results do not depend on an available 3D view.
vi.mock('../landing-guide/LunarViewport', () => ({
  LunarViewport: ({ selectionEnabled = true, onOutsidePolarCoverage }: MockViewportProps) => (
    <div role="region" aria-label="Unavailable Moon view">
      <p role="status">3D view unavailable. Choose a location from the list to keep exploring.</p>
      {selectionEnabled && (
        <button type="button" onClick={() => onOutsidePolarCoverage(0, 180, 0)}>
          Pick far-side point
        </button>
      )}
    </div>
  ),
}));

const dataset = parseNavigatorDataset(rawDataset);

afterEach(() => {
  cleanup();
});

function renderGuide() {
  render(<App dataset={dataset} />);
}

function currentScenario() {
  return screen.getByRole('region', { name: 'Current scenario' });
}

function pairedConditions() {
  return screen.getByRole('region', { name: 'Sun and Earth conditions' });
}

function goToDate() {
  fireEvent.click(screen.getByRole('button', { name: /^Continue to date & time$/i }));
}

function applyTime(date: string, hour: string) {
  fireEvent.change(screen.getByLabelText('Date (UTC)'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Hour (UTC)'), { target: { value: hour } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this time' }));
}

describe('minimal guided lunar exploration', () => {
  it('starts with an accessible location path and textual conditions when 3D is unavailable', async () => {
    renderGuide();

    expect(screen.getByRole('heading', { level: 1, name: 'Choose a point.' })).toBeInTheDocument();
    const skipLink = screen.getByRole('link', { name: 'Skip to controls' });
    const destination = skipLink.getAttribute('href');
    expect(destination).toMatch(/^#.+/);
    expect(document.getElementById(destination!.slice(1))).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Location' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Location' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Date & time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sunlight & energy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Earth & communication' })).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Unavailable Moon view' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Location' }), {
      target: { value: dataset.sites[1].id },
    });
    expect(currentScenario()).toHaveTextContent('Malapert Massif');
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[1].sky_series.sun_el_deg[0]));
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[1].sky_series.earth_el_deg[0]));
    expect(screen.queryByRole('button', { name: 'Astronaut' })).not.toBeInTheDocument();
  });

  it('retains a selected location and committed UTC time while revisiting the guide', () => {
    renderGuide();
    fireEvent.change(screen.getByRole('combobox', { name: 'Location' }), {
      target: { value: dataset.sites[1].id },
    });
    goToDate();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    applyTime('2026-11-15', '6');
    expect(currentScenario()).toHaveTextContent(/15 Nov 2026.*06:00 UTC/);

    fireEvent.click(screen.getByRole('button', { name: /^Continue to sunlight & energy$/i }));
    expect(screen.getByRole('button', { name: 'Sunlight & energy' })).toHaveAttribute('aria-current', 'step');
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[1].sky_series.sun_el_deg[6]));
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[1].sky_series.earth_el_deg[6]));

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-15');
    expect(screen.getByLabelText('Hour (UTC)')).toHaveValue(6);
    fireEvent.click(screen.getByRole('button', { name: 'Location' }));
    expect(screen.getByRole('combobox', { name: 'Location' })).toHaveValue(dataset.sites[1].id);
    expect(currentScenario()).toHaveTextContent(/15 Nov 2026.*06:00 UTC/);
  });

  it('rejects an unsupported final-day hour without changing the last valid scenario', () => {
    renderGuide();
    goToDate();
    applyTime('2026-12-15', '0');
    expect(currentScenario()).toHaveTextContent(/15 Dec 2026.*00:00 UTC/);
    const previousConditions = pairedConditions().textContent;

    applyTime('2026-12-15', '1');
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent(/15 Dec|2026-12-15|available|supported|window/i);
    const dateField = screen.getByLabelText('Date (UTC)');
    expect(dateField).toHaveAttribute('aria-invalid', 'true');
    const descriptionIds = dateField.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    expect(descriptionIds.some(id => document.getElementById(id)?.textContent?.includes(error.textContent ?? ''))).toBe(true);
    expect(currentScenario()).toHaveTextContent(/15 Dec 2026.*00:00 UTC/);
    expect(pairedConditions().textContent).toBe(previousConditions);

    applyTime('2026-12-14', '23');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(currentScenario()).toHaveTextContent(/14 Dec 2026.*23:00 UTC/);
  });

  it('validates and commits the time draft when continuing to the energy explanation', () => {
    renderGuide();
    goToDate();
    const previousContext = currentScenario().textContent;
    const previousConditions = pairedConditions().textContent;
    fireEvent.change(screen.getByLabelText('Date (UTC)'), { target: { value: '2026-12-15' } });
    fireEvent.change(screen.getByLabelText('Hour (UTC)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Continue to sunlight & energy$/i }));

    expect(screen.getByRole('button', { name: 'Date & time' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(currentScenario().textContent).toBe(previousContext);
    expect(pairedConditions().textContent).toBe(previousConditions);

    fireEvent.change(screen.getByLabelText('Date (UTC)'), { target: { value: '2026-11-16' } });
    fireEvent.change(screen.getByLabelText('Hour (UTC)'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /^Continue to sunlight & energy$/i }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sunlight & energy' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(currentScenario()).toHaveTextContent(/16 Nov 2026.*06:00 UTC/);
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[0].sky_series.sun_el_deg[30]));
    expect(pairedConditions()).toHaveTextContent(formatElevation(dataset.sites[0].sky_series.earth_el_deg[30]));
  });

  it('supports precise coordinates without a globe gesture and identifies the approximation', () => {
    renderGuide();
    const originalContext = currentScenario().textContent;
    fireEvent.click(screen.getByText('Enter coordinates', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Latitude (degrees)'), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these coordinates' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/latitude.*90/i);
    expect(currentScenario().textContent).toBe(originalContext);
    fireEvent.change(screen.getByLabelText('Latitude (degrees)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Longitude east (degrees)'), { target: { value: '180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these coordinates' }));

    expect(currentScenario()).toHaveTextContent(/Approximate geometry/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(currentScenario()).toHaveTextContent(/180/);
    expect(pairedConditions()).toHaveTextContent(/Earth center/i);
    expect(pairedConditions()).toHaveTextContent(/below/i);
    expect(screen.queryByText(/^Relay active$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Landing score$/i)).not.toBeInTheDocument();
  });

  it('uses the same approximate path for a surface pick and keeps that point through interpretation', async () => {
    renderGuide();
    fireEvent.click(await screen.findByRole('button', { name: 'Pick far-side point' }));
    expect(currentScenario()).toHaveTextContent(/Approximate geometry/i);
    const selectedContext = currentScenario().textContent;

    fireEvent.click(screen.getByRole('button', { name: 'Sunlight & energy' }));
    expect(currentScenario().textContent).toBe(selectedContext);
    expect(screen.queryByRole('button', { name: 'Pick far-side point' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/terrain.*not|not.*terrain/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Earth & communication' }));
    expect(currentScenario().textContent).toBe(selectedContext);
    expect(screen.getAllByText(/does not guarantee|not guarantee|not calculated/i).length).toBeGreaterThan(0);
  });

  it('offers an optional second scenario without overwriting the original', async () => {
    renderGuide();
    expect(screen.queryByRole('button', { name: 'Compare another site or date' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Location' }), {
      target: { value: dataset.sites[1].id },
    });
    const originalContext = currentScenario().textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Earth & communication' }));
    const launch = screen.getByRole('button', { name: 'Compare another site or date' });
    fireEvent.click(launch);
    expect(currentScenario().textContent).toBe(originalContext);
    expect(screen.getByRole('button', { name: 'Remove comparison' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove comparison' }));
    expect(currentScenario().textContent).toBe(originalContext);
    expect(screen.queryByRole('button', { name: 'Remove comparison' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Compare another site or date' })).toHaveFocus());
  });

  it('keeps comparison edits independent and shows the selected scenario consistently', () => {
    renderGuide();
    fireEvent.change(screen.getByRole('combobox', { name: 'Location' }), {
      target: { value: dataset.sites[1].id },
    });
    goToDate();
    applyTime('2026-11-15', '6');
    const originalContext = currentScenario().textContent;
    const originalConditions = pairedConditions().textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Earth & communication' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare another site or date' }));

    const comparison = screen.getByRole('region', { name: 'Optional comparison' });
    fireEvent.change(within(comparison).getByRole('combobox', { name: 'Comparison location' }), {
      target: { value: dataset.sites[0].id },
    });
    fireEvent.change(within(comparison).getByLabelText('Comparison date (UTC)'), { target: { value: '2026-11-16' } });
    fireEvent.change(within(comparison).getByLabelText('Comparison hour (UTC)'), { target: { value: '0' } });
    fireEvent.click(within(comparison).getByRole('button', { name: 'Use comparison time' }));

    expect(currentScenario().textContent).toBe(originalContext);
    expect(pairedConditions().textContent).toBe(originalConditions);
    const secondConditions = within(comparison).getByRole('region', { name: 'Comparison Sun and Earth conditions' });
    expect(secondConditions).toHaveTextContent(formatElevation(dataset.sites[0].sky_series.sun_el_deg[24]));
    expect(secondConditions).toHaveTextContent(formatElevation(dataset.sites[0].sky_series.earth_el_deg[24]));
    expect(comparison).toHaveTextContent('Different points and times; either change can affect the angles.');

    fireEvent.click(within(comparison).getByRole('button', { name: 'Show B on Moon' }));
    expect(currentScenario()).toHaveTextContent(dataset.sites[0].name);
    expect(currentScenario()).toHaveTextContent(/16 Nov 2026.*00:00 UTC/);
    expect(pairedConditions().textContent).toBe(secondConditions.textContent);
    expect(within(comparison).getByRole('button', { name: 'Show B on Moon' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(comparison).getByRole('region', { name: 'Scenario A Sun and Earth conditions' }).textContent).toBe(originalConditions);

    fireEvent.click(within(comparison).getByRole('button', { name: 'Remove comparison' }));
    expect(currentScenario().textContent).toBe(originalContext);
    expect(pairedConditions().textContent).toBe(originalConditions);
  });

  it('does not carry an uncommitted time draft into another scenario with the same committed time', () => {
    renderGuide();
    fireEvent.click(screen.getByRole('button', { name: 'Earth & communication' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare another site or date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Date & time' }));
    const committedConditions = pairedConditions().textContent;

    fireEvent.change(screen.getByLabelText('Date (UTC)'), { target: { value: '2026-11-17' } });
    fireEvent.change(screen.getByLabelText('Hour (UTC)'), { target: { value: '12' } });
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-17');
    expect(screen.getByLabelText('Hour (UTC)')).toHaveValue(12);
    expect(currentScenario()).toHaveTextContent(/15 Nov 2026.*00:00 UTC/);

    const comparison = screen.getByRole('region', { name: 'Optional comparison' });
    fireEvent.click(within(comparison).getByRole('button', { name: 'Show B on Moon' }));
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-15');
    expect(screen.getByLabelText('Hour (UTC)')).toHaveValue(0);
    expect(currentScenario()).toHaveTextContent(/15 Nov 2026.*00:00 UTC/);
    expect(pairedConditions().textContent).toBe(committedConditions);

    fireEvent.click(within(comparison).getByRole('button', { name: 'Show A on Moon' }));
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-15');
    expect(screen.getByLabelText('Hour (UTC)')).toHaveValue(0);
    expect(pairedConditions().textContent).toBe(committedConditions);
  });
});
