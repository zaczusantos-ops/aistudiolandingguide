import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from './data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from './contract';
import { LegacyApp } from './LegacyApp';
import { decodeScenarioUrl, encodeScenarioUrl, ScenarioUrlState } from './explorer/scenarioUrl';
import { DEFAULT_CONFIG } from './navigator/math';

const dataset = parseNavigatorDataset(rawDataset);
const initialUrl = window.location.href;
const base = `${window.location.origin}/`;

function scenario(overrides: Partial<ScenarioUrlState> = {}): ScenarioUrlState {
  return {
    site: { kind: 'named', siteId: 'shackleton_ridge' },
    epochIdx: 0, startIdx: 0, durationDays: 30, offsetXNorm: 0, offsetYNorm: 0,
    config: { ...DEFAULT_CONFIG, weights: { ...DEFAULT_CONFIG.weights } },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', initialUrl);
  vi.restoreAllMocks();
});

describe('Shared scenarios and next matching samples', () => {
  it('restores the site, current UTC, window and engineering assumptions together', () => {
    const state = scenario({
      epochIdx: 168, startIdx: 48, durationDays: 7, offsetXNorm: 0.4, offsetYNorm: -0.2,
      config: { ...DEFAULT_CONFIG, panelAreaM2: 9.5, panelMode: 'fixed_horiz', relayEnabled: false },
    });
    window.history.replaceState({}, '', encodeScenarioUrl(base, state, dataset));
    render(<LegacyApp dataset={dataset} />);
    expect(screen.getByRole('complementary', { name: /Site metrics/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Earth reading' })).toBeInTheDocument();
    expect(screen.getByText('7d window')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Assumptions & sources/ }));
    expect(screen.getByLabelText('East-West dx offset')).toHaveValue('0.4');
    expect(screen.getByLabelText('North-South dy offset')).toHaveValue('-0.2');
    expect(screen.getByLabelText('Solar panel area')).toHaveValue('9.5');
    expect(screen.getByLabelText('Solar panel geometry')).toHaveValue('fixed_horiz');
    expect(screen.getByRole('checkbox', { name: /Include modelled ELFO/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    expect(screen.getByLabelText('Start date (UTC)')).toHaveValue('2026-11-17');
    expect(screen.getByLabelText('UTC epoch timeline')).toHaveValue('168');
  });

  it('finds a strictly later sample beyond a one-day analysis window without changing duration', () => {
    window.history.replaceState({}, '', encodeScenarioUrl(base, scenario({ durationDays: 1 }), dataset));
    render(<LegacyApp dataset={dataset} />);
    fireEvent.click(screen.getByRole('button', { name: /Find next sample/ }));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/Next matching sample:.*2026-11-18.*15:00/);
    expect(screen.getByText('1d window')).toBeInTheDocument();
    expect(screen.getByText('Whole Earth in view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    expect(screen.getByLabelText('Start date (UTC)')).toHaveValue('2026-11-18');
    expect(screen.getByLabelText('Start hour (0–23 UTC)')).toHaveValue(15);
    expect(screen.getByLabelText('UTC epoch timeline')).toHaveValue('87');
    fireEvent.click(screen.getByRole('button', { name: /Close time controls/ }));
    fireEvent.click(screen.getByRole('button', { name: /Find next sample/ }));
    expect(screen.getByText(/Next matching sample:.*2026-11-18.*16:00/)).toBeInTheDocument();
  });

  it('does not wrap from the final sample to the beginning', () => {
    window.history.replaceState({}, '', encodeScenarioUrl(base, scenario({ epochIdx: 720, startIdx: 720, durationDays: 1 }), dataset));
    render(<LegacyApp dataset={dataset} />);
    fireEvent.click(screen.getByRole('button', { name: /Find next sample/ }));
    expect(screen.getByText('No later samples remain in this dataset.')).toBeInTheDocument();
  });

  it('copies only the active scenario and restores a free point without terrain claims', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.history.replaceState({}, '', encodeScenarioUrl(base, scenario(), dataset));
    const view = render(<LegacyApp dataset={dataset} />);
    fireEvent.click(screen.getByRole('button', { name: /Sites \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add comparison site/ }));
    fireEvent.click(screen.getByRole('button', { name: /Tycho Crater/ }));
    fireEvent.click(screen.getByRole('button', { name: /Close site selection/ }));
    fireEvent.click(screen.getByRole('button', { name: /Share this scenario/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0][0] as string;
    const parsed = decodeScenarioUrl(new URL(url).search, dataset);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') throw new Error('Expected a valid scenario');
    expect(parsed.scenario.site.kind).toBe('coordinates');
    if (parsed.scenario.site.kind !== 'coordinates') throw new Error('Expected coordinates');
    expect(parsed.scenario.site.latDeg).toBeCloseTo(-43.3, 9);
    expect(parsed.scenario.site.lonEastDeg).toBeCloseTo(348.8, 9);
    view.unmount();
    window.history.replaceState({}, '', url);
    render(<LegacyApp dataset={dataset} />);
    expect(screen.getByRole('button', { name: /Sites \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText('Approximate geometry · geometric horizon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find next sample/ })).not.toBeInTheDocument();
    const row = screen.getByRole('row', { name: /^Mean sunlight/ });
    expect(row).toHaveTextContent('—');
  });

  it('reports an invalid shared scenario instead of silently moving its UTC', () => {
    window.history.replaceState({}, '', `${base}?lunarScenario=%7B%7D`);
    render(<LegacyApp dataset={dataset} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not open shared scenario');
    expect(screen.getByRole('heading', { name: /Landing\s*Guide/ })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: /Site metrics/ })).not.toBeInTheDocument();
  });

  it('hides a shared link when the analysis window changes', async () => {
    window.history.replaceState({}, '', encodeScenarioUrl(base, scenario(), dataset));
    render(<LegacyApp dataset={dataset} />);
    fireEvent.click(screen.getByRole('button', { name: /Share this scenario/ }));
    await waitFor(() => expect(screen.getByLabelText('Scenario link')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.queryByLabelText('Scenario link')).not.toBeInTheDocument();
  });
});
