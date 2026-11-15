import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildDisplacedMoonGeometry, readPackedElevationRaster, sampleTerrainHeightKm, terrainRadius, yieldForMoonTerrain, type TerrainRasters, type PackedElevationRaster } from './terrainRecovery';

/** Display-only coordinates retained from the original lunar viewport. */
export function moonVector(latitudeDeg: number, longitudeEastDeg: number): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latitudeDeg);
  const lon = THREE.MathUtils.degToRad(longitudeEastDeg);
  return new THREE.Vector3(-Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}

export function moonCoordinates(point: THREE.Vector3): { latDeg: number; lonEastDeg: number } {
  const unit = point.clone().normalize();
  return {
    latDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(unit.y, -1, 1))),
    lonEastDeg: (THREE.MathUtils.radToDeg(Math.atan2(unit.z, -unit.x)) + 360) % 360,
  };
}

export interface MoonMarker {
  id: string;
  latDeg: number;
  lonEastDeg: number;
}
export interface ProjectedMoonMarker { id: string; x: number; y: number; visible: boolean }
export interface MoonRuntimeOptions {
  autoRotate: boolean;
  selectionEnabled: boolean;
  detail: boolean;
  topography: boolean;
  active: boolean;
  markers: MoonMarker[];
}
export interface MoonRuntime {
  update: (options: MoonRuntimeOptions) => void;
  zoom: (amount: number) => void;
  orbit: (azimuth: number, polar: number) => void;
  view: (preset: 'globe' | 'south') => void;
  dispose: () => void;
}
interface Callbacks {
  ready: () => void;
  unavailable: () => void;
  pause: () => void;
  detail: (status: 'loading' | 'ready' | 'unavailable') => void;
  topography: (status: 'loading' | 'ready' | 'unavailable') => void;
  project: (markers: ProjectedMoonMarker[]) => void;
  pick: (latDeg: number, lonEastDeg: number) => void;
  reticle: (latDeg: number, lonEastDeg: number) => void;
  relief?: (status: 'loading' | 'global' | 'ready' | 'unavailable' | 'partial') => void;
}

/**
 * A small, lazy renderer: one 4K-triangle sphere and one existing LROC mosaic.
 * Real displaced global/polar relief progressively replaces the first sphere.
 * Texture decode and mesh work yield between bounded chunks; no derived atlas
 * or environment-map precomputation blocks the first frame. Display use only.
 */
export function createMoonRuntime(mount: HTMLElement, initial: MoonRuntimeOptions, callbacks: Callbacks): MoonRuntime {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.debug.onShaderError = () => { callbacks.unavailable(); dispose(); };
  const rendererInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
  const gl = renderer.getContext();
  const device = String(rendererInfo ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(device);
  // A single CSS pixel per device pixel is deliberately capped for weak GPUs.
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y';
  mount.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(-4.15, 0.6, 0.35);
  const controls = new OrbitControls(camera, renderer.domElement);
  // OrbitControls writes touch-action:none during construction.
  renderer.domElement.style.touchAction = 'pan-y';
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.35;
  controls.maxDistance = 7;
  controls.minPolarAngle = 0.03;
  controls.maxPolarAngle = Math.PI - 0.03;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.8;
  // Let a one-finger gesture scroll the page on touch devices; rotation remains
  // available with two fingers, mouse and the explicit keyboard alternatives.
  controls.touches.ONE = THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  const group = new THREE.Group();
  // Keep north up; spin this centered body's own pole axis, never its position.
  scene.add(group);
  let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(1, 64, 32);
  // Native SphereGeometry starts u=0 at local longitude 0, whereas the bundled
  // NASA mosaic starts at -180 degrees. The half-turn preserves registration.
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + 0.5);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0, envMapIntensity: 0.05 });
  const uniforms = {
    detail: { value: 0 }, polar: { value: null as THREE.Texture | null },
    topography: { value: 0 }, elevation: { value: null as THREE.Texture | null },
    relief: { value: 0 }, polarReady: { value: 0 },
  };
  const color = (hex: string) => `vec3(${new THREE.Color(hex).toArray().join(',')})`;
  material.onBeforeCompile = shader => {
    shader.uniforms.uMoonDetail = uniforms.detail;
    shader.uniforms.uMoonPolar = uniforms.polar;
    shader.uniforms.uMoonTopography = uniforms.topography;
    shader.uniforms.uMoonElevation = uniforms.elevation;
    shader.uniforms.uMoonRelief = uniforms.relief;
    shader.uniforms.uMoonPolarReady = uniforms.polarReady;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMoonPoint;
        varying vec3 vMoonRight;
        varying vec3 vMoonUp;
        varying vec3 vMoonForward;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMoonPoint = normalize(position);
        vMoonRight = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
        vMoonUp = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        vMoonForward = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vMoonPoint;
      varying vec3 vMoonRight;
      varying vec3 vMoonUp;
      varying vec3 vMoonForward;
      uniform sampler2D uMoonPolar;
      uniform sampler2D uMoonElevation;
      uniform float uMoonDetail;
      uniform float uMoonTopography;
      uniform float uMoonRelief;
      uniform float uMoonPolarReady;
      float decodeHeight(vec2 rg) { return -9.5 + (rg.r * 65280.0 + rg.g * 255.0) / 65535.0 * 20.5; }
      vec2 globalUv(vec3 p) {
        return vec2(fract(atan(p.z, -p.x) / 6.28318530718 + 0.5), 0.5 - asin(clamp(p.y, -1.0, 1.0)) / 3.14159265359);
      }
      float terrainHeight(vec3 point) {
        vec3 p = normalize(point);
        float h = decodeHeight(texture2D(uMoonElevation, globalUv(p)).rg);
        if (uMoonPolarReady > 0.5 && p.y < -0.9851093) {
          vec2 stereo = vec2(p.z, -p.x) / (1.0 - p.y);
          vec2 uv = vec2(0.5 + stereo.x / 0.17497467, 0.5 - stereo.y / 0.17497467);
          float lat = asin(clamp(p.y, -1.0, 1.0)) * 57.295779513;
          float blend = smoothstep(80.1, 81.4, -lat);
          h = mix(h, decodeHeight(texture2D(uMoonPolar, clamp(uv, 0.0, 1.0)).rg), blend);
        }
        return h;
      }
      vec3 elevationColor(float km) {
        vec3 c0 = ${color('#1d1459')}; vec3 c1 = ${color('#2563eb')};
        vec3 c2 = ${color('#06b6d4')}; vec3 c3 = ${color('#22c55e')};
        vec3 c4 = ${color('#eab308')}; vec3 c5 = ${color('#ef4444')}; vec3 c6 = ${color('#fce7f3')};
        if (km < -5.5) return mix(c0, c1, clamp((km + 9.0) / 3.5, 0.0, 1.0));
        if (km < -2.0) return mix(c1, c2, (km + 5.5) / 3.5);
        if (km < 0.0) return mix(c2, c3, (km + 2.0) / 2.0);
        if (km < 2.5) return mix(c3, c4, km / 2.5);
        if (km < 5.5) return mix(c4, c5, (km - 2.5) / 3.0);
        return mix(c5, c6, clamp((km - 5.5) / 3.0, 0.0, 1.0));
      }`).replace('#include <map_fragment>', `#include <map_fragment>
      vec3 moonP = normalize(vMoonPoint);
      vec3 moonDetailNormal = moonP;
      if (uMoonTopography > 0.5) diffuseColor.rgb = elevationColor(terrainHeight(moonP));
      if (uMoonRelief > 0.5) {
        vec3 east = length(moonP.xz) > 0.0001 ? normalize(vec3(moonP.z, 0.0, -moonP.x)) : vec3(0.0, 0.0, 1.0);
        vec3 north = normalize(cross(moonP, east));
        float polarWeight = uMoonPolarReady * smoothstep(79.5, 81.2, abs(asin(moonP.y) * 57.295779513));
        float stepAngle = mix(0.00306796, 0.00034175, polarWeight);
        float hC = terrainHeight(moonP);
        float hE = terrainHeight(moonP + east * stepAngle);
        float hW = terrainHeight(moonP - east * stepAngle);
        float hN = terrainHeight(moonP + north * stepAngle);
        float hS = terrainHeight(moonP - north * stepAngle);
        float gain = mix(2.05, 1.42, polarWeight) * (1.0 + uMoonDetail * 0.15);
        float slopeE = (hE - hW) / (2.0 * stepAngle * 1737.4) * gain;
        float slopeN = (hN - hS) / (2.0 * stepAngle * 1737.4) * gain;
        moonDetailNormal = normalize(moonP - east * slopeE - north * slopeN);
        float curvature = hC - (hE + hW + hN + hS) * 0.25;
        diffuseColor.rgb *= clamp(1.0 + curvature * mix(0.035, 0.20, polarWeight), 0.84, 1.18);
      }`).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (uMoonRelief > 0.5) {
        mat3 objectToView = mat3(normalize(vMoonRight), normalize(vMoonUp), normalize(vMoonForward));
        vec3 detailView = normalize(objectToView * moonDetailNormal);
        vec3 baseView = normalize(objectToView * moonP);
        normal = normalize(normal + (detailView - baseView) * 0.85);
      }`);
  };
  material.customProgramCacheKey = () => 'lunar-progressive-lola-relief-v1';
  const mesh = new THREE.Mesh(geometry, material);
  group.add(mesh);
  scene.add(new THREE.HemisphereLight(0xd4d4d8, 0x09090b, 0.24));
  const presentationLight = new THREE.DirectionalLight(0xffffff, 2.65);
  presentationLight.position.set(-1.7, 2.8, 3.5);
  scene.add(presentationLight);
  const rimLight = new THREE.DirectionalLight(0xa1a1aa, 0.18);
  rimLight.position.set(4, -2, -5);
  scene.add(rimLight);
  const raycaster = new THREE.Raycaster();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let options = initial;
  let pausedByInteraction = false;
  let disposed = false;
  let textureReady = false;
  let detailRequested = false;
  let polarReady = false;
  let topographyRequested = false;
  let elevationReady = false;
  let frame = 0;
  let lastDraw = 0;
  let previousTime = 0;
  let mainTexture: THREE.Texture | undefined;
  let polarTexture: THREE.Texture | undefined;
  let elevationTexture: THREE.Texture | undefined;
  let visible = true;
  let reportedReady = false;
  let lastReticle: { latDeg: number; lonEastDeg: number } | undefined;
  let terrainRasters: TerrainRasters | undefined;
  let renderedRasters: TerrainRasters | undefined;
  let southRaster: PackedElevationRaster | undefined;
  let buildVersion = 0;
  let reliefStarted = false;
  let southFailed = false;
  let pendingRelief: 'global' | 'ready' | 'partial' | undefined;
  const allowRotation = () => options.active && options.autoRotate && !pausedByInteraction && !reduceMotion?.matches && !document.hidden && visible;
  const request = () => { if (!disposed && !frame && options.active && !document.hidden && visible) frame = requestAnimationFrame(draw); };
  const pause = () => {
    if (!pausedByInteraction) { pausedByInteraction = true; callbacks.pause(); }
  };
  const project = () => {
    group.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const width = mount.clientWidth || 640, height = mount.clientHeight || 480;
    callbacks.project(options.markers.map(marker => {
      const radius = renderedRasters ? terrainRadius(sampleTerrainHeightKm(renderedRasters, marker.latDeg, marker.lonEastDeg)) + 0.006 : 1.006;
      const world = group.localToWorld(moonVector(marker.latDeg, marker.lonEastDeg).multiplyScalar(radius));
      const normal = world.clone().normalize();
      const facing = normal.dot(camera.position.clone().sub(world).normalize()) > 0.025;
      const projected = world.project(camera);
      return { id: marker.id, x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height, visible: facing && Math.abs(projected.z) < 1 };
    }));
  };
  function draw(now: number) {
    frame = 0;
    if (disposed || !options.active || document.hidden || !visible) return;
    const interval = software ? 100 : 40; // 10/25 fps for decorative spin, on-demand otherwise.
    if (allowRotation() && now - lastDraw < interval) { request(); return; }
    const dt = previousTime ? Math.min((now - previousTime) / 1000, 0.15) : 0;
    previousTime = now;
    lastDraw = now;
    if (allowRotation()) group.rotateY(dt * 0.065);
    controls.update();
    try { renderer.render(scene, camera); }
    catch { callbacks.unavailable(); dispose(); return; }
    if (disposed) return; // A failed shader must keep the real-image fallback visible.
    project();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const centerHit = raycaster.intersectObject(mesh, false)[0];
    if (centerHit) {
      const reticle = moonCoordinates(group.worldToLocal(centerHit.point.clone()));
      if (!lastReticle || Math.abs(reticle.latDeg - lastReticle.latDeg) + Math.abs(reticle.lonEastDeg - lastReticle.lonEastDeg) > 0.05) {
        lastReticle = reticle;
        callbacks.reticle(reticle.latDeg, reticle.lonEastDeg);
      }
    }
    if (textureReady && !reportedReady) {
      reportedReady = true; callbacks.ready();
      // The textured frame is already visible before any terrain pixel work.
      void yieldForMoonTerrain().then(() => { if (!disposed) beginRelief(); });
    }
    if (pendingRelief) { const status = pendingRelief; pendingRelief = undefined; callbacks.relief?.(status); }
    if (allowRotation()) request();
  }
  const resize = () => {
    if (disposed) return;
    const width = mount.clientWidth || 640, height = mount.clientHeight || 480;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    request();
  };
  const upgradeTerrain = async () => {
    if (!terrainRasters || disposed) return;
    const version = ++buildVersion;
    const rasters: TerrainRasters = { global: terrainRasters.global, ...(southRaster ? { south: southRaster } : {}) };
    const lowMemory = (navigator.hardwareConcurrency || 4) <= 4;
    const widthSegments = software ? 128 : lowMemory ? 192 : 256;
    try {
      const upgraded = await buildDisplacedMoonGeometry({ rasters, widthSegments, heightSegments: widthSegments / 2, cancelled: () => disposed || version !== buildVersion });
      if (!upgraded) return;
      if (disposed || version !== buildVersion) { upgraded.dispose(); return; }
      const previous = geometry;
      geometry = upgraded;
      mesh.geometry = geometry;
      renderedRasters = rasters;
      uniforms.relief.value = 1;
      uniforms.polarReady.value = rasters.south ? 1 : 0;
      uniforms.detail.value = options.detail ? 1 : 0;
      previous.dispose();
      pendingRelief = rasters.south ? 'ready' : southFailed ? 'partial' : 'global';
      request();
    } catch {
      if (!disposed) callbacks.relief?.(renderedRasters ? 'partial' : 'unavailable');
    }
  };
  const loadDetail = (force = false) => {
    uniforms.detail.value = options.detail ? 1 : 0;
    if ((!force && !options.detail) || detailRequested) return;
    detailRequested = true;
    callbacks.detail('loading');
    polarTexture = new THREE.TextureLoader().load('/assets/lunar/ldem_south_pole_1k.png', texture => {
      if (disposed) { texture.dispose(); return; }
      texture.flipY = false;
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      uniforms.polar.value = texture;
      polarReady = true;
      callbacks.detail('ready');
      void readPackedElevationRaster(texture.image as HTMLImageElement, { cancelled: () => disposed }).then(raster => {
        if (!raster || disposed) return;
        southRaster = raster;
        return upgradeTerrain();
      }).catch(() => { if (!disposed) { southFailed = true; if (renderedRasters) callbacks.relief?.('partial'); } });
      request();
    }, undefined, () => {
      if (!disposed) { southFailed = true; callbacks.detail('unavailable'); if (renderedRasters) callbacks.relief?.('partial'); }
    });
  };
  const loadTopography = (force = false) => {
    uniforms.topography.value = options.topography && elevationReady ? 1 : 0;
    if ((!force && !options.topography) || topographyRequested) return;
    topographyRequested = true;
    callbacks.topography('loading');
    elevationTexture = new THREE.TextureLoader().load('/assets/lunar/ldem_global_2k.png', texture => {
      if (disposed) { texture.dispose(); return; }
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      uniforms.elevation.value = texture;
      elevationReady = true;
      uniforms.topography.value = options.topography ? 1 : 0;
      callbacks.topography('ready');
      void readPackedElevationRaster(texture.image as HTMLImageElement, { cancelled: () => disposed }).then(raster => {
        if (!raster || disposed) return;
        terrainRasters = { global: raster };
        return upgradeTerrain();
      }).catch(() => { if (!disposed) callbacks.relief?.('unavailable'); });
      request();
    }, undefined, () => { if (!disposed) { callbacks.topography('unavailable'); callbacks.relief?.('unavailable'); } });
  };
  const beginRelief = () => {
    if (reliefStarted || disposed) return;
    reliefStarted = true;
    callbacks.relief?.('loading');
    loadTopography(true);
    loadDetail(true);
  };
  mainTexture = new THREE.TextureLoader().load('/assets/lunar/lroc_color_2k.jpg', texture => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 1;
    material.map = texture;
    material.needsUpdate = true;
    textureReady = true;
    request();
  }, undefined, () => { if (!disposed) { callbacks.unavailable(); dispose(); } });
  const change = () => request();
  const down = (event: PointerEvent) => { pause(); pointerStart = { x: event.clientX, y: event.clientY }; };
  const cancelPointer = () => { pointerStart = undefined; };
  let pointerStart: { x: number; y: number } | undefined;
  const up = (event: PointerEvent) => {
    if (!pointerStart || !options.selectionEnabled) { pointerStart = undefined; return; }
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = undefined;
    if (distance > 6 || event.pointerType === 'touch' && event.isPrimary === false) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    group.updateMatrixWorld(true);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) return;
    const picked = moonCoordinates(group.worldToLocal(hit.point.clone()));
    callbacks.pick(picked.latDeg, picked.lonEastDeg);
  };
  const contextLost = (event: Event) => { event.preventDefault(); callbacks.unavailable(); dispose(); };
  const visibility = () => { previousTime = 0; request(); };
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
  observer?.observe(mount);
  const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(records => { visible = records[0]?.isIntersecting ?? true; previousTime = 0; request(); });
  intersection?.observe(mount);
  controls.addEventListener('change', change);
  controls.addEventListener('start', pause);
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', cancelPointer);
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  reduceMotion?.addEventListener('change', visibility);
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    intersection?.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', visibility);
    reduceMotion?.removeEventListener('change', visibility);
    renderer.domElement.removeEventListener('pointerdown', down);
    renderer.domElement.removeEventListener('pointerup', up);
    renderer.domElement.removeEventListener('pointercancel', cancelPointer);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    controls.removeEventListener('change', change);
    controls.removeEventListener('start', pause);
    controls.dispose();
    ++buildVersion;
    renderedRasters = undefined; terrainRasters = undefined; southRaster = undefined;
    geometry.dispose();
    material.dispose();
    mainTexture?.dispose();
    polarTexture?.dispose();
    elevationTexture?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  resize();
  controls.update();
  loadDetail();
  loadTopography();
  return {
    update(next) {
      if (disposed) return;
      if (next.autoRotate && !options.autoRotate) pausedByInteraction = false;
      options = next;
      loadDetail();
      loadTopography();
      request();
    },
    zoom(amount) {
      if (disposed) return;
      pause();
      camera.position.setLength(THREE.MathUtils.clamp(camera.position.length() * (1 - amount), controls.minDistance, controls.maxDistance));
      controls.update(); request();
    },
    orbit(azimuth, polar) {
      if (disposed) return;
      pause();
      const spherical = new THREE.Spherical().setFromVector3(camera.position);
      spherical.theta += azimuth;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + polar, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.setFromSpherical(spherical);
      controls.update(); request();
    },
    view(preset) {
      if (disposed) return;
      pause();
      if (preset === 'south') camera.position.set(-0.12, -2.3, 0.18);
      else camera.position.set(-4.15, 0.6, 0.35);
      controls.target.set(0, 0, 0);
      controls.update(); request();
    },
    dispose,
  };
}
