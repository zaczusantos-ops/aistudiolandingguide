import React, { useMemo, useState } from 'react';
import { LandingSiteEntry, MissionWindow } from '../navigator/types';
import './home-explainers.css';

interface HomeOverlayProps {
  sites: LandingSiteEntry[];
  horizonAzDeg: number[];
  missionWindow: MissionWindow;
  onStart: (siteId?: string, epochIdx?: number) => void;
  onWalk?: () => void;
}

interface NasaExplainerVideoProps {
  id: 'sunlight' | 'earth-view';
  label: string;
  caption: string;
  description: string;
  sourceUrl: string;
}

const NasaExplainerVideo: React.FC<NasaExplainerVideoProps> = ({
  id, label, caption, description, sourceUrl,
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="section-visual-frame home-video">
      <video
        src={`/assets/lunar/explainers/${id}.mp4`}
        poster={`/assets/lunar/explainers/${id}.jpg`}
        controls
        playsInline
        preload="none"
        muted
        width={1280}
        height={720}
        aria-label={label}
        aria-describedby={`${id}-caption`}
        onError={() => setFailed(true)}
      >
        <track
          kind="captions"
          src={`/assets/lunar/explainers/${id}.vtt`}
          srcLang="en"
          label="English descriptions"
          default
        />
        Your browser cannot play this video. Read the description below or visit the NASA source.
      </video>
      {failed && <p className="home-video-error" role="status">Video unavailable. Read the description below or open the NASA source.</p>}
      <figcaption id={`${id}-caption`} className="home-video-caption">
        {caption}{' '}
        NASA example, not the site or date selected in this app.{' '}
        <a href={sourceUrl}>NASA’s Scientific Visualization Studio</a>.
      </figcaption>
      <details className="home-explainer-details">
        <summary>Read video description</summary>
        <p>{description} Silent, time-compressed NASA visualization.</p>
      </details>
    </figure>
  );
};

const DEG = Math.PI / 180;
const TAN_5_DEG = Math.tan(5 * DEG);

function projectPolarPercent(latDeg: number, lonEastDeg: number): { leftPct: number; topPct: number } {
  const rNorm = Math.min(0.96, Math.tan(((latDeg + 90) * 0.5) * DEG) / TAN_5_DEG);
  const lam = lonEastDeg * DEG;
  return {
    leftPct: 50 + rNorm * 46.5 * Math.sin(lam),
    topPct: 50 - rNorm * 46.5 * Math.cos(lam),
  };
}

function scrollToSection(id: string): void {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
}

function exampleTime(timestamp: string): string {
  return `${new Date(timestamp).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  })} UTC`;
}

export const HomeOverlay: React.FC<HomeOverlayProps> = ({ sites, missionWindow, onStart, onWalk }) => {
  const landmarkSites = useMemo(() => {
    const wantedIds = [
      'shackleton_ridge',
      'malapert_massif',
      'mons_mouton_plateau',
      'haworth_rim',
      'shackleton_psr_floor',
    ];
    const picked = wantedIds
      .map((id) => sites.find((s) => s.id === id))
      .filter((s): s is LandingSiteEntry => Boolean(s));
    return picked.length > 0 ? picked : sites.slice(0, 4);
  }, [sites]);

  const [activeLandmarkId, setActiveLandmarkId] = useState<string>(
    () => landmarkSites[0]?.id ?? sites[0]?.id ?? '',
  );
  const activeLandmark = landmarkSites.find((s) => s.id === activeLandmarkId) ?? landmarkSites[0];
  const craterExample = sites.find((site) => site.id === 'shackleton_psr_floor');
  const earthExample = sites.find((site) => site.id === 'shackleton_ridge');

  return (
    <div className="editorial-landing home-explainers" role="region" aria-label="Lunar South Pole overview">
      <nav className="brief-nav is-dark" aria-label="Primary navigation">
        <button
          type="button"
          className="brief-nav-brand"
          onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}
        >
          LANDING GUIDE
        </button>
        <div className="brief-nav-links">
          <button type="button" className="brief-nav-link" onClick={() => scrollToSection('mission')}>South Pole</button>
          <button type="button" className="brief-nav-link" onClick={() => scrollToSection('energy')}>Sunlight</button>
          <button type="button" className="brief-nav-link" onClick={() => scrollToSection('comms')}>Earth view</button>
        </div>
      </nav>

      {/* Original transparent hero remains over the rotatable 3D Moon. */}
      <header className="hero-section">
        <div className="hero-content">
          <span className="editorial-eyebrow">NASA LRO · LOLA · SPICE DE421</span>
          <h1 className="hero-title">Landing<br />Guide.</h1>
          <p className="hero-subtitle">Choose a place and a date. Explore sunlight and the view of Earth from the lunar surface.</p>
          <div className="hero-actions">
            <button type="button" className="btn-bw-primary" onClick={() => onStart()}>
              <span>Open Explorer</span><span aria-hidden="true">→</span>
            </button>
            {onWalk && <button type="button" className="hero-walk-link" onClick={onWalk}>Moon walk <span aria-hidden="true">→</span></button>}
          </div>
          <p className="hero-drag-hint">Drag the Moon to rotate it</p>
        </div>
        <footer className="hero-bottom-bar">
          <span>2026 LUNAR SOUTH POLE NOTEBOOK</span>
          <button type="button" className="hero-scroll-btn" onClick={() => scrollToSection('mission')}>Scroll to explore ↓</button>
        </footer>
      </header>

      <section id="mission" className="editorial-section section-dark" aria-labelledby="mission-heading">
        <div className="section-container">
          <div className="section-grid">
            <div className="section-copy">
              <span className="section-index">SOUTH POLE · 80°S–90°S</span>
              <h2 id="mission-heading" className="section-heading">A low Sun, an uneven horizon.</h2>
              <p className="section-lead">Near the south pole, a ridge can receive sunlight while a nearby crater floor stays in shadow.</p>
              <p className="section-body">Choose a named location on the map or explore a point of your own. The explorer distinguishes terrain-based results from approximate directions at a chosen point.</p>
              {activeLandmark && (
                <div className="home-landmark-reading" aria-live="polite">
                  <strong>{activeLandmark.name}</strong>
                  <p>Catalogued elevation: {activeLandmark.center.elevation_m.toFixed(0)} m</p>
                  <button type="button" className="home-text-action" onClick={() => onStart(activeLandmark.id)}>Explore this site →</button>
                </div>
              )}
              <details className="home-explainer-details">
                <summary>What does permanent shadow mean?</summary>
                <p>A permanently shadowed region receives no direct sunlight. A dark 30-day sample alone does not establish permanent shadow.</p>
              </details>
            </div>
            <figure className="section-visual-frame">
              <div className="polar-interactive-disc">
                <img
                  src="/assets/lunar/lola_south_pole_hillshade.jpg"
                  alt="NASA LOLA south-pole terrain map from 80 to 90 degrees south, with zero degrees east at the top"
                  className="mission-lola-img-round"
                  loading="lazy"
                  width={1024}
                  height={1024}
                />
                {landmarkSites.map((site) => {
                  const pos = projectPolarPercent(site.center.latitude_deg, site.center.longitude_east_deg);
                  const isActive = site.id === activeLandmark?.id;
                  const shortLabelMap: Record<string, string> = {
                    shackleton_ridge: 'Ridge', malapert_massif: 'Malapert', mons_mouton_plateau: 'Mouton',
                    haworth_rim: 'Haworth', shackleton_psr_floor: 'Shackleton PSR',
                  };
                  return (
                    <button
                      key={site.id}
                      type="button"
                      className={`polar-hotspot ${pos.leftPct < 50 ? 'align-left' : 'align-right'} ${isActive ? 'active' : ''}`}
                      style={{ left: `${pos.leftPct}%`, top: `${pos.topPct}%` }}
                      aria-pressed={isActive}
                      aria-label={`Inspect ${site.name}`}
                      onClick={() => setActiveLandmarkId(site.id)}
                    >
                      <span className="polar-hotspot-dot" aria-hidden="true" />
                      <span className="polar-hotspot-tag">{shortLabelMap[site.id] ?? site.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
              <figcaption className="home-video-caption">NASA LOLA terrain map, used here to locate named sites. This image does not calculate obstructions for a chosen point.</figcaption>
              <label className="home-landmark-select">
                <span>Choose a named site</span>
                <select value={activeLandmark?.id ?? ''} onChange={(event) => setActiveLandmarkId(event.target.value)}>
                  {landmarkSites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}
                </select>
              </label>
            </figure>
          </div>
        </div>
      </section>

      <section id="energy" className="editorial-section section-dark" aria-labelledby="energy-heading">
        <div className="section-container">
          <div className="section-grid home-explainer-row home-explainer-row--video-first">
            <div className="section-copy">
              <span className="section-index">SUNLIGHT &amp; ENERGY</span>
              <h2 id="energy-heading" className="section-heading">What keeps a site in sunlight?</h2>
              <p className="section-lead">The Sun stays low near the lunar poles. Ridges and crater walls change when sunlight reaches the ground.</p>
              <p className="section-body">Sunlight is an opportunity for solar power; usable energy also depends on panels, orientation and storage.</p>
              {craterExample && missionWindow.timestamps_utc[0] && (
                <div className="home-explorer-example">
                  <p>Explorer example · {exampleTime(missionWindow.timestamps_utc[0])}</p>
                  <button type="button" className="home-text-action" onClick={() => onStart(craterExample.id, 0)}>Check the crater floor →</button>
                </div>
              )}
              <details className="home-explainer-details">
                <summary>How to read the explorer</summary>
                <p>At catalogued sites, a terrain model estimates how much of the Sun clears the local horizon. At chosen points, the approximate Sun direction does not include local terrain. Neither result guarantees sufficient power.</p>
              </details>
            </div>
            <NasaExplainerVideo
              id="sunlight"
              label="NASA example: changing shadows near the lunar south pole"
              caption="Changing shadows near the lunar south pole."
              description="In this NASA visualization, shifting sunlight moves shadows across ridges and crater floors."
              sourceUrl="https://svs.gsfc.nasa.gov/4893/"
            />
          </div>
        </div>
      </section>

      <section id="comms" className="editorial-section section-dark" aria-labelledby="comms-heading">
        <div className="section-container">
          <div className="section-grid home-explainer-row">
            <div className="section-copy">
              <span className="section-index">EARTH &amp; COMMUNICATION</span>
              <h2 id="comms-heading" className="section-heading">When can Earth be seen?</h2>
              <p className="section-lead">Earth shifts in the polar sky over time. Nearby terrain can hide the view even when Earth is above a smooth horizon.</p>
              <p className="section-body">A clear direction toward Earth can help communication. A working link also needs a visible ground station, suitable antennas and enough signal.</p>
              {earthExample && missionWindow.timestamps_utc[87] && (
                <div className="home-explorer-example">
                  <p>Explorer example · {exampleTime(missionWindow.timestamps_utc[87])}</p>
                  <button type="button" className="home-text-action" onClick={() => onStart(earthExample.id, 87)}>Check Shackleton Ridge →</button>
                </div>
              )}
              <details className="home-explainer-details">
                <summary>What about the whole Earth and relays?</summary>
                <p>The explorer can use the whole Earth disk above the terrain as a conservative visibility rule. That is not a universal requirement for a radio link. Relay visibility is a model, not a guarantee of an available service.</p>
              </details>
            </div>
            <NasaExplainerVideo
              id="earth-view"
              label="NASA example: Earth and Sun from near Shackleton crater"
              caption="Earth and Sun from a virtual ground-level viewpoint on Shackleton’s rim."
              description="From a fixed virtual viewpoint on Shackleton’s rim, Earth emerges above a distant ridge and changes height in the sky."
              sourceUrl="https://svs.gsfc.nasa.gov/4944/"
            />
          </div>
        </div>
      </section>


    </div>
  );
};
