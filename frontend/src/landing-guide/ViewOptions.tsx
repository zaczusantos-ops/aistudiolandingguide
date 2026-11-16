import React from 'react';
import type { SurfaceMode } from './lunarTerrainEngine';

interface ViewOptionsProps {
  surfaceMode: SurfaceMode;
  onChangeSurface: (mode: SurfaceMode) => void;
  onClose: () => void;
}

export function ViewOptions({ surfaceMode, onChangeSurface, onClose }: ViewOptionsProps) {
  return (
    <section className="popover-card clean-view-options" role="dialog" aria-label="View options">
      <div className="popover-head">
        <h2>View</h2>
        <button type="button" className="btn-close-panel" onClick={onClose} aria-label="Close view options">Close</button>
      </div>
      <label className="field-block">
        <span>Surface layer</span>
        <select aria-label="Surface layer" value={surfaceMode} onChange={event => onChangeSurface(event.target.value as SurfaceMode)}>
          <option value="realistic">Moon imagery</option>
          <option value="topography">Topography</option>
        </select>
      </label>
      <p className="condition-source-note">Rendered relief is visual context. The selected view does not change the calculation model.</p>
      <p className="condition-source-note">Sun and Earth follow the selected time. Sizes and distances are not to scale. Use Conditions for local visibility.</p>
      <p className="condition-source-note">Earth map: NASA Blue Marble. Sun image: NASA/SDO HMI visible-light continuum. These are static textures; surface appearance and orientation are illustrative.</p>
    </section>
  );
}
