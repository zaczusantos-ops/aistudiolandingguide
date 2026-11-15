import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, DataTexture, Group, Mesh, MeshBasicMaterial } from 'three';
import { createMoonbaseExperience } from './experience';
import type { ExperienceOptions } from './types';

interface RendererStub {
  domElement: HTMLCanvasElement;
  setPixelRatio: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  forceContextLoss: ReturnType<typeof vi.fn>;
}

const mock = vi.hoisted(() => ({
  renderFailure: null as Error | null,
  observeFailure: null as Error | null,
  renderers: [] as RendererStub[],
  observers: [] as Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>,
  configure: vi.fn(), ground: vi.fn(), sky: vi.fn(), base: vi.fn(), controller: vi.fn(),
}));
vi.mock('three', async importOriginal => {
  const original = await importOriginal<typeof import('three')>();
  return {
    ...original,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = vi.fn(() => { if (mock.renderFailure) throw mock.renderFailure; });
      dispose = vi.fn();
      forceContextLoss = vi.fn();
      constructor() { mock.renderers.push(this); }
    },
  };
});
vi.mock('./controls', () => ({ createFirstPersonController: mock.controller }));
vi.mock('./props', () => ({ createMoonbase: mock.base }));
vi.mock('./sky', () => ({ configureRenderer: mock.configure, createLunarSky: mock.sky }));
vi.mock('./terrain', () => ({ createLunarGround: mock.ground }));

function makeGround() {
  const object = new Group();
  const geometry = new BoxGeometry();
  const texture = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  const material = new MeshBasicMaterial({ map: texture });
  object.add(new Mesh(geometry, material));
  return {
    object, heightAt: () => 0, setSunDirection: vi.fn(), dispose: vi.fn(),
    geometryDispose: vi.spyOn(geometry, 'dispose'), materialDispose: vi.spyOn(material, 'dispose'),
    textureDispose: vi.spyOn(texture, 'dispose'),
  };
}
const makeSky = () => ({ object: new Group(), setSunDirection: vi.fn(), setEarthDirection: vi.fn(), dispose: vi.fn() });
const makeBase = () => ({ object: new Group(), colliders: [], spawn: { x: 0, z: 0, yawDeg: 0, pitchDeg: 0 }, dispose: vi.fn() });
const makeController = () => ({ update: vi.fn(), setMoveVector: vi.fn(), addLook: vi.fn(), triggerTremor: vi.fn(), dispose: vi.fn() });

const grounds: ReturnType<typeof makeGround>[] = [];
const skies: ReturnType<typeof makeSky>[] = [];
const bases: ReturnType<typeof makeBase>[] = [];
const controllers: ReturnType<typeof makeController>[] = [];
const frames = new Map<number, FrameRequestCallback>();
const options: ExperienceOptions = { seed: 1, lowPower: false, sunAzDeg: 20, sunElDeg: 10, earthAzDeg: 50, earthElDeg: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mock.renderFailure = null;
  mock.observeFailure = null;
  mock.renderers.length = 0;
  mock.observers.length = 0;
  grounds.length = skies.length = bases.length = controllers.length = 0;
  frames.clear();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => { frames.delete(frameId); }));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(() => { if (mock.observeFailure) throw mock.observeFailure; });
    disconnect = vi.fn();
    constructor() { mock.observers.push(this); }
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  mock.configure.mockImplementation(() => {});
  mock.ground.mockImplementation(() => { const result = makeGround(); grounds.push(result); return result; });
  mock.sky.mockImplementation(() => { const result = makeSky(); skies.push(result); return result; });
  mock.base.mockImplementation(() => { const result = makeBase(); bases.push(result); return result; });
  mock.controller.mockImplementation(() => { const result = makeController(); controllers.push(result); return result; });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}
function expectReleased(element: HTMLElement) {
  expect(element.querySelector('canvas')).toBeNull();
  expect(frames.size).toBe(0);
  for (const renderer of mock.renderers) {
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(renderer.domElement.isConnected).toBe(false);
  }
  for (const module of [...grounds, ...skies, ...bases, ...controllers]) expect(module.dispose).toHaveBeenCalledTimes(1);
}

describe('walk initialization rollback', () => {
  it.each(['configure', 'ground', 'sky', 'base', 'controller'] as const)('releases completed resources if the %s factory stage throws', stage => {
    const failure = new Error(`${stage} failed`);
    mock[stage].mockImplementationOnce(() => { throw failure; });
    const element = mount();
    expect(() => createMoonbaseExperience(element, options)).toThrow(failure);
    expectReleased(element);
  });

  it('rolls back modules, scene resources, listeners and observer when the first render throws', () => {
    const failure = new Error('first render failed');
    mock.renderFailure = failure;
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const canvasAdd = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const canvasRemove = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    const element = mount();
    expect(() => createMoonbaseExperience(element, options)).toThrow(failure);
    expectReleased(element);
    expect(mock.observers[0].disconnect).toHaveBeenCalledTimes(1);
    const visibility = docAdd.mock.calls.find(([type]) => type === 'visibilitychange')![1];
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', visibility);
    for (const name of ['webglcontextlost', 'webglcontextrestored']) {
      const handler = canvasAdd.mock.calls.find(([type]) => type === name)![1];
      expect(canvasRemove).toHaveBeenCalledWith(name, handler);
    }
    expect(grounds[0].geometryDispose).toHaveBeenCalledTimes(1);
    expect(grounds[0].materialDispose).toHaveBeenCalledTimes(1);
    expect(grounds[0].textureDispose).toHaveBeenCalledTimes(1);
  });

  it('disconnects an observer whose observe call throws after the listeners were installed', () => {
    mock.observeFailure = new Error('observe failed');
    const element = mount();
    expect(() => createMoonbaseExperience(element, options)).toThrow(mock.observeFailure);
    expectReleased(element);
    expect(mock.observers[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('preserves the original initialization error and continues cleanup if a module disposer also throws', () => {
    const failure = new Error('original render failure');
    mock.renderFailure = failure;
    mock.base.mockImplementationOnce(() => {
      const result = makeBase();
      result.dispose.mockImplementation(() => { throw new Error('cleanup failure'); });
      bases.push(result);
      return result;
    });
    const element = mount();
    let caught: unknown;
    try { createMoonbaseExperience(element, options); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expectReleased(element);
  });

  it('allows reentry after failed initialization and keeps normal disposal idempotent', () => {
    const element = mount();
    mock.renderFailure = new Error('first attempt failed');
    expect(() => createMoonbaseExperience(element, options)).toThrow(mock.renderFailure);
    expectReleased(element);
    mock.renderFailure = null;
    const handle = createMoonbaseExperience(element, options);
    expect(element.querySelectorAll('canvas')).toHaveLength(1);
    expect(frames.size).toBe(1);
    handle.setSky(45, 10, 80, 3);
    expect(skies[1].setSunDirection).toHaveBeenCalled();
    handle.dispose();
    handle.dispose();
    expectReleased(element);
    for (const observer of mock.observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('removes the window resize fallback on a failed first frame', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    mock.renderFailure = new Error('first render failed');
    const element = mount();
    expect(() => createMoonbaseExperience(element, options)).toThrow(mock.renderFailure);
    const resize = add.mock.calls.find(([type]) => type === 'resize')![1];
    expect(remove).toHaveBeenCalledWith('resize', resize);
    expectReleased(element);
  });
});
