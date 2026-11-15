import React, { useId } from 'react';
import './orbital-sky.css';

interface OrbitalSkyMarkersProps {
  sunRef: React.Ref<SVGGElement>;
  earthRef: React.Ref<SVGGElement>;
  siteName: string;
  currentUtc: string;
}

function markerTime(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'time unavailable';
}

/**
 * Passive SVG artwork only. The viewport owns projection, clipping and readiness.
 * Refs let its existing draw loop update positions without React state per frame.
 */
export function OrbitalSkyMarkers({ sunRef, earthRef, siteName, currentUtc }: OrbitalSkyMarkersProps) {
  const instanceId = useId().replace(/:/g, '');
  const earthClipId = `orbital-earth-clip-${instanceId}`;
  const context = `${siteName || 'Selected point'} at ${markerTime(currentUtc)}`;

  return (
    <>
      <defs>
        <clipPath id={earthClipId}>
          <circle cx={0} cy={0} r={18} />
        </clipPath>
      </defs>
      {(['sun', 'earth'] as const).map((body) => {
        const name = body === 'sun' ? 'Sun' : 'Earth';
        const titleId = `orbital-${body}-title-${instanceId}`;
        const descriptionId = `orbital-${body}-description-${instanceId}`;
        const viewDescriptionId = `orbital-${body}-view-${instanceId}`;
        return (
          <g
            key={body}
            ref={body === 'sun' ? sunRef : earthRef}
            className={`orbital-direction orbital-direction--${body}`}
            data-body={body}
            data-site={siteName}
            data-utc={currentUtc}
            visibility="hidden"
            pointerEvents="none"
            focusable="false"
            role="img"
            aria-labelledby={titleId}
            aria-describedby={`${descriptionId} ${viewDescriptionId}`}
          >
            <title id={titleId}>{name} direction from {context}</title>
            <desc id={descriptionId}>
              Direction in the current camera view; size and distance are not to scale.
              An edge arrow, when shown, indicates a direction outside the camera view.
              This marker does not establish local visibility, usable power or a radio link.
              {body === 'earth'
                ? ' The NASA/NOAA Blue Marble 2012 composite is illustrative, not the phase, orientation or surface appearance at the selected time.'
                : ' The Sun disk is a schematic direction symbol.'}
            </desc>
            <desc id={viewDescriptionId} className="direction-view-description" />
            <line className="direction-line" visibility="hidden" />
            <line className="direction-leader" visibility="hidden" />
            <g className="direction-marker">
              {body === 'sun' ? (
                <circle className="direction-sun-disk" cx={0} cy={0} r={16} aria-hidden="true" />
              ) : (
                <g className="direction-earth-disk" aria-hidden="true">
                  <circle className="direction-earth-base" cx={0} cy={0} r={18} />
                  <image
                    href="/assets/lunar/earth-direction.jpg"
                    x={-18}
                    y={-18}
                    width={36}
                    height={36}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#${earthClipId})`}
                    focusable="false"
                  />
                  <circle className="direction-earth-outline" cx={0} cy={0} r={18} />
                </g>
              )}
              <path
                className="direction-edge-arrow"
                d="M 24 -5 L 30 0 L 24 5"
                visibility="hidden"
                aria-hidden="true"
              />
            </g>
            <text className="direction-label" x={24} y={5} textAnchor="start" aria-hidden="true">
              <tspan className="direction-name">{name} direction</tspan>
              <tspan className="direction-view-note" x={24} dy={18} />
            </text>
          </g>
        );
      })}
    </>
  );
}
