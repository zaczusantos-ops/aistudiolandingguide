import { getConditions, type Body, type ExplorerSite } from './geometry';
import { HorizonDiagram } from './HorizonDiagram';
import './explanation.css';

export interface ExplanationProps {
  topic: Body;
  site: ExplorerSite;
  epochIdx: number;
  currentUtc: string;
}

export function Explanation({ topic, site, epochIdx, currentUtc }: ExplanationProps) {
  const condition = getConditions(site, epochIdx)[topic];
  const bodyName = topic === 'sun' ? 'Sun' : 'Earth';
  const positionText = condition.position === 'on'
    ? 'on the geometric horizon'
    : `${condition.position} the geometric horizon`;

  return (
    <section className="explainer" aria-label={topic === 'sun' ? 'Sunlight and energy explanation' : 'Earth visibility and communication explanation'}>
      <p className="explainer-reading">
        {bodyName}’s center is {positionText}
        {condition.nearHorizon && condition.position !== 'on'
          ? '; this does not describe the whole disk.'
          : '.'}
        {' '}
        {topic === 'sun'
          ? 'Solar panels need sunlight; terrain shadows and power output are not calculated here.'
          : 'A radio link needs a clear path to an Earth station; this view does not check that link.'}
      </p>

      <HorizonDiagram
        body={topic}
        elevationDeg={condition.elevationDeg}
        azimuthDeg={condition.azimuthDeg}
        siteName={site.name}
        currentUtc={currentUtc}
      />

      <details className="explainer-details">
        <summary>{topic === 'sun' ? 'How sunlight becomes energy' : 'What a radio link needs'}</summary>
        <p>
          The geometric horizon is a smooth reference that ignores mountains and crater rims.
          Near this line, the edge of the {bodyName} can be above the horizon even when its center is below.
        </p>
        <p>
          {topic === 'sun'
            ? 'Sunlight is an input to solar power, not an electrical output. Panel direction, efficiency, temperature, dust and battery storage affect usable energy. No battery size or continuous power is predicted.'
            : 'An Earth ground station must be visible, the antenna must point correctly, and the signal must be strong enough. A relay might help when Earth is blocked, but relay coverage is not evaluated here.'}
        </p>
      </details>
    </section>
  );
}
