import React from 'react';
import './scenario-actions.css';

interface ScenarioActionsProps {
  canSearch: boolean;
  hasLaterSamples: boolean;
  jointSatisfied: boolean | null;
  coverageEnd: string;
  earthCriterion: string;
  searchNotice: string | null;
  shareMessage: string | null;
  shareUrl: string | null;
  onFindNext: () => void;
  onShare: () => void;
}

/** Small actions beside the actual conditions, rather than another dashboard. */
export function ScenarioActions({
  canSearch, hasLaterSamples, jointSatisfied, coverageEnd, earthCriterion, searchNotice, shareMessage, shareUrl, onFindNext, onShare,
}: ScenarioActionsProps) {
  return (
    <div className="scenario-actions">
      {canSearch && hasLaterSamples && jointSatisfied !== true && (
        <>
          <button type="button" className="btn-link-sm" onClick={onFindNext}>
            Find next sample with Sun and Earth
          </button>
          <p className="scenario-action-note">
            Checks later hourly samples through {coverageEnd}. Earth criterion: {earthCriterion}.
          </p>
        </>
      )}
      {canSearch && !hasLaterSamples && <p className="scenario-action-note">No later samples remain in this dataset.</p>}
      {searchNotice && <p role="status">{searchNotice}</p>}
      <button type="button" className="btn-link-sm" onClick={onShare}>
        Share this scenario
      </button>
      {shareMessage && <p role="status">{shareMessage}</p>}
      {shareUrl && (
        <label className="scenario-share-field">
          <span>Scenario link</span>
          <input
            aria-label="Scenario link"
            type="url"
            readOnly
            value={shareUrl}
            onFocus={event => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
