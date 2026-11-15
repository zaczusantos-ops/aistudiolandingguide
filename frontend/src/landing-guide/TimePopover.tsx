import React, { useEffect, useId, useState } from 'react';
import { parseUtcInput } from '../explorer/scenario';
import {
  DURATION_OPTIONS,
  DurationDays,
  formatUtcShort,
  getDateHourFromIso,
  PlaybackSpeed,
  SPEED_OPTIONS,
  WindowSlice,
} from './state';
import './time-clean.css';

interface TimePopoverProps {
  timestampsUtc: string[];
  epochIdx: number;
  startIdx: number;
  durationDays: DurationDays;
  slice: WindowSlice;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  onChangeStartIdx: (idx: number) => void;
  onChangeEpochIdx: (idx: number) => void;
  onChangeDuration: (days: DurationDays) => void;
  onTogglePlay: () => void;
  onResetTime: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onClose: () => void;
}

export const TimePopover: React.FC<TimePopoverProps> = ({
  timestampsUtc,
  epochIdx,
  startIdx,
  durationDays,
  slice,
  isPlaying,
  speed,
  onChangeStartIdx,
  onChangeEpochIdx,
  onChangeDuration,
  onResetTime,
  onChangeSpeed,
  onClose,
}) => {
  const currentIso = timestampsUtc[epochIdx];
  const initialParsed = getDateHourFromIso(currentIso ?? '');
  const [dateInput, setDateInput] = useState<string>(initialParsed.date);
  const [hourInput, setHourInput] = useState<string>(currentIso ? String(initialParsed.hour) : '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const errorId = useId();
  const sampleHelpId = useId();
  const periodStartIso = timestampsUtc[startIdx];
  const periodEndIso = timestampsUtc[slice.endIdx];
  const oneInstant = slice.startIdx === slice.endIdx;

  useEffect(() => {
    const synced = getDateHourFromIso(currentIso ?? '');
    setDateInput(synced.date);
    setHourInput(currentIso ? String(synced.hour) : '');
    setValidationError(null);
  }, [currentIso]);

  const applyUtcInputs = (nextDate: string, nextHourRaw: string) => {
    const result = parseUtcInput(nextDate, nextHourRaw, timestampsUtc);
    if (!result.valid) {
      setValidationError(result.error);
      return;
    }
    setValidationError(null);
    // Selecting an instant inside the period does not move its start. An exact
    // sample outside it opens a new period so the parent never clamps the choice.
    if (result.epochIdx < slice.startIdx || result.epochIdx > slice.endIdx) {
      onChangeStartIdx(result.epochIdx);
    }
    onChangeEpochIdx(result.epochIdx);
  };

  const handleReset = () => {
    setValidationError(null);
    const first = getDateHourFromIso(timestampsUtc[0] ?? '');
    setDateInput(first.date);
    setHourInput(timestampsUtc[0] ? String(first.hour) : '');
    onResetTime();
  };

  const exactUtc = (iso: string | undefined) => iso ? iso.replace('T', ' ').replace('Z', ' UTC') : 'Unavailable';

  return (
    <section
      className="popover-card time-popover time-clean"
      role="dialog"
      aria-label="UTC time and analysis period"
    >
      <div className="popover-head">
        <div>
          <h2>Time (UTC)</h2>
        </div>
        <button
          type="button"
          className="btn-close-panel"
          onClick={onClose}
          aria-label="Close time controls"
        >
          Close
        </button>
      </div>

      <div className="time-current-banner">
        <span>At this time</span>
        {currentIso ? <time dateTime={currentIso}>{formatUtcShort(currentIso)}</time> : <span>Time unavailable</span>}
      </div>

      <div className="time-fields-row">
        <label className="field-block">
          <span>Date (UTC)</span>
          <input
            type="date"
            aria-label="Date (UTC)"
            value={dateInput}
            min={timestampsUtc[0]?.slice(0, 10)}
            max={timestampsUtc[timestampsUtc.length - 1]?.slice(0, 10)}
            disabled={timestampsUtc.length === 0}
            aria-invalid={validationError ? true : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(e) => {
              const v = e.target.value;
              setDateInput(v);
              applyUtcInputs(v, hourInput);
            }}
          />
        </label>

        <label className="field-block field-hour">
          <span>Hour (0–23 UTC)</span>
          <input
            type="number"
            aria-label="Hour (0–23 UTC)"
            min={0}
            max={23}
            step={1}
            value={hourInput}
            disabled={timestampsUtc.length === 0}
            aria-invalid={validationError ? true : undefined}
            aria-describedby={validationError ? errorId : undefined}
            onChange={(e) => {
              const v = e.target.value;
              setHourInput(v);
              applyUtcInputs(dateInput, v);
            }}
          />
        </label>
      </div>

      {validationError && (
        <p className="time-validation" id={errorId} role="alert">{validationError} The confirmed time above is unchanged.</p>
      )}

      <label className="field-block">
        <span>Saved time in the analysis period</span>
        <input
          type="range"
          aria-label="UTC sample timeline"
          aria-valuetext={currentIso ? formatUtcShort(currentIso) : 'Time unavailable'}
          aria-describedby={sampleHelpId}
          min={slice.startIdx}
          max={slice.endIdx}
          step={1}
          value={epochIdx}
          disabled={oneInstant || timestampsUtc.length === 0}
          onChange={(e) => onChangeEpochIdx(Number(e.target.value))}
        />
        <span id={sampleHelpId}>One step selects one saved sample.</span>
      </label>

      <details className="time-period-details">
        <summary>Analysis period and playback</summary>
        <div className="time-period-content">
          <label className="field-block">
            <span>Analysis period duration</span>
            <select
              aria-label="Analysis period duration"
              value={durationDays}
              onChange={(event) => {
                const days = Number(event.target.value) as DurationDays;
                if (DURATION_OPTIONS.includes(days)) onChangeDuration(days);
              }}
            >
              {DURATION_OPTIONS.map(days => <option key={days} value={days}>{days} {days === 1 ? 'day' : 'days'}</option>)}
            </select>
          </label>
          <dl className="time-period-bounds">
            <div><dt>Period starts</dt><dd><time dateTime={periodStartIso}>{exactUtc(periodStartIso)}</time></dd></div>
            <div><dt>Period ends</dt><dd><time dateTime={periodEndIso}>{exactUtc(periodEndIso)}</time></dd></div>
          </dl>
          <p className="time-period-note">
            {oneInstant ? 'One saved instant; period totals are not assessed.'
              : `${slice.totalHours} hours between saved endpoints. Conditions above describe the selected instant.`}
          </p>
          {slice.clampedByEnd && <p className="time-period-note">This period ends at the last saved sample.</p>}
          <label className="field-block">
            <span>Playback speed</span>
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(event) => {
                const nextSpeed = Number(event.target.value) as PlaybackSpeed;
                if (SPEED_OPTIONS.includes(nextSpeed)) onChangeSpeed(nextSpeed);
              }}
            >
              {SPEED_OPTIONS.map(step => <option key={step} value={step}>{step} {step === 1 ? 'hour' : 'hours'} per step</option>)}
            </select>
          </label>
          <p className="time-period-note">Playback is {isPlaying ? 'running' : 'paused'}. Use {isPlaying ? 'Pause' : 'Play'} in the main view.</p>
          <button type="button" className="btn-link-sm time-reset" onClick={handleReset}>Reset time and analysis period</button>
        </div>
      </details>

      <p className="honest-note">
        Times are UTC. Conditions use the selected point's stated model. Rendered relief is visual context.
      </p>
    </section>
  );
};
