import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import rawDataset from '../../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../../contract';
import { DEFAULT_CONFIG, evaluateLiveSite } from '../../navigator/math';
import { computeWindowSlice, evaluateWindowMetrics, SLOT_META, type EvaluatedSlotEntry } from '../state';
import { AstronautViewport } from '../AstronautViewport';

const experience = vi.hoisted(() => ({
  create: vi.fn(),
  handle: {
    setSky: vi.fn(), setMoveVector: vi.fn(), addLook: vi.fn(), triggerTremor: vi.fn(), dispose: vi.fn(),
  },
}));
vi.mock('./experience', () => ({ createMoonbaseExperience: experience.create }));

const dataset = parseNavigatorDataset(rawDataset);
const site = dataset.sites.find(value => value.id === 'shackleton_ridge')!;
const analysis = evaluateLiveSite(site, 0, 0, dataset.horizon_azimuths_deg, dataset.mission_window, DEFAULT_CONFIG);
const entry: EvaluatedSlotEntry = {
  label: 'A', meta: SLOT_META.A, site, analysis,
  slot: { siteId: site.id, offsetXNorm: 0, offsetYNorm: 0 },
  metrics: evaluateWindowMetrics(analysis, dataset.mission_window, DEFAULT_CONFIG,
    computeWindowSlice(dataset.mission_window.timestamps_utc, 0, 30)),
};

beforeEach(() => {
  vi.clearAllMocks();
  experience.create.mockReturnValue(experience.handle);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function supportedGl() {
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => null, getParameter: () => 'Test GPU', RENDERER: 0x1f01,
  } as unknown as WebGLRenderingContext);
}

describe('illustrative walk scientific boundary', () => {
  it('distinguishes the drawn 10-degree Sun from the saved elevation and labels the scenery', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<AstronautViewport entries={[entry]} activeSlotIdx={0} epochIdx={0} />);
    const stage = screen.getByTestId('astronaut-stage');
    expect(stage).toHaveFocus();
    expect(stage).toHaveAttribute('data-scene-model', 'illustrative-moonbase');
    expect(stage).toHaveAccessibleName(/Terrain, base, lighting and Earth's appearance are illustrative/);
    const note = screen.getByTitle(/Sun is drawn at 10° elevation/);
    expect(note).toHaveTextContent('Illustrative scene · Sun drawn at 10°');
    expect(note).toHaveTextContent("Terrain, base and Earth's appearance are illustrative.");
    expect(note.title).toContain(`Saved Sun elevation at this time: ${site.sky_series.sun_el_deg[0].toFixed(1)}°`);
    expect(experience.create).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('needs WebGL');
    expect(screen.queryByRole('group', { name: /tremor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nakamura|Lognonné/i })).not.toBeInTheDocument();
  });

  it.each(['sun_az_deg', 'sun_el_deg', 'earth_az_deg', 'earth_el_deg'] as const)('does not replace unavailable %s with a fabricated zero direction', key => {
    const gl = supportedGl();
    const missing: EvaluatedSlotEntry = {
      ...entry, site: { ...site, sky_series: { ...site.sky_series, [key]: [] } },
    };
    render(<AstronautViewport entries={[missing]} activeSlotIdx={0} epochIdx={0} />);
    expect(screen.getByTestId('astronaut-stage')).toHaveAttribute('data-sky-available', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Sky directions are unavailable');
    expect(experience.create).not.toHaveBeenCalled();
    expect(gl).not.toHaveBeenCalled();
  });

  it('disposes the previous walk if a later selected sample becomes unavailable', async () => {
    supportedGl();
    const view = render(<AstronautViewport entries={[entry]} activeSlotIdx={0} epochIdx={0} />);
    await waitFor(() => expect(experience.create).toHaveBeenCalledTimes(1));
    expect(experience.handle.setSky).toHaveBeenCalledWith(
      site.sky_series.sun_az_deg[0], 10, site.sky_series.earth_az_deg[0], site.sky_series.earth_el_deg[0],
    );
    view.rerender(<AstronautViewport entries={[entry]} activeSlotIdx={0} epochIdx={9999} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sky directions are unavailable'));
    expect(experience.handle.dispose).toHaveBeenCalledTimes(1);
    expect(experience.create).toHaveBeenCalledTimes(1);
  });

  it('keeps a native exit button and Escape available when the walk cannot render', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const exit = vi.fn();
    render(<AstronautViewport entries={[entry]} activeSlotIdx={0} epochIdx={0} onExit={exit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Return to Orbit 3D view' }));
    expect(exit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(exit).toHaveBeenCalledTimes(2);
  });
});
