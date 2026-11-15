import React from 'react';
import type { SiteReadout } from './siteReadings';
import './condition-readout.css';

interface ConditionReadoutProps {
  siteName: string;
  readout?: SiteReadout;
  assumptionsSummary?: string;
  details?: React.ReactNode;
}

export function formatConditionsUtc(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'Time not available';
}

/** The selected scenario stays visible; numeric detail and assumptions are optional. */
export const ConditionReadout: React.FC<ConditionReadoutProps> = ({
  siteName, readout, assumptionsSummary, details,
}) => (
  <div className="condition-readout">
    <p className="condition-context">
      <strong>{siteName}</strong>
      {readout?.timestamp ? (
        <time dateTime={readout.timestamp}>{formatConditionsUtc(readout.timestamp)}</time>
      ) : <span>Time not available</span>}
    </p>

    {readout ? (
      <>
        <section className="condition-body" aria-label="Sun reading">
          <h3>Sun <span>{readout.sun.label}</span></h3>
          <p>{readout.energyNote}</p>
        </section>
        <section className="condition-body" aria-label="Earth reading">
          <h3>Earth <span>{readout.earth.label}</span></h3>
          <p>{readout.communicationNote}</p>
        </section>
        <div className="condition-basis">
          <p>{readout.basis}</p>
          {readout.kind === 'geometric' && (
            <p>Approximate directions only; local terrain, energy and relay availability are not assessed.</p>
          )}
          {readout.kind === 'unknown' && <p>Conditions are unavailable for this point and time.</p>}
        </div>
      </>
    ) : (
      <div className="condition-basis">
        <p>Data unavailable</p>
        <p>Sun and Earth conditions are not available for this selection.</p>
      </div>
    )}

    <details className="condition-details condition-assumptions">
      <summary>
        <span className="condition-disclosure-heading">
          <span>Angles, assumptions and sources</span>
          {assumptionsSummary && <span className="condition-assumptions-summary">{assumptionsSummary}</span>}
        </span>
      </summary>
      <div className="condition-detail-content">
        {readout && <>
          {(['sun', 'earth'] as const).map((body) => (
            <section className="condition-detail-body" key={body} aria-label={`${body === 'sun' ? 'Sun' : 'Earth'} angle details`}>
              <h4>{body === 'sun' ? 'Sun' : 'Earth'}</h4>
              <p>{readout[body].detail}</p>
              {readout[body].angle !== null && <p className="condition-angle">{readout[body].angle}</p>}
            </section>
          ))}
          <p className="condition-model-note">{readout.modelNote}</p>
        </>}
        {details}
      </div>
    </details>
  </div>
);
