import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LunarAtlasData } from './lunarTerrainEngine';

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
    vi.restoreAllMocks();
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

class ControlledWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  static action: (worker: ControlledWorker, request: { urls: string[] }) => void;
  static instances: ControlledWorker[] = [];
  terminate = vi.fn();
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(request: { urls: string[] }) { ControlledWorker.action(this, request); }
}

/** Synthetic transport fixture, not NASA or scientific validation data. */
function transportAtlas(): LunarAtlasData {
  return {
    width: 1, height: 1, isRealNasa: true,
    heightKm: new Float32Array([1]), polarWidth: 1, polarHeightKm: new Float32Array([2]),
    albedoRgba: new Uint8Array([1, 2, 3, 255]), topoRgba: new Uint8Array(4),
    normalRgba: new Uint8Array(4), dispRgba: new Uint8Array(4),
    southCapWidth: 1, southCapAlbedoRgba: new Uint8Array(4),
    southCapTopoRgba: new Uint8Array(4), southCapNormalRgba: new Uint8Array(4),
    northCapWidth: 1, northCapAlbedoRgba: new Uint8Array(4),
    northCapTopoRgba: new Uint8Array(4), northCapNormalRgba: new Uint8Array(4),
  };
}

function enableControlledWorker() {
  vi.stubGlobal('Worker', ControlledWorker);
  vi.stubGlobal('OffscreenCanvas', class {});
  vi.stubGlobal('createImageBitmap', vi.fn());
  ControlledWorker.instances = [];
}

function expectWorkerReleased(worker: ControlledWorker) {
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(worker.onmessage).toBeNull();
  expect(worker.onerror).toBeNull();
  expect(worker.onmessageerror).toBeNull();
}

describe('atlas worker lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shares one in-flight worker and caches its returned arrays for both views', async () => {
    enableControlledWorker();
    const atlas = transportAtlas();
    let respond: (() => void) | undefined;
    ControlledWorker.action = (worker, request) => {
      expect(request.urls).toHaveLength(3);
      expect(request.urls.every(url => new URL(url).origin === window.location.origin)).toBe(true);
      respond = () => worker.onmessage?.({ data: { atlas } } as MessageEvent);
    };
    const engine = await freshEngine();
    const first = engine.loadRealNasaLunarAtlas();
    expect(engine.loadRealNasaLunarAtlas()).toBe(first);
    expect(engine.getLoadedRealAtlasSync()).toBeNull();
    respond?.();
    expect(await first).toBe(atlas);
    expect(engine.getLoadedRealAtlasSync()).toBe(atlas);
    expect(await engine.loadRealNasaLunarAtlas()).toBe(atlas);
    expect(ControlledWorker.instances).toHaveLength(1);
    expectWorkerReleased(ControlledWorker.instances[0]);
  });

  it.each(['postMessage', 'error', 'messageerror', 'invalid-response'] as const)(
    'releases the worker after %s failure so the main-thread fallback can run',
    async (failure) => {
      enableControlledWorker();
      vi.stubGlobal('Image', FailingImage);
      FailingImage.created = 0;
      ControlledWorker.action = worker => {
        if (failure === 'postMessage') throw new Error('Could not post');
        if (failure === 'error') worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed', cancelable: true }));
        if (failure === 'messageerror') worker.onmessageerror?.(new MessageEvent('messageerror'));
        if (failure === 'invalid-response') worker.onmessage?.({ data: undefined } as MessageEvent);
      };
      const engine = await freshEngine();
      await expect(engine.loadRealNasaLunarAtlas()).rejects.toThrow(/Failed to load NASA lunar asset/);
      expect(FailingImage.created).toBe(3);
      expectWorkerReleased(ControlledWorker.instances[0]);
    },
  );

  it('falls back when worker construction fails', async () => {
    enableControlledWorker();
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker blocked'); } });
    vi.stubGlobal('Image', FailingImage);
    FailingImage.created = 0;
    const engine = await freshEngine();
    await expect(engine.loadRealNasaLunarAtlas()).rejects.toThrow(/Failed to load NASA lunar asset/);
    expect(FailingImage.created).toBe(3);
  });

  it('does not prefetch on the main thread when createImageBitmap is unavailable', async () => {
    enableControlledWorker();
    vi.stubGlobal('createImageBitmap', undefined);
    const engine = await freshEngine();
    engine.prefetchRealNasaLunarAtlas();
    expect(ControlledWorker.instances).toHaveLength(0);
  });

  it('transfers every distinct atlas buffer once, preserving arrays in the receiver', async () => {
    const engine = await freshEngine();
    const atlas = transportAtlas();
    atlas.normalRgba = atlas.albedoRgba.subarray();
    const transfer = engine.atlasTransferables(atlas);
    expect(new Set(transfer).size).toBe(transfer.length);
    for (const value of Object.values(atlas)) {
      if (ArrayBuffer.isView(value)) expect(transfer).toContain(value.buffer);
    }
    const receiver = structuredClone(atlas, { transfer });
    expect(atlas.heightKm.byteLength).toBe(0);
    expect(Array.from(receiver.heightKm)).toEqual([1]);
    expect(Array.from(receiver.albedoRgba)).toEqual([1, 2, 3, 255]);
    expect(receiver.normalRgba.buffer).toBe(receiver.albedoRgba.buffer);
  });

  it('rejects a canvas decode exception instead of leaving the shared load pending', async () => {
    class LoadedImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4;
      naturalHeight = 2;
      set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Worker', undefined);
    vi.stubGlobal('Image', LoadedImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => { throw new Error('Canvas decode failed'); });
    const engine = await freshEngine();
    await expect(engine.loadRealNasaLunarAtlas()).rejects.toThrow('Canvas decode failed');
    expect(engine.getLoadedRealAtlasSync()).toBeNull();
  });
});

describe('original atlas derivation parity', () => {
  it('preserves every derived map and packed height from the original algorithm', async () => {
    // Synthetic input. Golden byte fingerprints were calculated with the original
    // callback in 43ee289, before its extraction into deriveRealNasaAtlas.
    // This checks algorithm/row registration parity, not independent NASA accuracy.
    const engine = await freshEngine();
    const packed = (values: number[], width: number, height: number) => ({
      width, height,
      data: Uint8ClampedArray.from(values.flatMap(q => [q >> 8, q & 255, 0, 255])),
    });
    const atlas = engine.deriveRealNasaAtlas(
      { width: 4, height: 2, data: Uint8ClampedArray.from([
        24, 40, 56, 255, 64, 80, 96, 255, 104, 120, 136, 255, 144, 160, 176, 255,
        184, 200, 216, 255, 224, 232, 240, 255, 120, 100, 80, 255, 60, 40, 20, 255,
      ]) },
      packed([0, 8192, 16384, 32768, 65535, 49152, 40960, 24576], 4, 2),
      packed([8192, 24576, 40960, 57344], 2, 2),
    );
    expect([atlas.width, atlas.height, atlas.southCapWidth, atlas.northCapWidth]).toEqual([4, 2, 2048, 1024]);
    expect(atlas.heightKm[0]).toBe(-9.5);
    expect(atlas.heightKm[4]).toBe(11);
    const fingerprints: Record<string, string> = {};
    for (const [key, value] of Object.entries(atlas)) {
      if (!ArrayBuffer.isView(value)) continue;
      let fingerprint = 2166136261;
      for (const byte of new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) {
        fingerprint = Math.imul(fingerprint ^ byte, 16777619);
      }
      fingerprints[key] = (fingerprint >>> 0).toString(16);
    }
    expect(fingerprints).toEqual({
      heightKm: '47cffb1e', polarHeightKm: 'c5570888',
      albedoRgba: 'e24a748d', topoRgba: 'd8dd8c5', normalRgba: 'a8513d05', dispRgba: '4acc067c',
      southCapAlbedoRgba: 'ea14fa34', southCapTopoRgba: '61b8a84b', southCapNormalRgba: '59a3d1ff',
      northCapAlbedoRgba: '6175facf', northCapTopoRgba: '1f31129f', northCapNormalRgba: 'cc6059ee',
    });
  }, 30_000);
});
