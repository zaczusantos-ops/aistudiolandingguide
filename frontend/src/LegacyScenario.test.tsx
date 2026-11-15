import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from './data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from './contract';
import { LegacyApp } from './LegacyApp';
import { decodeScenarioUrl, encodeScenarioUrl, ScenarioUrlState } from './explorer/scenarioUrl';
import { DEFAULT_CONFIG } from './navigator/math';

// These tests exercise the actual UI/state/science boundary. GPU presentation,
// picking and renderer lifecycles have their own tests and browser verification.
vi.mock('./landing-guide/OriginalLunarViewport', () => ({ OriginalLunarViewport: () => null }));
vi.mock('./landing-guide/AstronautViewport', () => ({ AstronautViewport: () => null }));

const dataset = parseNavigatorDataset(rawDataset);
const initialUrl = window.location.href;
const base = `${window.location.origin}/`;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

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
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

function openScenario(state = scenario()) {
  window.history.replaceState({}, '', encodeScenarioUrl(base, state, dataset));
  return render(<LegacyApp dataset={dataset} />);
}

function conditions() {
  return screen.getByRole('complementary', { name: 'Site conditions and model details' });
}

function openDisclosure(label: string) {
  const text = screen.getByText(label);
  const summary = text.tagName === 'SUMMARY' ? text : text.closest('summary');
  if (!summary) throw new Error(`Missing native disclosure: ${label}`);
  fireEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
}

function showConditions() {
  fireEvent.click(screen.getByRole('button', { name: 'Conditions' }));
  return conditions();
}

function useClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
}

async function copiedScenario(writeText: ReturnType<typeof useClipboard>) {
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const url = writeText.mock.calls[0][0] as string;
  const parsed = decodeScenarioUrl(new URL(url).search, dataset);
  if (parsed.status !== 'valid') throw new Error('Expected a valid shared scenario.');
  return { url, state: parsed.scenario };
}

describe('clean explorer scenario integration', () => {
  it('restores site, current UTC, period and engineering assumptions without confusing current time with period start', () => {
    const state = scenario({
      epochIdx: 168, startIdx: 48, durationDays: 7, offsetXNorm: 0.4, offsetYNorm: -0.2,
      config: { ...DEFAULT_CONFIG, panelAreaM2: 9.5, panelMode: 'fixed_horiz', relayEnabled: false },
    });
    openScenario(state);
    expect(within(conditions()).getByRole('region', { name: 'Earth reading' })).toBeInTheDocument();
    expect(within(conditions()).getByText('2026-11-22 00:00 UTC')).toHaveAttribute('dateTime', dataset.mission_window.timestamps_utc[168]);
    expect(screen.getByText('168h analysis period')).toBeInTheDocument();
    expect(screen.getByText('Angles, assumptions and sources').closest('details')).not.toHaveAttribute('open');
    openDisclosure('Angles, assumptions and sources');
    expect(screen.getByLabelText('East-West dx offset')).toHaveValue('0.4');
    expect(screen.getByLabelText('North-South dy offset')).toHaveValue('-0.2');
    expect(screen.getByLabelText('Solar panel area')).toHaveValue('9.5');
    expect(screen.getByLabelText('Solar panel geometry')).toHaveValue('fixed_horiz');
    expect(screen.getByRole('checkbox', { name: /Include modelled ELFO/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    expect(screen.queryByRole('complementary', { name: 'Site conditions and model details' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-22');
    expect(screen.getByLabelText('Hour (0–23 UTC)')).toHaveValue(0);
    expect(screen.getByRole('slider', { name: 'UTC sample timeline' })).toHaveValue('168');
    openDisclosure('Analysis period and playback');
    expect(screen.getByRole('combobox', { name: 'Analysis period duration' })).toHaveValue('7');
    expect(screen.getByText('2026-11-17 00:00:00 UTC')).toHaveAttribute('dateTime', dataset.mission_window.timestamps_utc[48]);
    expect(screen.getByText('2026-11-24 00:00:00 UTC')).toHaveAttribute('dateTime', dataset.mission_window.timestamps_utc[216]);
  });

  it('finds the later saved sample beyond a one-day period, preserves duration and then removes the unnecessary next action', () => {
    openScenario(scenario({ durationDays: 1 }));
    fireEvent.click(screen.getByRole('button', { name: /Find next sample/ }));
    expect(within(conditions()).getByRole('status')).toHaveTextContent(/Showing the next matching hourly sample:.*2026-11-18.*15:00/);
    expect(screen.getByText('24h analysis period')).toBeInTheDocument();
    expect(within(conditions()).getByText('Whole Earth in view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find next sample/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-18');
    expect(screen.getByLabelText('Hour (0–23 UTC)')).toHaveValue(15);
    expect(screen.getByRole('slider', { name: 'UTC sample timeline' })).toHaveValue('87');
    openDisclosure('Analysis period and playback');
    expect(screen.getByRole('combobox', { name: 'Analysis period duration' })).toHaveValue('1');
    expect(screen.getByText('2026-11-18 15:00:00 UTC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close time controls/ }));
    showConditions();
    expect(screen.queryByRole('button', { name: /Find next sample/ })).not.toBeInTheDocument();
    expect(within(conditions()).getByText('2026-11-18 15:00 UTC')).toBeInTheDocument();
  });

  it('keeps the final saved instant without a next action, wraparound or invented period totals', () => {
    openScenario(scenario({ epochIdx: 720, startIdx: 720, durationDays: 1 }));
    expect(screen.getByText('No later samples remain in this dataset.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find next sample/ })).not.toBeInTheDocument();
    expect(screen.getByText('One saved instant')).toBeInTheDocument();
    expect(screen.getByText('Over a period').closest('details')).not.toHaveAttribute('open');
    openDisclosure('Over a period');
    expect(screen.getByText(/One instant is selected/)).toBeInTheDocument();
    for (const cell of within(conditions()).getAllByRole('cell')) expect(cell).toHaveTextContent(/^—$/);
    expect(within(conditions()).getByText('2026-12-15 00:00 UTC')).toHaveAttribute('dateTime', dataset.mission_window.timestamps_utc[720]);
  });

  it('copies only active place B and restores that free point as one scenario without terrain claims', async () => {
    const writeText = useClipboard();
    const original = scenario({ epochIdx: 168 });
    const view = openScenario(original);
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    expect(screen.queryByRole('complementary', { name: 'Site conditions and model details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare places' }));
    expect(screen.getByRole('button', { name: /^Edit place B:/ })).toHaveAttribute('aria-pressed', 'true');
    openDisclosure('Enter coordinates');
    fireEvent.change(screen.getByLabelText('Latitude (degrees)'), { target: { value: '-43.3' } });
    fireEvent.change(screen.getByLabelText('Longitude east (degrees)'), { target: { value: '348.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use coordinates' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a place' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Places (2)' })).toBeInTheDocument();
    expect(within(conditions()).getByText('Approximate geometry · geometric horizon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Share this scenario/ }));
    const { url, state } = await copiedScenario(writeText);
    expect(await screen.findByText('Scenario link copied.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scenario link')).not.toBeInTheDocument();
    expect(state.site.kind).toBe('coordinates');
    if (state.site.kind !== 'coordinates') throw new Error('Expected the active free point, not the named place A.');
    expect(state.site.latDeg).toBeCloseTo(-43.3, 9);
    expect(state.site.lonEastDeg).toBeCloseTo(348.8, 9);
    expect(state.epochIdx).toBe(original.epochIdx);
    expect(state.config).toEqual(original.config);
    view.unmount();
    window.history.replaceState({}, '', url);
    render(<LegacyApp dataset={dataset} />);
    expect(screen.getByRole('button', { name: 'Place' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Places (2)' })).not.toBeInTheDocument();
    expect(within(conditions()).getByText('Approximate geometry · geometric horizon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find next sample/ })).not.toBeInTheDocument();
    openDisclosure('Over a period');
    for (const cell of within(conditions()).getAllByRole('cell')) expect(cell).toHaveTextContent(/^—$/);
    openDisclosure('Angles, assumptions and sources');
    expect(within(conditions()).getByText(/-43\.300°, 348\.800° E \(approximate model\)/)).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'East-West dx offset' })).not.toBeInTheDocument();
  });

  it('keeps two nearby free points independent when they share the same coordinates rounded to two decimals', async () => {
    const pointA = { kind: 'coordinates' as const, latDeg: -86.1231, lonEastDeg: 34.1011 };
    const pointB = { kind: 'coordinates' as const, latDeg: -86.1239, lonEastDeg: 34.1019 };
    const writeText = useClipboard();
    openScenario(scenario({ site: pointA, epochIdx: 168 }));
    fireEvent.click(screen.getByRole('button', { name: 'Place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compare places' }));
    expect(screen.getByRole('button', { name: /^Edit place B:/ })).toHaveAttribute('aria-pressed', 'true');
    openDisclosure('Enter coordinates');
    fireEvent.change(screen.getByLabelText('Latitude (degrees)'), { target: { value: String(pointB.latDeg) } });
    fireEvent.change(screen.getByLabelText('Longitude east (degrees)'), { target: { value: String(pointB.lonEastDeg) } });
    fireEvent.click(screen.getByRole('button', { name: 'Use coordinates' }));
    expect(screen.queryByRole('dialog', { name: 'Choose a place' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share this scenario' }));
    const savedB = await copiedScenario(writeText);
    expect(savedB.state.site.kind).toBe('coordinates');
    if (savedB.state.site.kind !== 'coordinates') throw new Error('Expected free point B.');
    expect(savedB.state.site.latDeg).toBeCloseTo(pointB.latDeg, 9);
    expect(savedB.state.site.lonEastDeg).toBeCloseTo(pointB.lonEastDeg, 9);

    openDisclosure('Angles, assumptions and sources');
    const slots = screen.getByRole('group', { name: 'Select site for assumptions and sources' });
    const selectA = within(slots).getByRole('button', { name: /\bA$/ });
    expect(selectA).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(selectA);
    expect(selectA).toHaveAttribute('aria-pressed', 'true');
    writeText.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Share this scenario' }));
    const savedA = await copiedScenario(writeText);
    expect(savedA.state.site.kind).toBe('coordinates');
    if (savedA.state.site.kind !== 'coordinates') throw new Error('Expected the original free point A.');
    expect(savedA.state.site.latDeg).toBeCloseTo(pointA.latDeg, 9);
    expect(savedA.state.site.lonEastDeg).toBeCloseTo(pointA.lonEastDeg, 9);
    expect(savedA.state.epochIdx).toBe(168);
    expect(savedA.url).not.toBe(savedB.url);
  });

  it('reports malformed or invalid UTC shares without silently opening a corrected scenario', () => {
    const valid = new URL(encodeScenarioUrl(base, scenario(), dataset));
    const urls = [`${base}?lunarScenario=%7B%7D`];
    for (const utc of ['2026-11-31T00:00:00Z', '2026-11-15T00:30:00Z', '2026-12-15T01:00:00Z']) {
      const url = new URL(valid);
      const payload = JSON.parse(url.searchParams.get('lunarScenario')!);
      payload.utc = utc;
      url.searchParams.set('lunarScenario', JSON.stringify(payload));
      urls.push(url.toString());
    }
    for (const url of urls) {
      window.history.replaceState({}, '', url);
      const view = render(<LegacyApp dataset={dataset} />);
      expect(screen.getByRole('alert')).toHaveTextContent('Could not open shared scenario');
      expect(screen.getByRole('heading', { name: /Landing\s*Guide/ })).toBeInTheDocument();
      expect(screen.queryByRole('complementary', { name: 'Site conditions and model details' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('offers a selectable URL only when clipboard fails, then clears stale share feedback after the period changes', async () => {
    useClipboard(vi.fn().mockRejectedValue(new Error('Clipboard permission denied')));
    openScenario();
    fireEvent.click(screen.getByRole('button', { name: /Share this scenario/ }));
    const field = await screen.findByRole('textbox', { name: 'Scenario link' });
    expect(field).toHaveAttribute('readonly');
    expect(decodeScenarioUrl(new URL((field as HTMLInputElement).value).search, dataset).status).toBe('valid');
    field.focus();
    expect((field as HTMLInputElement).selectionStart).toBe(0);
    expect((field as HTMLInputElement).selectionEnd).toBe((field as HTMLInputElement).value.length);
    fireEvent.click(screen.getByRole('button', { name: /^Time$/ }));
    openDisclosure('Analysis period and playback');
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis period duration' }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close time controls' }));
    showConditions();
    expect(screen.queryByLabelText('Scenario link')).not.toBeInTheDocument();
    expect(screen.queryByText('Copy the scenario link below.')).not.toBeInTheDocument();
    expect(screen.getByText('168h analysis period')).toBeInTheDocument();
  });

  it('preserves current UTC when shortening the analysis duration and makes the adjusted period shareable', async () => {
    const writeText = useClipboard();
    openScenario(scenario({ epochIdx: 168, startIdx: 48, durationDays: 7 }));
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    openDisclosure('Analysis period and playback');
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis period duration' }), { target: { value: '1' } });
    expect(screen.getByLabelText('Date (UTC)')).toHaveValue('2026-11-22');
    expect(screen.getByLabelText('Hour (0–23 UTC)')).toHaveValue(0);
    expect(screen.getByRole('slider', { name: 'UTC sample timeline' })).toHaveValue('168');
    expect(screen.getByRole('slider', { name: 'UTC sample timeline' })).toHaveAttribute('min', '168');
    expect(screen.getByText('2026-11-22 00:00:00 UTC')).toBeInTheDocument();
    expect(screen.getByText('2026-11-23 00:00:00 UTC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close time controls' }));
    showConditions();
    fireEvent.click(screen.getByRole('button', { name: 'Share this scenario' }));
    const { state } = await copiedScenario(writeText);
    expect(state).toMatchObject({ epochIdx: 168, startIdx: 168, durationDays: 1 });
  });

  it('keeps the confirmed scenario shareable after an invalid UTC draft without changing its epoch or period', async () => {
    const writeText = useClipboard();
    const original = scenario({ epochIdx: 168, startIdx: 48, durationDays: 7 });
    openScenario(original);
    fireEvent.click(screen.getByRole('button', { name: 'Time' }));
    fireEvent.change(screen.getByLabelText('Hour (0–23 UTC)'), { target: { value: '24' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The confirmed time above is unchanged.');
    fireEvent.click(screen.getByRole('button', { name: 'Close time controls' }));
    showConditions();
    expect(within(conditions()).getByText('2026-11-22 00:00 UTC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share this scenario' }));
    const { state } = await copiedScenario(writeText);
    expect(state).toEqual(original);
  });
});
