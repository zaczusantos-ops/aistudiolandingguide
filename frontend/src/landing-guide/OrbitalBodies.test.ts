import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrbitalBodies, ORBITAL_BODY_RADII, type OrbitalBodiesController, type OrbitalBodiesUpdate } from './OrbitalBodies';

interface PendingTexture {
  url: string;
  texture: THREE.Texture<HTMLImageElement>;
  resolve: (width: number, height: number) => void;
  reject: (error: unknown) => void;
}

let pending: PendingTexture[];
let controllers: OrbitalBodiesController[];

function update(overrides: Partial<OrbitalBodiesUpdate> = {}): OrbitalBodiesUpdate {
  const camera = new THREE.PerspectiveCamera(34, 1.6, 0.1, 100);
  camera.position.set(0, 1, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return {
    earthPosition: { x: -1.2, y: 0.3, z: 0.4 },
    sunPosition: { x: 1.5, y: 0.8, z: -0.2 },
    sunDirectionWorld: { x: 3, y: 4, z: 0 },
    camera,
    visible: true,
    ...overrides,
  };
}

function create(options: Parameters<typeof createOrbitalBodies>[1] = {}) {
  const scene = new THREE.Scene();
  const controller = createOrbitalBodies(scene, options);
  controllers.push(controller);
  return { scene, controller };
}

function earthOf(controller: OrbitalBodiesController) {
  return controller.root.getObjectByName('orbital-earth') as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
}

beforeEach(() => {
  pending = [];
  controllers = [];
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((url, onLoad, _onProgress, onError) => {
    const texture = new THREE.Texture<HTMLImageElement>();
    pending.push({
      url,
      texture,
      resolve: (width, height) => {
        const image = document.createElement('img');
        Object.defineProperty(image, 'naturalWidth', { value: width });
        Object.defineProperty(image, 'naturalHeight', { value: height });
        texture.image = image;
        onLoad?.(texture);
      },
      reject: (error) => onError?.(error),
    });
    return texture;
  });
});

afterEach(() => {
  controllers.forEach((controller) => controller.dispose());
  vi.restoreAllMocks();
});

describe('independent orbital body rendering', () => {
  it('does not load a texture or show a body during hero/disabled states', () => {
    const { scene, controller } = create();
    expect(controller.root.parent).toBe(scene);
    expect(controller.root.visible).toBe(false);
    expect(pending).toHaveLength(0);
    controller.update(update({ visible: false }));
    expect(pending).toHaveLength(0);
    expect(controller.state.earth.textureStatus).toBe('not-requested');
    expect(controller.state.sun.textureStatus).toBe('not-requested');
  });

  it('uses supplied world positions and a separate normalized solar direction, without moving scene lighting', () => {
    const { scene, controller } = create();
    const moonLight = new THREE.DirectionalLight(0xffffff, 2.65);
    moonLight.position.set(4, 2, -3);
    scene.add(moonLight);
    const before = moonLight.position.clone();
    const input = update();
    controller.update(input);
    const earth = earthOf(controller);
    const sun = controller.root.getObjectByName('orbital-sun')!;
    expect(earth.position.toArray()).toEqual([-1.2, 0.3, 0.4]);
    expect(sun.position.toArray()).toEqual([1.5, 0.8, -0.2]);
    expect(earth.material.uniforms.uSunDirectionWorld.value.toArray()).toEqual([0.6, 0.8, 0]);
    expect(earth.material.lights).toBe(false);
    expect(moonLight.position.equals(before)).toBe(true);
    expect(moonLight.intensity).toBe(2.65);
    expect(earth.geometry.parameters.radius).toBe(ORBITAL_BODY_RADII.earth);
    expect(earth.rotation.x).toBeCloseTo(Math.PI / 2 - 0.2);
    expect(ORBITAL_BODY_RADII.sun).toBeLessThan(ORBITAL_BODY_RADII.earth);
    expect(sun.quaternion.angleTo(input.camera!.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(1e-10);
    expect(pending.map((request) => request.url)).toEqual(['/assets/lunar/earth-orbital.jpg', '/assets/lunar/sun-orbital.jpg', '/assets/lunar/earth-clouds-orbital.jpg']);
    controller.update(input);
    expect(pending).toHaveLength(3);
    controller.update(update({ visible: false }));
    expect(controller.root.visible).toBe(false);
    expect(earth.visible).toBe(false);
    expect(sun.visible).toBe(false);
  });

  it('keeps real depth occlusion and prevents the display bodies from taking lunar picks', () => {
    const { controller } = create();
    const input = update({ earthPosition: { x: 0, y: 0, z: 0 }, sunPosition: { x: 0, y: 0, z: 0 } });
    controller.update(input);
    controller.root.updateMatrixWorld(true);
    controller.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(object.material.depthTest).toBe(true);
      if (object.name !== 'orbital-sun-halo') expect(object.material.depthWrite).toBe(true);
    });
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), input.camera!);
    expect(raycaster.intersectObject(controller.root, true)).toEqual([]);
  });

  it('hides unsupported inputs rather than inventing a direction or zero-position body', () => {
    const { controller } = create();
    controller.update(update({ earthPosition: null, sunPosition: { x: NaN, y: 0, z: 0 } }));
    expect(controller.root.visible).toBe(false);
    expect(pending).toHaveLength(0);
    controller.update(update({ sunDirectionWorld: { x: 0, y: 0, z: 0 }, sunPosition: null }));
    expect(controller.root.visible).toBe(false);
    expect(pending).toHaveLength(0);
    controller.update(update({ camera: null }));
    expect(controller.root.visible).toBe(false);
    expect(pending).toHaveLength(0);
    controller.update(update({ earthPosition: null }));
    expect(controller.state.earth.visible).toBe(false);
    expect(controller.state.sun.visible).toBe(true);
    expect(pending.map((request) => request.url)).toEqual(['/assets/lunar/sun-orbital.jpg']);
  });

  it('accepts the global Earth map and centered solar disk, and asks for rendering after each load', () => {
    const onLoad = vi.fn();
    const { controller } = create({ onLoad });
    controller.update(update());
    pending[0].resolve(2048, 1024);
    pending[1].resolve(1024, 1024);
    const earth = earthOf(controller);
    const sun = controller.root.getObjectByName('orbital-sun-disc') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    expect(controller.state.earth.textureStatus).toBe('ready');
    expect(controller.state.sun.textureStatus).toBe('ready');
    expect(earth.material.uniforms.uHasMap.value).toBe(1);
    expect(sun.material.uniforms.uHasMap.value).toBe(1);
    expect(pending[0].texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(pending[0].texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(onLoad.mock.calls).toEqual([['earth'], ['sun']]);
    expect(controller.state.earth.cloudsTextureStatus).toBe('loading');
    expect(earth.material.uniforms.uHasClouds.value).toBe(0);
    pending[2].resolve(2048, 1024);
    expect(controller.state.earth.cloudsTextureStatus).toBe('ready');
    expect(earth.material.uniforms.uHasClouds.value).toBe(1);
    expect(pending[2].texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(pending[2].texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(onLoad.mock.calls).toEqual([['earth'], ['sun'], ['earth']]);
  });

  it('exposes the HMI disk as a bright Sun while retaining darker limb and spot contrast', () => {
    const { controller } = create();
    const sun = controller.root.getObjectByName('orbital-sun-disc') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    const halo = controller.root.getObjectByName('orbital-sun-halo') as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    const exposure = sun.material.uniforms.uDisplayExposure.value as number;
    // Representative HMI sRGB samples after the same linear decode used by the GPU.
    const emitted = (sample: number) => new THREE.Color().setRGB(sample, sample, sample, THREE.SRGBColorSpace).r * exposure;
    expect(emitted(104 / 255)).toBeGreaterThan(1);
    expect(emitted(72 / 255)).toBeLessThan(1);
    expect(emitted(30 / 255)).toBeLessThan(emitted(72 / 255));
    expect(sun.material.toneMapped).toBe(false);
    expect(halo.material.uniforms.uGlowStrength.value).toBeGreaterThanOrEqual(0.15);
    expect(halo.material.uniforms.uGlowStrength.value).toBeLessThanOrEqual(0.2);
    expect(earthOf(controller).material.uniforms.uAtmosphereStrength.value).toBeLessThan(0.04);
  });

  it('retains honest fallbacks when a disk photo is supplied as the Earth map or a texture fails', () => {
    const onError = vi.fn();
    const { controller } = create({ onError });
    controller.update(update());
    const invalidDispose = vi.spyOn(pending[0].texture, 'dispose');
    pending[0].resolve(640, 640);
    pending[1].reject(new Error('Network failed'));
    expect(controller.state.earth.textureStatus).toBe('fallback');
    expect(controller.state.sun.textureStatus).toBe('fallback');
    expect(earthOf(controller).material.uniforms.uHasMap.value).toBe(0);
    expect(invalidDispose).toHaveBeenCalledTimes(1);
    expect(controller.root.visible).toBe(true);
    expect(onError.mock.calls.map(([body]) => body)).toEqual(['earth', 'sun']);
    controller.update(update());
    expect(pending).toHaveLength(3);
  });

  it('does not block the surface or solar disk when the independent cloud image fails', () => {
    const { controller } = create();
    controller.update(update());
    pending[0].resolve(2048, 1024);
    pending[1].resolve(1024, 1024);
    pending[2].reject(new Error('Cloud image unavailable'));
    expect(controller.state.earth.textureStatus).toBe('ready');
    expect(controller.state.sun.textureStatus).toBe('ready');
    expect(controller.state.earth.cloudsTextureStatus).toBe('fallback');
    expect(earthOf(controller).material.uniforms.uHasClouds.value).toBe(0);
    expect(controller.root.visible).toBe(true);
  });

  it('disposes meshes, materials and textures exactly once and ignores asynchronous completion afterward', () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { scene, controller } = create({ onLoad, onError });
    controller.update(update());
    const disposers = pending.map((request) => vi.spyOn(request.texture, 'dispose'));
    const geometryDisposers: ReturnType<typeof vi.spyOn>[] = [];
    const materialDisposers: ReturnType<typeof vi.spyOn>[] = [];
    controller.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometryDisposers.push(vi.spyOn(object.geometry, 'dispose'));
      materialDisposers.push(vi.spyOn(object.material, 'dispose'));
    });
    controller.dispose();
    controller.dispose();
    expect(scene.children).not.toContain(controller.root);
    expect(controller.root.children).toHaveLength(0);
    expect(controller.state.disposed).toBe(true);
    expect(controller.state.visible).toBe(false);
    for (const spy of [...disposers, ...geometryDisposers, ...materialDisposers]) expect(spy).toHaveBeenCalledTimes(1);
    pending[0].resolve(2048, 1024);
    pending[1].reject(new Error('Late network failure'));
    pending[2].resolve(2048, 1024);
    controller.update(update());
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(controller.state.earth.textureStatus).toBe('disposed');
    expect(controller.state.sun.textureStatus).toBe('disposed');
    expect(controller.state.earth.cloudsTextureStatus).toBe('disposed');
    expect(pending).toHaveLength(3);
    for (const spy of disposers) expect(spy).toHaveBeenCalledTimes(1);
  });
});
