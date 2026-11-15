import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimePopover } from './TimePopover';
import { computeWindowSlice } from './state';

afterEach(cleanup);

// Synthetic, complete hourly UTC axis for interaction tests, not lunar results.
const timestamps = Array.from({ length: 73 }, (_, hour) =>
  new Date(Date.UTC(2026, 10, 15, hour)).toISOString().replace('.000Z', 'Z'));

function props() {
  return {
    timestampsUtc: timestamps, epochIdx: 30, startIdx: 24, durationDays: 1 as const,
    slice: computeWindowSlice(timestamps, 24, 1), isPlaying: false, speed: 1 as const,
    onChangeStartIdx: vi.fn(), onChangeEpochIdx: vi.fn(), onChangeDuration: vi.fn(),
    onTogglePlay: vi.fn(), onResetTime: vi.fn(), onChangeSpeed: vi.fn(), onClose: vi.fn(),
  } satisfies ComponentProps<typeof TimePopover>;
}

const dateInput = () => screen.getByLabelText('Date (UTC)') as HTMLInputElement;
const hourInput = () => screen.getByRole('spinbutton', { name: 'Hour (0–23 UTC)' });
const openDetails = () => {
  const summary = screen.getByText('Analysis period and playback');
  fireEvent.click(summary);
  return summary.closest('details')!;
};

describe('minimal time selection', () => {
  it('presents the selected instant separately from the analysis period start and end', () => {
    render(<TimePopover {...props()} />);
    expect(screen.getByRole('dialog', { name: 'UTC time and analysis period' })).toBeInTheDocument();
    expect(screen.getByText('At this time')).toBeInTheDocument();
    expect(dateInput()).toHaveValue('2026-11-16');
    expect(hourInput()).toHaveValue(6);
    expect(screen.getByText('2026-11-16 06:00 UTC')).toHaveAttribute('dateTime', timestamps[30]);
    const summary = screen.getByText('Analysis period and playback');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    openDetails();
    expect(screen.getByText('2026-11-16 00:00:00 UTC')).toHaveAttribute('dateTime', timestamps[24]);
    expect(screen.getByText('2026-11-17 00:00:00 UTC')).toHaveAttribute('dateTime', timestamps[48]);
    expect(screen.getByText(/24 hours between saved endpoints/)).toBeInTheDocument();
  });

  it('synchronizes fields with a changed selected epoch, without confusing it with a changed start', () => {
    const p = props();
    const { rerender } = render(<TimePopover {...p} />);
    rerender(<TimePopover {...p} startIdx={12} slice={computeWindowSlice(timestamps, 12, 1)} />);
    expect(hourInput()).toHaveValue(6);
    expect(dateInput()).toHaveValue('2026-11-16');
    rerender(<TimePopover {...p} epochIdx={31} />);
    expect(hourInput()).toHaveValue(7);
    expect(screen.getByText('2026-11-16 07:00 UTC')).toBeInTheDocument();
  });

  it('selects an exact UTC inside the existing period without moving its start', () => {
    const p = props();
    render(<TimePopover {...p} />);
    fireEvent.change(hourInput(), { target: { value: '7' } });
    expect(p.onChangeEpochIdx).toHaveBeenCalledExactlyOnceWith(31);
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
    expect(p.onTogglePlay).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-11-15', 6], ['2026-11-17', 54],
  ])('opens a new period before committing an exact sample outside the current period: %s', (date, expected) => {
    const p = props();
    render(<TimePopover {...p} />);
    fireEvent.change(dateInput(), { target: { value: date } });
    expect(p.onChangeStartIdx).toHaveBeenCalledExactlyOnceWith(expected);
    expect(p.onChangeEpochIdx).toHaveBeenCalledExactlyOnceWith(expected);
    expect(p.onChangeStartIdx.mock.invocationCallOrder[0]).toBeLessThan(p.onChangeEpochIdx.mock.invocationCallOrder[0]);
  });

  it.each(['', '24', '-1', '1.5'])('retains the confirmed reading and emits no time/window changes for an invalid hour: %s', value => {
    const p = props();
    render(<TimePopover {...p} />);
    fireEvent.change(hourInput(), { target: { value } });
    expect(screen.getByRole('alert')).toHaveTextContent('The confirmed time above is unchanged.');
    expect(hourInput()).toHaveAttribute('aria-invalid', 'true');
    expect(hourInput()).toHaveAccessibleDescription(/whole hour/);
    expect(screen.getByText('2026-11-16 06:00 UTC')).toBeInTheDocument();
    expect(p.onChangeEpochIdx).not.toHaveBeenCalled();
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
  });

  it.each(['2026-11-31', '2026-11-14', '2026-11-18'])('does not normalize or clamp invalid/out-of-coverage date drafts: %s', value => {
    const p = props();
    render(<TimePopover {...p} />);
    fireEvent.change(dateInput(), { target: { value } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(p.onChangeEpochIdx).not.toHaveBeenCalled();
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
    expect(screen.getByText('2026-11-16 06:00 UTC')).toBeInTheDocument();
  });

  it('refuses an in-range missing saved hour rather than selecting the nearest sample', () => {
    const p = props();
    const sparse = timestamps.filter((_, index) => index !== 31);
    render(<TimePopover {...p} timestampsUtc={sparse} />);
    fireEvent.change(hourInput(), { target: { value: '7' } });
    expect(screen.getByRole('alert')).toHaveTextContent('No saved sample is available at that time.');
    expect(p.onChangeEpochIdx).not.toHaveBeenCalled();
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
  });

  it('clears an invalid draft when the user next selects an exact valid sample', () => {
    const p = props();
    render(<TimePopover {...p} />);
    fireEvent.change(hourInput(), { target: { value: '' } });
    fireEvent.change(hourInput(), { target: { value: '8' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(hourInput()).not.toHaveAttribute('aria-invalid');
    expect(p.onChangeEpochIdx).toHaveBeenCalledExactlyOnceWith(32);
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
  });

  it('keeps exactly one native range with UTC text and forwards its selected sample', () => {
    const p = props();
    render(<TimePopover {...p} />);
    const range = screen.getByRole('slider', { name: 'UTC sample timeline' });
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    expect(range).toHaveAttribute('type', 'range');
    expect(range).toHaveAttribute('min', '24');
    expect(range).toHaveAttribute('max', '48');
    expect(range).toHaveAttribute('step', '1');
    expect(range).toHaveAttribute('aria-valuetext', '2026-11-16 06:00 UTC');
    expect(range).toHaveAccessibleDescription('One step selects one saved sample.');
    fireEvent.change(range, { target: { value: '35' } });
    expect(p.onChangeEpochIdx).toHaveBeenCalledExactlyOnceWith(35);
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
  });

  it('uses native optional selects for duration and speed while keeping playback buttons in the main HUD', () => {
    const p = props();
    render(<TimePopover {...p} />);
    expect(openDetails()).toHaveAttribute('open');
    const duration = screen.getByRole('combobox', { name: 'Analysis period duration' });
    const speed = screen.getByRole('combobox', { name: 'Playback speed' });
    expect(duration.tagName).toBe('SELECT');
    expect(speed.tagName).toBe('SELECT');
    fireEvent.change(duration, { target: { value: '14' } });
    fireEvent.change(speed, { target: { value: '3' } });
    expect(p.onChangeDuration).toHaveBeenCalledExactlyOnceWith(14);
    expect(p.onChangeSpeed).toHaveBeenCalledExactlyOnceWith(3);
    expect(p.onChangeEpochIdx).not.toHaveBeenCalled();
    expect(p.onChangeStartIdx).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^(Play|Pause|\+6h|Reset window)$/ })).not.toBeInTheDocument();
    expect(screen.getByText('Playback is paused. Use Play in the main view.')).toBeInTheDocument();
  });

  it('labels a single saved instant without pretending it is a one-hour analysis period', () => {
    const p = props();
    render(<TimePopover {...p} epochIdx={72} startIdx={72} durationDays={30}
      slice={{ startIdx: 72, endIdx: 72, epochCount: 1, totalHours: 0, clampedByEnd: true }} />);
    openDetails();
    expect(screen.getByText('One saved instant; period totals are not assessed.')).toBeInTheDocument();
    expect(screen.queryByText(/1 hours? (evaluated|between)/)).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'UTC sample timeline' })).toBeDisabled();
    expect(screen.getByText('This period ends at the last saved sample.')).toBeInTheDocument();
    expect(screen.getAllByText('2026-11-18 00:00:00 UTC')).toHaveLength(2);
  });

  it('offers one reset that clears an invalid draft even when the confirmed epoch was already the initial sample', () => {
    const p = props();
    render(<TimePopover {...p} epochIdx={0} startIdx={0} slice={computeWindowSlice(timestamps, 0, 1)} />);
    fireEvent.change(hourInput(), { target: { value: '' } });
    openDetails();
    const reset = screen.getByRole('button', { name: 'Reset time and analysis period' });
    expect(screen.getAllByRole('button')).toHaveLength(2); // Close + the only reset.
    fireEvent.click(reset);
    expect(p.onResetTime).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(dateInput()).toHaveValue('2026-11-15');
    expect(hourInput()).toHaveValue(0);
  });

  it('retains native focusable fields/disclosure controls and makes no universal terrain-source claim', () => {
    const p = props();
    render(<TimePopover {...p} />);
    expect(dateInput()).toHaveAttribute('type', 'date');
    dateInput().focus();
    expect(dateInput()).toHaveFocus();
    hourInput().focus();
    expect(hourInput()).toHaveFocus();
    openDetails();
    const duration = screen.getByRole('combobox', { name: 'Analysis period duration' });
    duration.focus();
    expect(duration).toHaveFocus();
    expect(screen.getByText(/Conditions use the selected point's stated model/)).toBeInTheDocument();
    expect(screen.queryByText(/All metrics use|80 m\/px LOLA/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close time controls' }));
    expect(p.onClose).toHaveBeenCalledOnce();
  });
});
