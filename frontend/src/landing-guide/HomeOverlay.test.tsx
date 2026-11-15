import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { HomeOverlay } from './HomeOverlay';

afterEach(cleanup);
const dataset = parseNavigatorDataset(rawDataset);

function setup() {
  const onStart = vi.fn();
  const view = render(<HomeOverlay sites={dataset.sites} horizonAzDeg={dataset.horizon_azimuths_deg} missionWindow={dataset.mission_window} onStart={onStart} />);
  return { ...view, onStart };
}

describe('NASA home explainers', () => {
  it('preserves the original opening and uses two user-controlled videos with text alternatives', () => {
    const { container } = setup();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('LandingGuide.');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What keeps a site in sunlight?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'When can Earth be seen?' })).toBeInTheDocument();
    const videos = [...container.querySelectorAll('video')];
    expect(videos).toHaveLength(2);
    for (const [idx, id] of ['sunlight', 'earth-view'].entries()) {
      const video = videos[idx];
      expect(video).toHaveAttribute('src', `/assets/lunar/explainers/${id}.mp4`);
      expect(video).toHaveAttribute('poster', `/assets/lunar/explainers/${id}.jpg`);
      expect(video).toHaveAttribute('preload', 'none');
      expect(video).toHaveAttribute('controls');
      expect(video).toHaveAttribute('playsinline');
      expect(video).toHaveProperty('muted', true);
      expect(video).not.toHaveAttribute('autoplay');
      expect(video).not.toHaveAttribute('loop');
      const track = video.querySelector('track');
      expect(track).toHaveAttribute('kind', 'captions');
      expect(track).toHaveAttribute('src', `/assets/lunar/explainers/${id}.vtt`);
      expect(track).toHaveAttribute('srclang', 'en');
      expect(track).toHaveAttribute('default');
      const figure = video.closest('figure')!;
      expect(figure).toHaveTextContent('not the site or date selected in this app');
      expect(within(figure).getByText('Read video description').tagName).toBe('SUMMARY');
    }
    expect(screen.getAllByRole('link', { name: 'NASA’s Scientific Visualization Studio' }).map((link) => link.getAttribute('href')))
      .toEqual(['https://svs.gsfc.nasa.gov/4893/', 'https://svs.gsfc.nasa.gov/4944/']);
    expect(container.querySelectorAll('.interactive-panel, .spec-strip, .brief-card')).toHaveLength(0);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('separates NASA footage from reproducible explorer examples', () => {
    const { onStart } = setup();
    const energy = screen.getByRole('heading', { name: 'What keeps a site in sunlight?' }).closest('section')!;
    expect(energy).toHaveTextContent('Explorer example · 15 Nov 2026, 00:00 UTC');
    fireEvent.click(screen.getByRole('button', { name: /Check the crater floor/ }));
    expect(onStart).toHaveBeenLastCalledWith('shackleton_psr_floor', 0);
    const earth = screen.getByRole('heading', { name: 'When can Earth be seen?' }).closest('section')!;
    expect(earth).toHaveTextContent('Explorer example · 18 Nov 2026, 15:00 UTC');
    fireEvent.click(screen.getByRole('button', { name: /Check Shackleton Ridge/ }));
    expect(onStart).toHaveBeenLastCalledWith('shackleton_ridge', 87);
  });

  it('retains map pins and an equivalent native site selector', () => {
    const { onStart } = setup();
    const site = dataset.sites.find((entry) => entry.id === 'malapert_massif')!;
    const selector = screen.getByRole('combobox', { name: 'Choose a named site' });
    fireEvent.change(selector, { target: { value: site.id } });
    expect(screen.getByRole('button', { name: `Inspect ${site.name}` })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Explore this site →' }));
    expect(onStart).toHaveBeenLastCalledWith(site.id);
    const ridge = dataset.sites.find((entry) => entry.id === 'shackleton_ridge')!;
    fireEvent.click(screen.getByRole('button', { name: `Inspect ${ridge.name}` }));
    expect(selector).toHaveValue(ridge.id);
  });

  it('provides readable recovery when video playback fails', () => {
    const { container } = setup();
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByRole('status')).toHaveTextContent('Video unavailable. Read the description below or open the NASA source.');
    expect(screen.getAllByText('Read video description')).toHaveLength(2);
  });

  it('does not claim permanent shadow from one month or guarantee power or a radio link', () => {
    const { container } = setup();
    expect(container).toHaveTextContent('A dark 30-day sample alone does not establish permanent shadow.');
    expect(container).toHaveTextContent('Neither result guarantees sufficient power.');
    expect(container).toHaveTextContent('That is not a universal requirement for a radio link.');
    expect(container).toHaveTextContent('Relay visibility is a model, not a guarantee of an available service.');
    expect(container).not.toHaveTextContent('ray-march local LOLA terrain horizons');
    expect(container).not.toHaveTextContent('blackout gaps vanish');
  });
});
