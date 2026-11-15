import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyApp as App } from '../LegacyApp';

describe('3D Moon fallback without WebGL', () => {
  afterEach(cleanup);

  it('shows the NASA reference image without projected pins or dead camera controls', () => {
    const { container } = render(<App />);
    expect(container.querySelector('.lunar-stage')).toHaveAttribute('data-render-status', 'unavailable');
    expect(screen.getByAltText(/Reference image only/i)).toHaveClass('viewport-poster', 'is-hero');

    fireEvent.click(screen.getAllByRole('button', { name: /Open Explorer/i })[0]);
    expect(screen.getByAltText(/Reference image only/i)).not.toHaveClass('is-hero');
    expect(screen.getByRole('status', { name: '3D view status' })).toHaveTextContent(/Choose a location from the list/);
    expect(container.querySelector('.lunar-hud-overlay')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });
});
