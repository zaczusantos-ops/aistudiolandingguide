import React, { useEffect, useRef } from 'react';

/** Fraction of the ring radius ignored around the centre. */
export const STICK_DEAD_ZONE = 0.1;

/**
 * Converts a pointer offset from the ring centre (screen px, y down) into a stick vector:
 * x = right, y = up/forward, magnitude clamped to 1, with a rescaled dead zone.
 */
export function stickVector(dx: number, dy: number, radius: number): { x: number; y: number } {
  if (!(radius > 0) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { x: 0, y: 0 };
  let x = dx / radius;
  let y = -dy / radius;
  const mag = Math.hypot(x, y);
  if (mag <= STICK_DEAD_ZONE) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
  x = (x / mag) * scaled;
  y = (y / mag) * scaled;
  return { x, y };
}

export interface VirtualJoystickProps {
  side: 'left' | 'right';
  /** Called whenever the stick moves, and with (0, 0) when released. */
  onChange?: (x: number, y: number) => void;
  /** Called every animation frame while the stick is held (rate-based look). */
  onHold?: (x: number, y: number, dtS: number) => void;
}

/**
 * Faint thin ring like the reference video's twin sticks. Pointer-driven (touch, pen or mouse);
 * keyboard users have WASD/arrow keys, so the sticks are hidden from assistive technology.
 */
export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({ side, onChange, onHold }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef({ onChange, onHold });
  cbRef.current = { onChange, onHold };
  const st = useRef({ pointerId: null as number | null, x: 0, y: 0, raf: 0, last: 0 });

  useEffect(() => {
    const s = st.current;
    return () => {
      cancelAnimationFrame(s.raf);
      if (s.pointerId !== null) cbRef.current.onChange?.(0, 0);
    };
  }, []);

  const setKnob = (px: number, py: number) => {
    const knob = knobRef.current;
    if (knob) knob.style.transform = `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  };

  const track = (clientX: number, clientY: number) => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = clientX - (rect.left + radius);
    const dy = clientY - (rect.top + rect.height / 2);
    const v = stickVector(dx, dy, radius);
    st.current.x = v.x;
    st.current.y = v.y;
    const reach = Math.min(1, Math.hypot(dx, dy) / Math.max(1, radius));
    const ang = Math.atan2(dy, dx);
    setKnob(Math.cos(ang) * reach * radius * 0.72, Math.sin(ang) * reach * radius * 0.72);
    cbRef.current.onChange?.(v.x, v.y);
  };

  const loop = (now: number) => {
    const s = st.current;
    s.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - s.last) / 1000));
    s.last = now;
    if (s.x !== 0 || s.y !== 0) cbRef.current.onHold?.(s.x, s.y, dt);
  };

  const release = (pointerId: number) => {
    const s = st.current;
    if (s.pointerId !== pointerId) return;
    s.pointerId = null;
    s.x = 0;
    s.y = 0;
    cancelAnimationFrame(s.raf);
    rootRef.current?.classList.remove('is-active');
    setKnob(0, 0);
    cbRef.current.onChange?.(0, 0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (s.pointerId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    s.pointerId = e.pointerId;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* best-effort */
    }
    e.currentTarget.classList.add('is-active');
    track(e.clientX, e.clientY);
    if (cbRef.current.onHold) {
      s.last = performance.now();
      cancelAnimationFrame(s.raf);
      s.raf = requestAnimationFrame(loop);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== st.current.pointerId) return;
    e.preventDefault();
    track(e.clientX, e.clientY);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => release(e.pointerId);

  return (
    <div
      ref={rootRef}
      className={`fpv-stick fpv-stick-${side}`}
      data-testid={`fpv-stick-${side}`}
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div ref={knobRef} className="fpv-stick-knob" />
    </div>
  );
};
