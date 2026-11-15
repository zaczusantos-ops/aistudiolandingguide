import { afterEach, describe, expect, it, vi } from 'vitest';

class FailingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  static created = 0;
  constructor() {
    FailingImage.created += 1;
  }
  set src(_url: string) {
    setTimeout(() => this.onerror?.(), 0);
  }
}

class ErroringWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  static created: ErroringWorker[] = [];
  constructor() {
    ErroringWorker.created.push(this);
  }
  postMessage() {
    setTimeout(() => this.onmessage?.({ data: { error: 'decode failed' } } as MessageEvent), 0);
  }
  terminate() {
    this.terminated = true;
  }
}

async function freshEngine() {
  vi.resetModules();
  return import('./lunarTerrainEngine');
}

describe('shared NASA atlas loader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FailingImage.created = 0;
    ErroringWorker.created = [];
  });

  it('clears a rejected load so the orbital or astronaut view can retry without a reload', async () => {
    vi.stubGlobal('Image', FailingImage);
    const engine = await freshEngine();
    const first = engine.loadRealNasaLunarAtlas();
    expect(engine.loadRealNasaLunarAtlas()).toBe(first);
    await expect(first).rejects.toThrow(/Failed to load NASA lunar asset/);
    expect(engine.getLoadedRealAtlasSync()).toBeNull();

    const retry = engine.loadRealNasaLunarAtlas();
    expect(retry).not.toBe(first);
    await expect(retry).rejects.toThrow();
    expect(FailingImage.created).toBe(6);
  });

  it('falls back to the original main thread decode when the worker reports a failure', async () => {
    vi.stubGlobal('Image', FailingImage);
    vi.stubGlobal('Worker', ErroringWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('unused')));
    const engine = await freshEngine();
    await expect(engine.loadRealNasaLunarAtlas()).rejects.toThrow(/Failed to load NASA lunar asset/);
    expect(ErroringWorker.created).toHaveLength(1);
    expect(ErroringWorker.created[0].terminated).toBe(true);
    expect(FailingImage.created).toBe(3);
  });

  it('only prefetches when the atlas can be built off the main thread', async () => {
    vi.stubGlobal('Image', FailingImage);
    const engine = await freshEngine();
    engine.prefetchRealNasaLunarAtlas();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(FailingImage.created).toBe(0);
  });
});
