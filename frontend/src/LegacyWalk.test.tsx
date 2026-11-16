import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyApp } from './LegacyApp';

vi.mock('./landing-guide/OriginalLunarViewport', () => ({
  OriginalLunarViewport: ({ currentUtc, mode }: { currentUtc: string; mode: string }) => (
    <output data-testid="orbital-context" data-utc={currentUtc} data-mode={mode} />
  ),
}));
vi.mock('./landing-guide/AstronautViewport', () => ({
  AstronautViewport: ({ epochIdx, onExit }: { epochIdx: number; onExit: () => void }) => (
    <section data-testid="walk" data-epoch={epochIdx}>
      <button onClick={onExit}>Return from walk</button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
});

describe('optional walk integration', () => {
  it('pauses the selected UTC, replaces the orbital HUD, and restores its context and View focus on exit', () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/?autostart=1');
    render(<LegacyApp />);
    const context = screen.getByTestId('orbital-context');
    const initialUtc = context.getAttribute('data-utc');
    fireEvent.click(screen.getByRole('button', { name: 'Start playback' }));
    act(() => { vi.advanceTimersByTime(360); });
    expect(context.getAttribute('data-utc')).not.toBe(initialUtc);
    const selectedUtc = context.getAttribute('data-utc');
    fireEvent.click(screen.getByRole('button', { name: 'Moon walk' }));
    const epoch = screen.getByTestId('walk').getAttribute('data-epoch');
    expect(context).toHaveAttribute('data-mode', 'astronaut');
    expect(screen.queryByRole('button', { name: 'Time' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Conditions' })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(context).toHaveAttribute('data-utc', selectedUtc);
    expect(screen.getByTestId('walk')).toHaveAttribute('data-epoch', epoch);
    fireEvent.click(screen.getByRole('button', { name: 'Return from walk' }));
    act(() => { vi.advanceTimersByTime(32); });
    expect(screen.queryByTestId('walk')).not.toBeInTheDocument();
    expect(context).toHaveAttribute('data-mode', '3d');
    expect(context).toHaveAttribute('data-utc', selectedUtc);
    expect(screen.getByRole('button', { name: 'View' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Start playback' })).toBeInTheDocument();
  });

  it('offers a direct walk entry on the first screen', () => {
    render(<LegacyApp />);
    expect(screen.getByRole('button', { name: 'Open Explorer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Moon walk' }));
    expect(screen.getByTestId('walk')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Perspective' })).not.toBeInTheDocument();
  });
});
