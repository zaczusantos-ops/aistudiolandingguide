import React, { useEffect, useId, useRef, useState } from 'react';
import type { LandingSiteEntry } from '../navigator/types';
import {
  EvaluatedSlotEntry,
  MAX_SITE_SLOTS,
  SelectionMode,
} from './state';
import './selection-clean.css';

interface SelectionPopoverProps {
  sites: LandingSiteEntry[];
  entries: EvaluatedSlotEntry[];
  activeSlotIdx: number;
  selectionMode: SelectionMode;
  reticleCoords: { latDeg: number; lonEastDeg: number };
  coverageNotice: string | null;
  onChangeSelectionMode: (mode: SelectionMode) => void;
  onSelectActiveSlot: (index: number) => void;
  onAssignSiteAt: (slotIdx: number, siteId: string) => void;
  onPickCustomCoords: (latDeg: number, lonEastDeg: number, slotIdx: number) => void;
  onAddSlot: () => void;
  onRemoveSlot: (slotIdx: number) => void;
  onSwapFirstTwo: () => void;
  onFixReticleToActive: () => void;
  onCompareWithPsr: () => void;
  onKeepOnlyOne: () => void;
  onClose: () => void;
}

interface CoordinateDraft {
  pointKey: string;
  latitude: string;
  longitude: string;
  error?: { field: 'latitude' | 'longitude'; message: string };
}

function CoordinateForm({
  entry,
  slotIdx,
  onPick,
}: {
  entry: EvaluatedSlotEntry;
  slotIdx: number;
  onPick: SelectionPopoverProps['onPickCustomCoords'];
}) {
  const id = useId();
  const latitudeRef = useRef<HTMLInputElement>(null);
  const longitudeRef = useRef<HTMLInputElement>(null);
  const initialLatitude = String(entry.site.center.latitude_deg);
  const initialLongitude = String(entry.site.center.longitude_east_deg);
  const pointKey = `${entry.label}:${entry.site.id}:${initialLatitude}:${initialLongitude}`;
  const initialDraft: CoordinateDraft = {
    pointKey,
    latitude: initialLatitude,
    longitude: initialLongitude,
  };
  const [draft, setDraft] = useState<CoordinateDraft>(initialDraft);
  // A new selected point gets its own values immediately. Playback rerenders do
  // not overwrite edits, and switching slots never applies another slot's draft.
  const current = draft.pointKey === pointKey ? draft : initialDraft;
  const latitudeError = current.error?.field === 'latitude';
  const longitudeError = current.error?.field === 'longitude';

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const latitude = current.latitude.trim() === '' ? Number.NaN : Number(current.latitude);
    const longitude = current.longitude.trim() === '' ? Number.NaN : Number(current.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      setDraft({ ...current, error: { field: 'latitude', message: 'Enter a latitude from -90 to 90 degrees.' } });
      latitudeRef.current?.focus();
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -360 || longitude > 360) {
      setDraft({ ...current, error: { field: 'longitude', message: 'Enter an east longitude from -360 to 360 degrees.' } });
      longitudeRef.current?.focus();
      return;
    }
    setDraft({ ...current, error: undefined });
    onPick(latitude, longitude, slotIdx);
  };

  return (
    <form className="selection-coordinate-form" aria-label="Coordinates" onSubmit={submit} noValidate>
      <div className="selection-coordinate-fields">
        <label className="field-block">
          <span>Latitude (degrees)</span>
          <input
            ref={latitudeRef}
            type="number"
            min={-90}
            max={90}
            step="any"
            required
            value={current.latitude}
            aria-invalid={latitudeError || undefined}
            aria-describedby={latitudeError ? `${id}-bounds ${id}-error` : `${id}-bounds`}
            onChange={(event) => setDraft({ ...current, latitude: event.target.value, error: undefined })}
          />
        </label>
        <label className="field-block">
          <span>Longitude east (degrees)</span>
          <input
            ref={longitudeRef}
            type="number"
            min={-360}
            max={360}
            step="any"
            required
            value={current.longitude}
            aria-invalid={longitudeError || undefined}
            aria-describedby={longitudeError ? `${id}-bounds ${id}-error` : `${id}-bounds`}
            onChange={(event) => setDraft({ ...current, longitude: event.target.value, error: undefined })}
          />
        </label>
      </div>
      <p id={`${id}-bounds`} className="muted-caption">
        Latitude -90 to 90. Longitude -360 to 360; positive east, negative west.
      </p>
      {current.error && <p id={`${id}-error`} className="selection-error" role="alert">{current.error.message}</p>}
      <div>
        <button type="submit" className="btn-primary-sm">Use coordinates</button>
      </div>
      <p className="muted-caption">
        Free points use approximate sky geometry; local terrain is not assessed.
      </p>
    </form>
  );
}

export const SelectionPopover: React.FC<SelectionPopoverProps> = ({
  sites,
  entries,
  activeSlotIdx,
  coverageNotice,
  onSelectActiveSlot,
  onAssignSiteAt,
  onPickCustomCoords,
  onAddSlot,
  onRemoveSlot,
  onKeepOnlyOne,
  onClose,
}) => {
  const titleId = useId();
  const siteSelectRef = useRef<HTMLSelectElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const safeActiveIdx = Math.max(0, Math.min(entries.length - 1, activeSlotIdx));
  const activeEntry = entries[safeActiveIdx];
  const comparing = entries.length > 1;
  const currentIsNamed = sites.some((site) => site.id === activeEntry?.site.id);

  useEffect(() => {
    // StrictMode replays effects during development. Keep the opening control,
    // rather than replacing it with the select focused by the first run.
    if (returnFocusRef.current === null) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    siteSelectRef.current?.focus({ preventScroll: true });
  }, []);

  const close = () => {
    onClose();
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
  };

  return (
    <section
      className="popover-card selection-popover selection-clean"
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="popover-head">
        <h2 id={titleId}>Choose a place</h2>
        <button type="button" className="btn-close-panel" onClick={close} aria-label="Close site selection">
          Close
        </button>
      </div>

      {comparing && (
        <div className="selection-comparison" role="group" aria-label="Places to compare">
          {entries.map((entry, index) => (
            <div className="selection-place-row" key={entry.label}>
              <button
                type="button"
                className="selection-place-pick"
                aria-label={`Edit place ${entry.label}: ${entry.site.name}`}
                aria-pressed={index === safeActiveIdx}
                onClick={() => onSelectActiveSlot(index)}
              >
                <span className="selection-place-label">{entry.label}</span>
                <span>{entry.site.name}</span>
              </button>
              <button
                type="button"
                className="selection-place-remove"
                aria-label={`Remove place ${entry.label}: ${entry.site.name}`}
                onClick={() => onRemoveSlot(index)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {activeEntry ? (
        <>
          <label className="field-block">
            <span>Named sites</span>
            <select
              ref={siteSelectRef}
              value={activeEntry.site.id}
              onChange={(event) => onAssignSiteAt(safeActiveIdx, event.target.value)}
            >
              {!currentIsNamed && <option value={activeEntry.site.id}>{activeEntry.site.name}</option>}
              {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
          </label>

          <details className="selection-coordinate-disclosure">
            <summary>Enter coordinates</summary>
            <CoordinateForm entry={activeEntry} slotIdx={safeActiveIdx} onPick={onPickCustomCoords} />
          </details>
        </>
      ) : <p className="muted-caption">No place is selected.</p>}

      {coverageNotice && <p className="muted-caption" role="status">{coverageNotice}</p>}

      <div className="selection-comparison-actions">
        {entries.length < MAX_SITE_SLOTS && (
          <button type="button" className="btn-link-sm" onClick={onAddSlot}>
            {comparing ? 'Add place' : 'Compare places'}
          </button>
        )}
        {comparing && (
          <button type="button" className="btn-link-sm" onClick={onKeepOnlyOne}>
            Keep only this place
          </button>
        )}
      </div>
    </section>
  );
};
