import * as THREE from 'three';
import { ORBITAL_BODY_RADII } from './orbitalBodyScale';

export { ORBITAL_BODY_RADII } from './orbitalBodyScale';

export type OrbitalBodyName = 'earth' | 'sun';
export interface Vector3Like { x: number; y: number; z: number }
export type OrbitalTextureStatus = 'not-requested' | 'loading' | 'ready' | 'fallback' | 'disposed';

export interface OrbitalBodyState {
  readonly name: OrbitalBodyName;
  readonly radius: number;
  readonly visible: boolean;
  readonly textureStatus: OrbitalTextureStatus;
}

export interface OrbitalEarthState extends OrbitalBodyState {
  readonly cloudsTextureStatus: OrbitalTextureStatus;
}

export interface OrbitalBodiesState {
  readonly visible: boolean;
  readonly disposed: boolean;
  readonly earth: OrbitalEarthState;
  readonly sun: OrbitalBodyState;
}

export interface OrbitalBodiesUpdate {
  earthPosition: Vector3Like | null;
  sunPosition: Vector3Like | null;
  /** Direction toward the Sun in world coordinates, independent of compressed display positions. */
  sunDirectionWorld: Vector3Like | null;
  camera: THREE.Camera | null;
  visible: boolean;
}

export interface OrbitalBodiesOptions {
  onLoad?: (body: OrbitalBodyName) => void;
  onError?: (body: OrbitalBodyName, error: unknown) => void;
}

export interface OrbitalBodiesController {
  root: THREE.Group;
  state: OrbitalBodiesState;
  update: (input: OrbitalBodiesUpdate) => void;
  dispose: () => void;
}

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type InternalState = Mutable<Omit<OrbitalBodiesState, 'earth' | 'sun'>> & {
  earth: Mutable<OrbitalEarthState>;
  sun: Mutable<OrbitalBodyState>;
};

const EARTH_MAP = '/assets/lunar/earth-orbital.jpg';
const CLOUD_MAP = '/assets/lunar/earth-clouds-orbital.jpg';
const SUN_MAP = '/assets/lunar/sun-orbital.jpg';

const EARTH_VERTEX = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAGMENT = /* glsl */`
  uniform sampler2D uSurfaceMap;
  uniform float uHasMap;
  uniform sampler2D uCloudMap;
  uniform float uHasClouds;
  uniform vec3 uSunDirectionWorld;
  uniform float uAtmosphereStrength;
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  void main() {
    // Neutral, untextured fallback: no invented continents or NASA observations.
    vec3 albedo = vec3(0.18, 0.19, 0.20);
    if (uHasMap > 0.5) albedo = texture2D(uSurfaceMap, vUv).rgb;
    if (uHasClouds > 0.5) {
      // A static observational composite aligned to the same global UV map.
      // Image luminance controls display blending, not calibrated cloud opacity.
      float cloud = dot(texture2D(uCloudMap, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
      albedo = mix(albedo, vec3(0.95), clamp(cloud, 0.0, 1.0) * 0.9);
    }
    float daylight = max(dot(normalize(vWorldNormal), normalize(uSunDirectionWorld)), 0.0);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float rim = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 4.0);
    vec3 atmosphere = vec3(0.10, 0.35, 0.75) * rim * uAtmosphereStrength * (0.2 + 0.8 * daylight);
    // A faint night-side floor preserves the silhouette without fabricating city lights.
    gl_FragColor = vec4(albedo * (0.025 + 1.15 * daylight) + atmosphere, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const DISK_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_FRAGMENT = /* glsl */`
  uniform sampler2D uSurfaceMap;
  uniform float uHasMap;
  uniform float uDisplayExposure;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r >= 1.0) discard;
    float mu = sqrt(max(0.0, 1.0 - r * r));
    // Analytic visible-light limb darkening until the static NASA photograph loads.
    float intensity = 0.42 + 0.58 * mu;
    if (uHasMap > 0.5) {
      // HMI's disk radius is approximately .467 of image width. Its annotation
      // is outside this circular sampling region and is never displayed.
      vec2 photoUv = vec2(0.5) + (vUv - 0.5) * 0.934;
      intensity = dot(texture2D(uSurfaceMap, photoUv).rgb, vec3(0.2126, 0.7152, 0.0722));
      // HMI is a low-intensity monochromatic continuum product. This display
      // exposure makes it read as an emissive Sun while retaining dark spots
      // and limb contrast; it is not a conversion to physical irradiance.
      intensity = min(2.5, intensity * uDisplayExposure);
    }
    float alpha = 1.0 - smoothstep(0.985, 1.0, r);
    gl_FragColor = vec4(vec3(1.0, 0.985, 0.94) * intensity, alpha);
    #include <colorspace_fragment>
  }
`;

const HALO_FRAGMENT = /* glsl */`
  uniform float uGlowStrength;
  varying vec2 vUv;
  void main() {
    float r = length((vUv - 0.5) * 2.0);
    // This small, depth-tested annulus is a display glow, not an observed corona.
    if (r < 0.75 || r > 1.0) discard;
    float alpha = pow(1.0 - smoothstep(0.75, 1.0, r), 2.0) * uGlowStrength;
    gl_FragColor = vec4(1.0, 0.985, 0.94, alpha);
    #include <colorspace_fragment>
  }
`;

function finiteVector(value: Vector3Like | null): value is Vector3Like {
  return value != null && [value.x, value.y, value.z].every(Number.isFinite);
}

function validSunDirection(value: Vector3Like | null): value is Vector3Like {
  if (!finiteVector(value)) return false;
  const length = Math.hypot(value.x, value.y, value.z);
  return Number.isFinite(length) && length > 1e-10;
}

function validCamera(camera: THREE.Camera | null): camera is THREE.Camera {
  return Boolean(camera?.isCamera) && [camera!.quaternion.x, camera!.quaternion.y, camera!.quaternion.z, camera!.quaternion.w].every(Number.isFinite);
}

function imageAspect(texture: THREE.Texture): number {
  const image = texture.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  return width > 0 && height > 0 ? width / height : NaN;
}

/**
 * Display bodies only: callers provide compressed world positions and solar direction.
 * No horizon, illumination availability, communication or epoch calculation occurs here.
 */
export function createOrbitalBodies(scene: THREE.Scene, options: OrbitalBodiesOptions = {}): OrbitalBodiesController {
  const root = new THREE.Group();
  root.name = 'orbital-bodies';
  root.visible = false;
  scene.add(root);

  const state: InternalState = {
    visible: false,
    disposed: false,
    earth: { name: 'earth', radius: ORBITAL_BODY_RADII.earth, visible: false, textureStatus: 'not-requested', cloudsTextureStatus: 'not-requested' },
    sun: { name: 'sun', radius: ORBITAL_BODY_RADII.sun, visible: false, textureStatus: 'not-requested' },
  };
  root.userData.orbitalBodiesState = state;
  root.userData.presentationOnly = true;

  const earthMaterial = new THREE.ShaderMaterial({
    name: 'orbital-earth-solar-lambert',
    vertexShader: EARTH_VERTEX,
    fragmentShader: EARTH_FRAGMENT,
    uniforms: {
      uSurfaceMap: { value: null },
      uHasMap: { value: 0 },
      uCloudMap: { value: null },
      uHasClouds: { value: 0 },
      uSunDirectionWorld: { value: new THREE.Vector3(0, 1, 0) },
      uAtmosphereStrength: { value: 0.025 },
    },
    depthTest: true,
    depthWrite: true,
    toneMapped: true,
  });
  const earthGeometry = new THREE.SphereGeometry(ORBITAL_BODY_RADII.earth, 48, 32);
  const earth = new THREE.Mesh(earthGeometry, earthMaterial);
  earth.name = 'orbital-earth';
  // Static illustrative texture orientation, not the Earth's rotation at selected UTC.
  earth.rotation.y = 0.4;
  earth.rotation.x = Math.PI / 2 - 0.2;
  earth.visible = false;
  earth.userData.bodyState = state.earth;
  earth.userData.illustrativeSurfaceOrientation = true;
  earth.raycast = () => {};
  root.add(earth);

  const sunMaterial = new THREE.ShaderMaterial({
    name: 'orbital-sun-visible-light',
    vertexShader: DISK_VERTEX,
    fragmentShader: SUN_FRAGMENT,
    uniforms: { uSurfaceMap: { value: null }, uHasMap: { value: 0 }, uDisplayExposure: { value: 10 } },
    transparent: true,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
  const haloMaterial = new THREE.ShaderMaterial({
    name: 'orbital-sun-contained-glow',
    vertexShader: DISK_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    uniforms: { uGlowStrength: { value: 0.18 } },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sunGeometry = new THREE.PlaneGeometry(ORBITAL_BODY_RADII.sun * 2, ORBITAL_BODY_RADII.sun * 2);
  const haloGeometry = new THREE.PlaneGeometry(ORBITAL_BODY_RADII.sun * 2.64, ORBITAL_BODY_RADII.sun * 2.64);
  const sunDisk = new THREE.Mesh(sunGeometry, sunMaterial);
  const sunHalo = new THREE.Mesh(haloGeometry, haloMaterial);
  sunDisk.name = 'orbital-sun-disc';
  sunHalo.name = 'orbital-sun-halo';
  sunDisk.raycast = () => {};
  sunHalo.raycast = () => {};
  const sun = new THREE.Group();
  sun.name = 'orbital-sun';
  sun.visible = false;
  sun.userData.bodyState = state.sun;
  sun.userData.staticVisibleLightImage = true;
  sun.add(sunHalo, sunDisk);
  root.add(sun);

  const loader = new THREE.TextureLoader();
  const textures = new Set<THREE.Texture>();
  const disposedTextures = new WeakSet<THREE.Texture>();
  const worldCameraQuaternion = new THREE.Quaternion();
  const inverseRootQuaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();

  const disposeTexture = (texture: THREE.Texture) => {
    if (!disposedTextures.has(texture)) {
      texture.dispose();
      disposedTextures.add(texture);
    }
    textures.delete(texture);
  };

  const loadTexture = (body: OrbitalBodyName) => {
    if (state.disposed || state[body].textureStatus !== 'not-requested') return;
    state[body].textureStatus = 'loading';
    const material = body === 'earth' ? earthMaterial : sunMaterial;
    const failure = (error: unknown) => {
      if (state.disposed) return;
      state[body].textureStatus = 'fallback';
      options.onError?.(body, error);
    };
    try {
      const requested = loader.load(body === 'earth' ? EARTH_MAP : SUN_MAP, (texture) => {
        if (state.disposed) { disposeTexture(texture); return; }
        textures.add(texture);
        const expectedAspect = body === 'earth' ? 2 : 1;
        if (Math.abs(imageAspect(texture) - expectedAspect) > 0.04 || !Number.isFinite(imageAspect(texture))) {
          disposeTexture(texture);
          failure(new Error(`${body === 'earth' ? 'Earth requires a 2:1 global map' : 'Sun requires a centered square disk image'}.`));
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        if (body === 'earth') texture.wrapS = THREE.RepeatWrapping;
        material.uniforms.uSurfaceMap.value = texture;
        material.uniforms.uHasMap.value = 1;
        state[body].textureStatus = 'ready';
        options.onLoad?.(body);
      }, undefined, failure);
      if (state.disposed || disposedTextures.has(requested)) disposeTexture(requested);
      else textures.add(requested);
    } catch (error) {
      failure(error);
    }
  };

  const loadClouds = () => {
    if (state.disposed || state.earth.cloudsTextureStatus !== 'not-requested') return;
    state.earth.cloudsTextureStatus = 'loading';
    const failure = (error: unknown) => {
      if (state.disposed) return;
      state.earth.cloudsTextureStatus = 'fallback';
      options.onError?.('earth', error);
    };
    try {
      const requested = loader.load(CLOUD_MAP, (texture) => {
        if (state.disposed) { disposeTexture(texture); return; }
        textures.add(texture);
        const aspect = imageAspect(texture);
        if (!Number.isFinite(aspect) || Math.abs(aspect - 2) > 0.04) {
          disposeTexture(texture);
          failure(new Error('Earth clouds require a 2:1 global image.'));
          return;
        }
        // This grayscale image is a display blend mask, not the surface albedo.
        texture.colorSpace = THREE.NoColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.wrapS = THREE.RepeatWrapping;
        earthMaterial.uniforms.uCloudMap.value = texture;
        earthMaterial.uniforms.uHasClouds.value = 1;
        state.earth.cloudsTextureStatus = 'ready';
        options.onLoad?.('earth');
      }, undefined, failure);
      if (state.disposed || disposedTextures.has(requested)) disposeTexture(requested);
      else textures.add(requested);
    } catch (error) {
      failure(error);
    }
  };

  const update = (input: OrbitalBodiesUpdate) => {
    if (state.disposed) return;
    const viewAvailable = validCamera(input.camera);
    const earthVisible = input.visible && viewAvailable && finiteVector(input.earthPosition) && validSunDirection(input.sunDirectionWorld);
    const sunVisible = input.visible && viewAvailable && finiteVector(input.sunPosition);
    state.earth.visible = earth.visible = Boolean(earthVisible);
    state.sun.visible = sun.visible = Boolean(sunVisible);
    state.visible = root.visible = earth.visible || sun.visible;
    if (!root.visible) return;
    root.updateWorldMatrix(true, false);
    if (earthVisible && input.earthPosition && input.sunDirectionWorld) {
      position.set(input.earthPosition.x, input.earthPosition.y, input.earthPosition.z);
      earth.position.copy(root.worldToLocal(position));
      const length = Math.hypot(input.sunDirectionWorld.x, input.sunDirectionWorld.y, input.sunDirectionWorld.z);
      earthMaterial.uniforms.uSunDirectionWorld.value.set(input.sunDirectionWorld.x / length, input.sunDirectionWorld.y / length, input.sunDirectionWorld.z / length);
      loadTexture('earth');
    }
    if (sunVisible && input.sunPosition && input.camera) {
      position.set(input.sunPosition.x, input.sunPosition.y, input.sunPosition.z);
      sun.position.copy(root.worldToLocal(position));
      input.camera.getWorldQuaternion(worldCameraQuaternion);
      root.getWorldQuaternion(inverseRootQuaternion).invert();
      sun.quaternion.copy(inverseRootQuaternion.multiply(worldCameraQuaternion));
      loadTexture('sun');
    }
    if (earthVisible) loadClouds();
  };

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    state.visible = root.visible = false;
    state.earth.visible = earth.visible = false;
    state.sun.visible = sun.visible = false;
    state.earth.textureStatus = state.sun.textureStatus = 'disposed';
    state.earth.cloudsTextureStatus = 'disposed';
    earthMaterial.uniforms.uSurfaceMap.value = null;
    earthMaterial.uniforms.uCloudMap.value = null;
    sunMaterial.uniforms.uSurfaceMap.value = null;
    for (const texture of [...textures]) disposeTexture(texture);
    earthGeometry.dispose();
    sunGeometry.dispose();
    haloGeometry.dispose();
    earthMaterial.dispose();
    sunMaterial.dispose();
    haloMaterial.dispose();
    root.removeFromParent();
    root.clear();
  };

  return { root, state, update, dispose };
}
