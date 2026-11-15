import { useId } from 'react';
import { formatElevation, type Body } from './geometry';

export interface HorizonDiagramProps {
  body: Body;
  elevationDeg: number;
  azimuthDeg: number;
  siteName: string;
  currentUtc: string;
}

/** A local vertical cross-section, not a terrain profile or a disk visibility test. */
export function HorizonDiagram({ body, elevationDeg, azimuthDeg, siteName, currentUtc }: HorizonDiagramProps) {
  const titleId = useId();
  const descriptionId = useId();
  const bodyName = body === 'sun' ? 'Sun' : 'Earth';
  const radians = elevationDeg * Math.PI / 180;
  const origin = { x: 42, y: 120 };
  const center = { x: origin.x + 96 * Math.cos(radians), y: origin.y - 96 * Math.sin(radians) };
  const position = elevationDeg > 0 ? 'above' : elevationDeg < 0 ? 'below' : 'on';
  const magnitude = Math.abs(elevationDeg);
  const angleWords = magnitude < 0.01 ? 'less than 0.01' : magnitude.toFixed(2);
  const description = elevationDeg === 0
    ? `on the geometric horizon`
    : `${angleWords} degrees ${position} the geometric horizon`;

  return (
    <figure className="explainer-figure">
      <svg
        className="explainer-diagram"
        viewBox="0 0 360 240"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-elevation-deg={elevationDeg}
      >
        <title id={titleId}>{`${bodyName} center ${description} at ${siteName}, ${currentUtc}`}</title>
        <desc id={descriptionId}>
          A line from the observer points toward the calculated center. The horizontal line is the
          geometric horizon at zero degrees. This schematic has no terrain; marker size does not show
          the size of the Sun or Earth. For angles close to zero, use the signed text value.
        </desc>
        <line className="explainer-horizon" x1={origin.x} y1={origin.y} x2={330} y2={origin.y} />
        <text className="explainer-diagram-label" x={330} y={110} textAnchor="end">0° horizon</text>
        <line className="explainer-sightline" x1={origin.x} y1={origin.y} x2={center.x} y2={center.y} />
        <circle className="explainer-observer" cx={origin.x} cy={origin.y} r={2.5} />
        <circle className="explainer-body-center" cx={center.x} cy={center.y} r={5} />
        <text className="explainer-diagram-label" x={center.x + 15} y={center.y - 9}>{bodyName} center</text>
        <text className="explainer-diagram-angle" x={center.x + 15} y={center.y + 16}>
          {formatElevation(elevationDeg)}
        </text>
      </svg>
      <figcaption className="explainer-caption">
        <span>Azimuth {azimuthDeg.toFixed(2)}° clockwise from north</span>
        <span>Schematic · no terrain</span>
        {Math.abs(elevationDeg) <= 1 && <span>Near horizon · use the signed angle</span>}
      </figcaption>
    </figure>
  );
}
