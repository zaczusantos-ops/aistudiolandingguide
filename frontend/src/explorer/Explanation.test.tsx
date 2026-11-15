import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import rawDataset from '../data/south_pole_precomputed.v1.json';
import { parseNavigatorDataset } from '../contract';
import { Explanation } from './Explanation';
import { HorizonDiagram } from './HorizonDiagram';
import { formatElevation, type ExplorerSite } from './geometry';

afterEach(cleanup);
const dataset = parseNavigatorDataset(rawDataset);

function sample(sunEl: number, earthEl = 0): ExplorerSite {
  return {
    id: 'sample', name: 'Chosen point', center: { latitude_deg: 0, longitude_east_deg: 0 },
    sky_series: { sun_az_deg: [90], sun_el_deg: [sunEl], earth_az_deg: [180], earth_el_deg: [earthEl] },
  };
}

describe('contextual Sun and Earth explanations', () => {
  it('uses the selected site, hourly sample and UTC in the diagram and signed value', () => {
    const site = dataset.sites[0];
    const firstUtc = dataset.mission_window.timestamps_utc[0];
    const { rerender } = render(<Explanation topic="sun" site={site} epochIdx={0} currentUtc={firstUtc} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(new RegExp(`${site.name}, ${firstUtc}`));
    expect(screen.getByText(formatElevation(site.sky_series.sun_el_deg[0]))).toBeInTheDocument();
    const nextSite = dataset.sites[1];
    const nextUtc = dataset.mission_window.timestamps_utc[360];
    rerender(<Explanation topic="sun" site={nextSite} epochIdx={360} currentUtc={nextUtc} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(new RegExp(`${nextSite.name}, ${nextUtc}`));
    expect(screen.getByText(formatElevation(nextSite.sky_series.sun_el_deg[360]))).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('data-elevation-deg', String(nextSite.sky_series.sun_el_deg[360]));
  });

  it('keeps a tiny negative elevation below the horizon without visually offsetting it above', () => {
    const { container } = render(<Explanation topic="sun" site={sample(-0.000001)} epochIdx={0} currentUtc="2026-11-15 00:00 UTC" />);
    expect(screen.getByText('−<0.01°')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/less than 0.01 degrees below/);
    expect(container.querySelector('.explainer-reading')).toHaveTextContent('Sun’s center is below the geometric horizon; this does not describe the whole disk.');
    expect(screen.getByText('Near horizon · use the signed angle')).toBeInTheDocument();
    expect(Number(container.querySelector('.explainer-body-center')?.getAttribute('cy'))).toBeGreaterThan(120);
    expect(container.querySelector('.explainer-reading')).toHaveTextContent('power output are not calculated');
  });

  it('connects Earth direction to a ground station without claiming a working radio link', () => {
    const { container } = render(<Explanation topic="earth" site={sample(10, 25)} epochIdx={0} currentUtc="2026-11-15 00:00 UTC" />);
    expect(container.querySelector('.explainer-reading')).toHaveTextContent('Earth’s center is above the geometric horizon.');
    expect(container.querySelector('.explainer-reading')).toHaveTextContent('A radio link needs a clear path to an Earth station; this view does not check that link.');
    expect(screen.getByText('What a radio link needs')).toHaveProperty('tagName', 'SUMMARY');
    expect(screen.getByText(/relay coverage is not evaluated/)).toBeInTheDocument();
  });

  it('keeps the marker within the schematic at zenith, nadir and the exact horizon', () => {
    const { container, rerender } = render(<HorizonDiagram body="earth" elevationDeg={90} azimuthDeg={0} siteName="North pole" currentUtc="2026-11-15 00:00 UTC" />);
    for (const elevation of [90, -90, 0]) {
      rerender(<HorizonDiagram body="earth" elevationDeg={elevation} azimuthDeg={0} siteName="North pole" currentUtc="2026-11-15 00:00 UTC" />);
      const marker = container.querySelector('.explainer-body-center');
      expect(Number(marker?.getAttribute('cx'))).toBeGreaterThanOrEqual(40);
      expect(Number(marker?.getAttribute('cx'))).toBeLessThanOrEqual(140);
      expect(Number(marker?.getAttribute('cy'))).toBeGreaterThanOrEqual(24);
      expect(Number(marker?.getAttribute('cy'))).toBeLessThanOrEqual(216);
    }
    expect(screen.getByRole('img')).toHaveAccessibleName(/on the geometric horizon/);
    expect(screen.getByText('0.00°')).toBeInTheDocument();
  });
});
