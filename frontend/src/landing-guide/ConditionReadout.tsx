import React from 'react';
import type { SiteReadout } from './siteReadings';
import './condition-readout.css';

interface ConditionReadoutProps {
  siteName: string;
  readout?: SiteReadout;
}

function utcLabel(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'Time not available';
}

/** Presents the capability-aware reading without inferring extra results from display terrain. */
export const ConditionReadout: React.FC<ConditionReadoutProps> = ({ siteName, readout }) => (
  <div className="condition-readout">
    <p className="condition-context">
      <strong>{siteName}</strong>
      {readout?.timestamp ? (
        <time dateTime={readout.timestamp}>{utcLabel(readout.timestamp)}</time>
      ) : <span>Time not available</span>}
    </p>

    {readout ? (
      <>
        {(['sun', 'earth'] as const).map((body) => (
          <section className="condition-body" key={body} aria-label={body === 'sun' ? 'Sun reading' : 'Earth reading'}>
            <h4>{body === 'sun' ? 'Sun' : 'Earth'} <span>{readout[body].label}</span></h4>
            <p>{readout[body].detail}</p>
            {readout[body].angle !== null && <p className="condition-angle">{readout[body].angle}</p>}
          </section>
        ))}
        <p className="condition-basis">{readout.basis}</p>
        <details className="condition-details">
          <summary>Why does this matter?</summary>
          <p><strong>Energy.</strong> {readout.energyNote}</p>
          <p><strong>Communication.</strong> {readout.communicationNote}</p>
          <p className="condition-model-note">{readout.modelNote}</p>
        </details>
      </>
    ) : (
      <p>Sun and Earth conditions are not available for this selection.</p>
    )}
  </div>
);
