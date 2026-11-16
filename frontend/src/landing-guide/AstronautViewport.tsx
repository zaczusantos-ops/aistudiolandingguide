import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseDebugPose } from './fpv/controlsPose';
import type { ExperienceHandle } from './fpv/types';
import { VirtualJoystick } from './fpv/uiJoystick';
import { EvaluatedSlotEntry } from './state';

interface AstronautViewportProps {
  entries: EvaluatedSlotEntry[];
  activeSlotIdx: number;
  epochIdx: number;
  /** Leaves the Astronaut view (back to Orbit 3D). Also bound to Esc when Pointer Lock is not active. */
  onExit?: () => void;
}

function detectWebGL(): { supported: boolean; isSoftwareGl: boolean } {
  if (typeof document === 'undefined') return { supported: false, isSoftwareGl: true };
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return { supported: false, isSoftwareGl: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      supported: true,
      isSoftwareGl: /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu),
    };
  } catch {
    return { supported: false, isSoftwareGl: true };
  }
}

/**
 * Illustrative lighting: the Sun keeps the dataset azimuth, but its *visual* elevation is fixed
 * so the scene reads like a daylight walk. South Pole sites really see the Sun only ~1–2° up;
 * the overlay tells the user this lighting is illustrative. Earth stays at its dataset position.
 */
export const ILLUSTRATIVE_SUN_ELEVATION_DEG = 10;

/** Same illustrative tremor for both buttons: no magnitude, duration or catalog value is implied. */
const ILLUSTRATIVE_TREMOR = { intensity: 0.7, durationS: 3 } as const;

/** Maximum look rate of the right virtual stick at full deflection (deg/s). */
const STICK_YAW_RATE_DEG_S = 130;
const STICK_PITCH_RATE_DEG_S = 85;

/** Esc presses this soon after a Pointer Lock change only released the lock. */
const ESC_AFTER_UNLOCK_GRACE_MS = 400;

const QUAKE_PILLS = [
  { key: 'nakamura', label: 'Nakamura 1979', className: 'fpv-pill fpv-pill-1' },
  { key: 'lognonne', label: 'Lognonné 2003', className: 'fpv-pill fpv-pill-2' },
] as const;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type GlState = 'pending' | 'ready' | 'unsupported' | 'failed';

/**
 * First-person moonbase walk. The 3D scene lives in ./fpv (terrain, sky, props, controls,
 * experience, loaded on demand); this component mounts it and draws the HTML overlay:
 * two illustrative tremor buttons, twin virtual sticks, the illustrative-lighting note and the
 * way back to Orbit 3D.
 */
export const AstronautViewport: React.FC<AstronautViewportProps> = ({ entries, activeSlotIdx, epochIdx, onExit }) => {
  const activeEntry = entries[activeSlotIdx] ?? entries[0];
  const { site, analysis } = activeEntry;

  const sunAz = site.sky_series.sun_az_deg[epochIdx] ?? 0;
  const sunEl = ILLUSTRATIVE_SUN_ELEVATION_DEG;
  const earthAz = site.sky_series.earth_az_deg[epochIdx] ?? 0;
  const earthEl = site.sky_series.earth_el_deg[epochIdx] ?? 0;
  const datasetSunEl = site.sky_series.sun_el_deg[epochIdx];

  const mountRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<ExperienceHandle | null>(null);
  const skyRef = useRef({ sunAz, sunEl, earthAz, earthEl });
  skyRef.current = { sunAz, sunEl, earthAz, earthEl };
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const [glState, setGlState] = useState<GlState>('pending');

  const seed = hashString(site.id);
  const horizonElevDeg = analysis.terrain.horizonElevDeg;
  const horizonRef = useRef(horizonElevDeg);
  horizonRef.current = horizonElevDeg;
  // Rebuild the scene only when the skyline really changes, not on every new array identity.
  const horizonKey = useMemo(
    () => hashString((horizonElevDeg ?? []).map((v) => v.toFixed(2)).join(',')),
    [horizonElevDeg],
  );

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return undefined;
    const { supported, isSoftwareGl } = detectWebGL();
    if (!supported) {
      setGlState('unsupported');
      return undefined;
    }
    setGlState('pending');
    let cancelled = false;
    let handle: ExperienceHandle | null = null;
    import('./fpv/experience')
      .then(({ createMoonbaseExperience }) => {
        if (cancelled) return;
        const s = skyRef.current;
        handle = createMoonbaseExperience(mountEl, {
          seed,
          lowPower: isSoftwareGl,
          horizonElevDeg: horizonRef.current,
          sunAzDeg: s.sunAz,
          sunElDeg: s.sunEl,
          earthAzDeg: s.earthAz,
          earthElDeg: s.earthEl,
          debugPose: parseDebugPose(window.location.search),
        });
        handleRef.current = handle;
        setGlState('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Astronaut view failed to start', err);
        setGlState('failed');
      });
    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, [seed, horizonKey]);

  useEffect(() => {
    handleRef.current?.setSky(sunAz, sunEl, earthAz, earthEl);
  }, [sunAz, sunEl, earthAz, earthEl, glState]);

  // Esc returns to Orbit 3D — unless it was the press that released Pointer Lock.
  useEffect(() => {
    let lastLockChange = Number.NEGATIVE_INFINITY;
    const onLockChange = () => {
      lastLockChange = performance.now();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.pointerLockElement) return;
      if (performance.now() - lastLockChange < ESC_AFTER_UNLOCK_GRACE_MS) return;
      onExitRef.current?.();
    };
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const lightingDetail =
    `The Sun is drawn ${ILLUSTRATIVE_SUN_ELEVATION_DEG}° above the horizon at its dataset azimuth` +
    (Number.isFinite(datasetSunEl) ? `; dataset Sun elevation at this time: ${datasetSunEl.toFixed(1)}°.` : '.');

  return (
    <div
      className="astronaut-stage"
      data-testid="astronaut-stage"
      role="application"
      aria-label={`First-person walk at ${site.name}. Click the view to look around with the mouse (Esc releases it) or drag to look; W A S D or the arrow keys walk and turn, Shift runs. Esc returns to Orbit 3D.`}
    >
      <div ref={mountRef} className="astronaut-webgl-mount" />

      {(glState === 'unsupported' || glState === 'failed') && (
        <p className="fpv-gl-fallback" role="status">
          The first-person view needs WebGL, which is not available in this browser.
        </p>
      )}

      <div className="fpv-quake-pills" role="group" aria-label="Illustrative tremor demos, not catalog data">
        {QUAKE_PILLS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={pill.className}
            aria-label={`${pill.label}: plays an illustrative camera tremor only, not catalog data`}
            title="Illustrative camera tremor only, not catalog data"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              handleRef.current?.triggerTremor(ILLUSTRATIVE_TREMOR.intensity, ILLUSTRATIVE_TREMOR.durationS)
            }
          >
            {pill.label}
          </button>
        ))}
      </div>

      <VirtualJoystick side="left" onChange={(x, y) => handleRef.current?.setMoveVector(x, y)} />
      <VirtualJoystick
        side="right"
        onHold={(x, y, dt) =>
          handleRef.current?.addLook(
            x * Math.abs(x) * STICK_YAW_RATE_DEG_S * dt,
            y * Math.abs(y) * STICK_PITCH_RATE_DEG_S * dt,
          )
        }
      />

      <div className="fpv-corner">
        {onExit && (
          <button
            type="button"
            className="fpv-exit"
            aria-label="Return to Orbit 3D view"
            title="Return to Orbit 3D (Esc)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onExit}
          >
            <span aria-hidden="true">←</span>
            <span>Orbit 3D</span>
          </button>
        )}
        <p className="fpv-lighting-note" title={`Illustrative lighting. ${lightingDetail}`}>
          Illustrative lighting
          <span className="fpv-sr-only">: {lightingDetail}</span>
        </p>
      </div>
    </div>
  );
};
