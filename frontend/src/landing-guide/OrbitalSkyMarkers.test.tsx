import React, { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OrbitalSkyMarkers } from './OrbitalSkyMarkers';

afterEach(cleanup);

function markerProps() {
  return {
    sunRef: createRef<SVGGElement>(),
    earthRef: createRef<SVGGElement>(),
    siteName: 'Shackleton Ridge',
    currentUtc: '2026-11-15T00:00:00Z',
  };
}

describe('passive orbital direction artwork', () => {
  it('exposes the imperative SVG contract without adding controls or guessing readiness', () => {
    const props = markerProps();
    const { container } = render(<svg><OrbitalSkyMarkers {...props} /></svg>);
    expect(container.querySelectorAll('.orbital-direction')).toHaveLength(2);
    expect(container.querySelectorAll('button, [role="button"], [tabindex]')).toHaveLength(0);

    for (const [body, ref] of [['sun', props.sunRef], ['earth', props.earthRef]] as const) {
      const group = ref.current!;
      expect(group).toHaveAttribute('data-body', body);
      expect(group).toHaveAttribute('data-site', props.siteName);
      expect(group).toHaveAttribute('data-utc', props.currentUtc);
      expect(group).toHaveAttribute('visibility', 'hidden');
      expect(group).toHaveAttribute('pointer-events', 'none');
      expect(group).toHaveAttribute('focusable', 'false');
      expect(group.querySelector('.direction-line')).toHaveAttribute('visibility', 'hidden');
      expect(group.querySelector('.direction-leader')).toHaveAttribute('visibility', 'hidden');
      expect(group.querySelector('.direction-edge-arrow')).toHaveAttribute('visibility', 'hidden');
      const marker = group.querySelector('.direction-marker')!;
      expect(marker.querySelector('.direction-edge-arrow')).not.toBeNull();
      expect(marker.querySelector('.direction-label')).toBeNull();
      expect(group.querySelector('.direction-label')?.parentElement).toBe(group);
      expect(group.querySelector('.direction-label')).toHaveTextContent(body === 'sun' ? 'Sun direction' : 'Earth direction');
      expect(group.querySelector('.direction-view-note')).toBeEmptyDOMElement();
      expect(group.querySelector('.direction-view-description')).toBeEmptyDOMElement();
    }
    expect(props.sunRef.current?.querySelector('.direction-sun-disk')).toHaveAttribute('r', '16');
    expect(props.earthRef.current?.querySelector('image')).toHaveAttribute('href', '/assets/lunar/earth-direction.jpg');
    expect(props.earthRef.current?.querySelector('image')).toHaveAttribute('width', '36');
  });

  it('identifies the selected site and UTC while qualifying direction, edge arrows and imagery', () => {
    const props = markerProps();
    render(<svg><OrbitalSkyMarkers {...props} /></svg>);
    for (const [name, ref] of [['Sun', props.sunRef], ['Earth', props.earthRef]] as const) {
      const group = ref.current!;
      group.setAttribute('visibility', 'visible');
      expect(group).toHaveAccessibleName(`${name} direction from Shackleton Ridge at 2026-11-15 00:00 UTC`);
      expect(group).toHaveAccessibleDescription(/Direction in the current camera view; size and distance are not to scale/);
      expect(group).toHaveAccessibleDescription(/does not establish local visibility, usable power or a radio link/);
      expect(group).toHaveAccessibleDescription(/outside the camera view/);
    }
    expect(props.earthRef.current).toHaveAccessibleDescription(/NASA\/NOAA Blue Marble 2012 composite is illustrative/);
    expect(props.earthRef.current).toHaveAccessibleDescription(/not the phase, orientation or surface appearance at the selected time/);
  });

  it('updates context without overwriting geometry and statuses owned by the renderer', () => {
    const props = markerProps();
    const { rerender } = render(<svg><OrbitalSkyMarkers {...props} /></svg>);
    const sun = props.sunRef.current!;
    const marker = sun.querySelector('.direction-marker')!;
    const arrow = sun.querySelector('.direction-edge-arrow')!;
    const label = sun.querySelector('.direction-label')!;
    const note = sun.querySelector('.direction-view-note')!;
    const viewDescription = sun.querySelector('.direction-view-description')!;
    sun.setAttribute('visibility', 'visible');
    sun.setAttribute('data-offscreen', 'true');
    marker.setAttribute('transform', 'translate(120, 240)');
    arrow.setAttribute('visibility', 'visible');
    arrow.setAttribute('transform', 'rotate(90)');
    label.setAttribute('x', '160');
    label.setAttribute('y', '240');
    label.setAttribute('text-anchor', 'end');
    note.setAttribute('x', '160');
    note.textContent = 'Outside camera view';
    viewDescription.textContent = 'Sun direction is outside the current camera view; this does not indicate local visibility.';

    rerender(<svg><OrbitalSkyMarkers {...props} siteName="Malapert Massif" currentUtc="2026-11-18T15:00:00Z" /></svg>);
    expect(props.sunRef.current).toBe(sun);
    expect(sun).toHaveAttribute('visibility', 'visible');
    expect(sun).toHaveAttribute('data-offscreen', 'true');
    expect(marker).toHaveAttribute('transform', 'translate(120, 240)');
    expect(arrow).toHaveAttribute('visibility', 'visible');
    expect(arrow).toHaveAttribute('transform', 'rotate(90)');
    expect(label).toHaveAttribute('x', '160');
    expect(label).toHaveAttribute('text-anchor', 'end');
    expect(note).toHaveAttribute('x', '160');
    expect(note).toHaveTextContent('Outside camera view');
    expect(sun.querySelector('.direction-name')).toHaveTextContent('Sun direction');
    expect(sun).toHaveAttribute('data-utc', '2026-11-18T15:00:00Z');
    expect(sun).toHaveAccessibleName('Sun direction from Malapert Massif at 2026-11-18 15:00 UTC');
    expect(sun).toHaveAccessibleDescription(/Sun direction is outside the current camera view/);
  });

  it('keeps clipping and accessible IDs unique across component instances', () => {
    const first = markerProps();
    const second = markerProps();
    const { container } = render(<svg><OrbitalSkyMarkers {...first} /><OrbitalSkyMarkers {...second} /></svg>);
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const clips = [...container.querySelectorAll('clipPath')].map((node) => node.id);
    expect(clips).toHaveLength(2);
    expect(first.earthRef.current?.querySelector('image')).toHaveAttribute('clip-path', `url(#${clips[0]})`);
    expect(second.earthRef.current?.querySelector('image')).toHaveAttribute('clip-path', `url(#${clips[1]})`);
  });

  it('does not replace an unavailable timestamp with an invented UTC sample', () => {
    const props = markerProps();
    render(<svg><OrbitalSkyMarkers {...props} currentUtc="Time unavailable" /></svg>);
    expect(props.sunRef.current?.querySelector('title')).toHaveTextContent('time unavailable');
    expect(props.sunRef.current?.querySelector('title')).not.toHaveTextContent('1970');
  });
});
