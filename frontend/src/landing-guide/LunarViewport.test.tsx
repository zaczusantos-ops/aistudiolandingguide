import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MoonRuntimeOptions } from './moonRuntime';
import { LunarViewport, type LunarViewportProps } from './LunarViewport';

const mock = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), dispose: vi.fn(),
  callbacks: undefined as { ready: () => void; unavailable: () => void; pause: () => void; topography: (status: 'loading' | 'ready' | 'unavailable') => void } | undefined,
}));
vi.mock('./moonRuntime', () => ({ createMoonRuntime: mock.create }));
const site = {
  id: 'example', name: 'Example point', center: { latitude_deg: -85, longitude_east_deg: 0 },
  sky_series: { sun_az_deg: [10], sun_el_deg: [1], earth_az_deg: [20], earth_el_deg: [2] },
};
const props: LunarViewportProps = {
  mode: '3d', surfaceMode: 'realistic', sites: [], entries: [{ label: 'A', site }], activeSlotIdx: 0,
  onSelectActiveSlot: vi.fn(), epochIdx: 0, hasStarted: true, selectionMode: 'cursor',
  onSelectSiteDirect: vi.fn(), onOutsidePolarCoverage: vi.fn(), reticleCoords: { latDeg: -85, lonEastDeg: 0 },
  embedded: true,
};
beforeEach(() => {
  mock.create.mockImplementation((_mount, _options, callbacks) => {
    mock.callbacks = callbacks;
    return { update: mock.update, dispose: mock.dispose, zoom: vi.fn(), orbit: vi.fn(), view: vi.fn() };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); mock.callbacks = undefined; });

describe('lunar view progressive fallback', () => {
  it('shows the real static image until the runtime confirms its textured frame', async () => {
    render(<LunarViewport {...props} />);
    const image = screen.getByAltText(/NASA Moon reference image/);
    expect(image).toHaveAttribute('src', '/assets/lunar/moon-poster.jpg');
    expect(image.parentElement).not.toHaveStyle({ display: 'none' });
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    expect(screen.getByTestId('lunar-webgl-canvas')).toHaveStyle({ pointerEvents: 'none' });
    act(() => mock.callbacks?.ready());
    expect(image.parentElement).toHaveStyle({ display: 'none' });
    expect(screen.getByTestId('lunar-webgl-canvas')).toHaveStyle({ pointerEvents: 'auto' });
  });

  it('restores the static reference and removes unavailable controls after context loss', async () => {
    const onRotation = vi.fn();
    const onStatus = vi.fn();
    render(<LunarViewport {...props} onAutoRotateChange={onRotation} onStatusChange={onStatus} />);
    expect(onStatus).toHaveBeenLastCalledWith('loading');
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    act(() => mock.callbacks?.ready());
    expect(onStatus).toHaveBeenLastCalledWith('ready');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    act(() => mock.callbacks?.unavailable());
    expect(onStatus).toHaveBeenLastCalledWith('unavailable');
    expect(screen.getByRole('status', { name: '3D view status' })).toHaveTextContent(/3D view unavailable/);
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(screen.getByAltText(/NASA Moon reference image/).parentElement).not.toHaveStyle({ display: 'none' });
    expect(onRotation).toHaveBeenCalledWith(false);
  });

  it('gates runtime selection outside the location step and disposes on unmount', async () => {
    const view = render(<LunarViewport {...props} selectionEnabled={false} />);
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    expect((mock.create.mock.calls[0][1] as MoonRuntimeOptions).selectionEnabled).toBe(false);
    view.unmount();
    expect(mock.dispose).toHaveBeenCalledOnce();
  });

  it('requests elevation colors independently from optional polar shading', async () => {
    render(<LunarViewport {...props} surfaceMode="topography" />);
    await waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
    const options = mock.create.mock.calls[0][1] as MoonRuntimeOptions;
    expect(options.topography).toBe(true);
    expect(options.detail).toBe(false);
    act(() => mock.callbacks?.ready());
    expect(screen.getByRole('status', { name: '3D view status' })).toHaveTextContent(/Loading LOLA elevation colors/);
    act(() => mock.callbacks?.topography('ready'));
    expect(screen.getByRole('status', { name: '3D view status' })).toHaveTextContent(/LOLA elevation colors/);
  });
});
