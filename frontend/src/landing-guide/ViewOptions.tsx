import React from 'react';
import type { SurfaceMode } from './lunarTerrainEngine';
import type { ViewportMode } from './state';

interface ViewOptionsProps {
  viewportMode: ViewportMode;
  surfaceMode: SurfaceMode;
  onChangeViewport: (mode: ViewportMode) => void;
  onChangeSurface: (mode: SurfaceMode) => void;
  onClose: () => void;
}

export function ViewOptions({ viewportMode, surfaceMode, onChangeViewport, onChangeSurface, onClose }: ViewOptionsProps) {
  return (
    <section className="popover-card clean-view-options" role="dialog" aria-label="View options">
      <div className="popover-head">
        <h2>View</h2>
        <button type="button" className="btn-close-panel" onClick={onClose} aria-label="Close view options">Close</button>
      </div>
      <label className="field-block">
        <span>Perspective</span>
        <select aria-label="Perspective" value={viewportMode} onChange={event => onChangeViewport(event.target.value as ViewportMode)}>
          <option value="3d">Moon globe</option>
          <option value="astronaut">Surface walk (illustrative)</option>
        </select>
      </label>
      <label className="field-block">
        <span>Surface layer</span>
        <select aria-label="Surface layer" value={surfaceMode} onChange={event => onChangeSurface(event.target.value as SurfaceMode)}>
          <option value="realistic">Moon imagery</option>
          <option value="topography">Topography</option>
        </select>
      </label>
      <p className="condition-source-note">Rendered relief is visual context. The selected view does not change the calculation model.</p>
      <p className="condition-source-note">Sun and Earth symbols show directions, not a view from the ground. Use Conditions for local visibility.</p>
      <p className="condition-source-note">Orbital Earth illustration: <a href="https://images.nasa.gov/details/GSFC_20171208_Archive_e001788" target="_blank" rel="noreferrer">NASA/NOAA Blue Marble</a>, a static composite image.</p>
    </section>
  );
}
