import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { resetMoonOrientation, rotateMoonOnOwnAxes } from './ownAxisRotation';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { LandingSiteEntry } from '../navigator/types';
import { bodyDirectionAt, ExplorerSite } from '../explorer/geometry';
import {
  buildLunarAtlasData,
  clamp,
  latLonToSphereUnit,
  loadRealNasaLunarAtlas,
  LunarAtlasData,
  MAX_ELEV_KM,
  MIN_ELEV_KM,
  POLAR_CAP_OUTER_SPAN,
  sampleAtlasElevationKmBilinear,
  sphereUnitToLatLon,
  SurfaceMode,
} from './lunarTerrainEngine';
import {
  SelectionMode,
  SLOT_LABELS,
  SLOT_META,
  SlotLabel,
  ViewportMode,
} from './state';

export interface OriginalLunarViewportProps {
  mode: ViewportMode;
  surfaceMode: SurfaceMode;
  sites: LandingSiteEntry[];
  entries: { label: SlotLabel; site: ExplorerSite }[];
  activeSlotIdx: number;
  onSelectActiveSlot: (index: number) => void;
  epochIdx: number;
  hasStarted: boolean;
  showSkyMarkers?: boolean;
  selectionMode: SelectionMode;
  onSelectSiteDirect: (siteId: string, slotIdx: number) => void;
  onOutsidePolarCoverage: (
    latDeg: number,
    lonEastDeg: number,
    slotIdx: number,
    atlas?: LunarAtlasData,
  ) => void;
  onReticleChange?: (latDeg: number, lonEastDeg: number) => void;
  reticleCoords: { latDeg: number; lonEastDeg: number };
}

const DEG = Math.PI / 180;
const DISP_SCALE = 0.048;
const DISP_BIAS = -0.024;

const _scratchV1 = new THREE.Vector3();
const _scratchV2 = new THREE.Vector3();
const _scratchNorm = new THREE.Vector3();
const _scratchToCam = new THREE.Vector3();
const _scratchHitLocal = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _targetControlsLook = new THREE.Vector3();

const CALLOUT_OFFSETS: Record<SlotLabel, { dx: number; dy: number }> = {
  A: { dx: 34, dy: -26 },
  B: { dx: -34, dy: -26 },
  C: { dx: 34, dy: 26 },
  D: { dx: -34, dy: 26 },
};

function detectSoftwareWebGL(): { supported: boolean; isSoftwareGl: boolean } {
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

function displacedRadiusAt(atlas: LunarAtlasData, latDeg: number, lonEastDeg: number): number {
  const elevKm = sampleAtlasElevationKmBilinear(atlas, latDeg, lonEastDeg);
  const norm = clamp((elevKm - MIN_ELEV_KM) / (MAX_ELEV_KM - MIN_ELEV_KM), 0, 1);
  return 1.0 + norm * DISP_SCALE + DISP_BIAS;
}

function createStarfieldPoints(): THREE.Points {
  const count = 640;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let s = 918273;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const u = rand();
    const v = rand();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 38 + rand() * 14;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const b = 0.25 + Math.pow(rand(), 2.6) * 0.6;
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    sizeAttenuation: true,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function renderSlotShapeSvg(label: SlotLabel, color: string, isArmed: boolean): React.ReactNode {
  const halo = isArmed ? (
    <circle cx={0} cy={0} r={11.5} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="3 2" opacity={0.95} />
  ) : null;

  if (label === 'A') {
    return (
      <>
        {halo}
        <circle cx={0} cy={0} r={5.8} fill={color} stroke="#000000" strokeWidth={1.6} />
      </>
    );
  }
  if (label === 'B') {
    return (
      <>
        {halo}
        <polygon points="0,-7 7,0 0,7 -7,0" fill={color} stroke="#000000" strokeWidth={1.6} />
      </>
    );
  }
  if (label === 'C') {
    return (
      <>
        {halo}
        <polygon points="0,-7.2 6.8,5.2 -6.8,5.2" fill={color} stroke="#000000" strokeWidth={1.6} />
      </>
    );
  }
  return (
    <>
      {halo}
      <rect x={-5.4} y={-5.4} width={10.8} height={10.8} rx={1} fill={color} stroke="#000000" strokeWidth={1.6} />
    </>
  );
}

export const OriginalLunarViewport: React.FC<OriginalLunarViewportProps> = ({
  mode,
  surfaceMode,
  sites,
  entries,
  activeSlotIdx,
  onSelectActiveSlot,
  epochIdx,
  hasStarted,
  showSkyMarkers = true,
  selectionMode,
  onSelectSiteDirect,
  onOutsidePolarCoverage,
  onReticleChange,
  reticleCoords,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const webglMountRef = useRef<HTMLDivElement | null>(null);

  const sitePinRefs = useRef<Record<string, SVGGElement | null>>({});
  const slotMarkerRefs = useRef<Record<SlotLabel, SVGGElement | null>>({
    A: null,
    B: null,
    C: null,
    D: null,
  });
  const sunMarkerRef = useRef<SVGGElement | null>(null);
  const earthMarkerRef = useRef<SVGGElement | null>(null);

  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: 1280,
    h: 720,
  });
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [atlasStatus, setAtlasStatus] = useState<'loading' | 'nasa' | 'fallback'>('loading');

  const primarySite = (entries[activeSlotIdx] ?? entries[0]).site;
  const activeEntry = entries[activeSlotIdx] ?? entries[0];

  const sunDirection = bodyDirectionAt(primarySite, epochIdx, 'sun');
  const earthDirection = bodyDirectionAt(primarySite, epochIdx, 'earth');
  const subSolarLonDeg = sunDirection.lonEastDeg;
  const subSolarLatDeg = sunDirection.latDeg;
  const subEarthLonDeg = earthDirection.lonEastDeg;
  const subEarthLatDeg = earthDirection.latDeg;

  const propsRef = useRef({
    mode,
    surfaceMode,
    sites,
    entries,
    activeSlotIdx,
    hasStarted,
    selectionMode,
    subSolarLonDeg,
    subSolarLatDeg,
    subEarthLonDeg,
    subEarthLatDeg,
    onSelectSiteDirect,
    onOutsidePolarCoverage,
    onReticleChange,
  });
  propsRef.current = {
    mode,
    surfaceMode,
    sites,
    entries,
    activeSlotIdx,
    hasStarted,
    selectionMode,
    subSolarLonDeg,
    subSolarLatDeg,
    subEarthLonDeg,
    subEarthLatDeg,
    onSelectSiteDirect,
    onOutsidePolarCoverage,
    onReticleChange,
  };

  const threeCtrlRef = useRef<{
    requestRender: () => void;
    flyToSouthPole: () => void;
    flyToFullMoon: () => void;
    zoomStep: (delta: number) => void;
    nudgeOrbit: (dAzRad: number, dPolRad: number) => void;
    beginCameraTransition: (started: boolean) => void;
  } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ w: rect.width, h: rect.height });
      }
    };
    updateSize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    observer?.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Mount Three.js 3D Moon WebGL scene ONCE, start with instant baseline, then swap in real NASA 2K + LOLA polar DEM
  useEffect(() => {
    const mountEl = webglMountRef.current;
    if (!mountEl) return undefined;

    const { supported, isSoftwareGl } = detectSoftwareWebGL();
    if (!supported) {
      setRenderStatus('unavailable');
      return undefined;
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const initW = mountEl.clientWidth || window.innerWidth || 1280;
    const initH = mountEl.clientHeight || window.innerHeight || 720;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      setRenderStatus('unavailable');
      return undefined;
    }
    setRenderStatus('ready');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initW, initH);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 1);

    mountEl.innerHTML = '';
    mountEl.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.06;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(34, initW / Math.max(1, initH), 0.1, 100);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl && !reduceMotion;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    // Keep the original offset hero framing; drag the body instead of orbiting
    // the camera around that offset target. Zoom and presets remain unchanged.
    controls.enableRotate = false;
    controls.enableZoom = propsRef.current.hasStarted;
    controls.minDistance = 1.38;
    controls.maxDistance = 12.0;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI - 0.05;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.85;

    const moonGroup = new THREE.Group();
    moonGroup.rotation.x = Math.PI;
    scene.add(moonGroup);

    const maxAniso = Math.min(8, Math.max(1, renderer.capabilities.getMaxAnisotropy()));

    const makeSphericalTex = (
      buf: Uint8Array,
      w: number,
      h: number,
      srgb: boolean,
    ): THREE.DataTexture => {
      const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
      tex.flipY = false;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = maxAniso;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    const makePolarCapTex = (
      buf: Uint8Array,
      size: number,
      srgb: boolean,
    ): THREE.DataTexture => {
      const tex = new THREE.DataTexture(buf, size, size, THREE.RGBAFormat);
      tex.flipY = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = maxAniso;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      return tex;
    };

    let activeAtlas: LunarAtlasData = buildLunarAtlasData(propsRef.current.sites, 256, 128);
    let albedoTex = makeSphericalTex(activeAtlas.albedoRgba, activeAtlas.width, activeAtlas.height, true);
    let topoTex = makeSphericalTex(activeAtlas.topoRgba, activeAtlas.width, activeAtlas.height, true);
    let normalTex = makeSphericalTex(activeAtlas.normalRgba, activeAtlas.width, activeAtlas.height, false);
    let southAlbedoTex = makePolarCapTex(activeAtlas.southCapAlbedoRgba, activeAtlas.southCapWidth, true);
    let southTopoTex = makePolarCapTex(activeAtlas.southCapTopoRgba, activeAtlas.southCapWidth, true);
    let southNormalTex = makePolarCapTex(activeAtlas.southCapNormalRgba, activeAtlas.southCapWidth, false);
    let northAlbedoTex = makePolarCapTex(activeAtlas.northCapAlbedoRgba, activeAtlas.northCapWidth, true);
    let northTopoTex = makePolarCapTex(activeAtlas.northCapTopoRgba, activeAtlas.northCapWidth, true);
    let northNormalTex = makePolarCapTex(activeAtlas.northCapNormalRgba, activeAtlas.northCapWidth, false);

    const rawIco = new THREE.IcosahedronGeometry(1, 48);
    rawIco.deleteAttribute('uv');
    rawIco.deleteAttribute('normal');
    const sphereGeo = mergeVertices(rawIco, 1e-5);
    rawIco.dispose();

    const posAttr = sphereGeo.attributes.position as THREE.BufferAttribute;
    const baseUnitDirs = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const len = Math.hypot(vx, vy, vz) || 1;
      baseUnitDirs[i * 3] = vx / len;
      baseUnitDirs[i * 3 + 1] = vy / len;
      baseUnitDirs[i * 3 + 2] = vz / len;
    }

    const applyVertexDisplacement = (atlasData: LunarAtlasData) => {
      for (let i = 0; i < posAttr.count; i++) {
        const ux = baseUnitDirs[i * 3];
        const uy = baseUnitDirs[i * 3 + 1];
        const uz = baseUnitDirs[i * 3 + 2];
        const { latDeg, lonEastDeg } = sphereUnitToLatLon(ux, uy, uz);
        const elevKm = sampleAtlasElevationKmBilinear(atlasData, latDeg, lonEastDeg);
        const norm = clamp((elevKm - MIN_ELEV_KM) / (MAX_ELEV_KM - MIN_ELEV_KM), 0, 1);
        const r = 1.0 + norm * DISP_SCALE + DISP_BIAS;
        posAttr.setXYZ(i, ux * r, uy * r, uz * r);
      }
      posAttr.needsUpdate = true;
      sphereGeo.computeVertexNormals();
    };

    applyVertexDisplacement(activeAtlas);

    const moonUniforms = {
      uAlbedoTex: { value: albedoTex },
      uTopoTex: { value: topoTex },
      uNormalTex: { value: normalTex },
      uSouthAlbedoTex: { value: southAlbedoTex },
      uSouthTopoTex: { value: southTopoTex },
      uSouthNormalTex: { value: southNormalTex },
      uNorthAlbedoTex: { value: northAlbedoTex },
      uNorthTopoTex: { value: northTopoTex },
      uNorthNormalTex: { value: northNormalTex },
      uPolarInvSpan: { value: 1.0 / POLAR_CAP_OUTER_SPAN },
      uTopoMix: { value: propsRef.current.surfaceMode === 'topography' ? 1.0 : 0.0 },
      uReliefStrength: { value: 1.15 },
    };

    const moonMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.97,
      metalness: 0.0,
      envMapIntensity: 0.05,
    });

    moonMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uAlbedoTex = moonUniforms.uAlbedoTex;
      shader.uniforms.uTopoTex = moonUniforms.uTopoTex;
      shader.uniforms.uNormalTex = moonUniforms.uNormalTex;
      shader.uniforms.uSouthAlbedoTex = moonUniforms.uSouthAlbedoTex;
      shader.uniforms.uSouthTopoTex = moonUniforms.uSouthTopoTex;
      shader.uniforms.uSouthNormalTex = moonUniforms.uSouthNormalTex;
      shader.uniforms.uNorthAlbedoTex = moonUniforms.uNorthAlbedoTex;
      shader.uniforms.uNorthTopoTex = moonUniforms.uNorthTopoTex;
      shader.uniforms.uNorthNormalTex = moonUniforms.uNorthNormalTex;
      shader.uniforms.uPolarInvSpan = moonUniforms.uPolarInvSpan;
      shader.uniforms.uTopoMix = moonUniforms.uTopoMix;
      shader.uniforms.uReliefStrength = moonUniforms.uReliefStrength;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vObjDir;
          varying vec3 vViewRight;
          varying vec3 vViewUp;
          varying vec3 vViewFwd;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vObjDir = normalize(position);
          vViewRight = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
          vViewUp = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
          vViewFwd = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uAlbedoTex;
          uniform sampler2D uTopoTex;
          uniform sampler2D uNormalTex;
          uniform sampler2D uSouthAlbedoTex;
          uniform sampler2D uSouthTopoTex;
          uniform sampler2D uSouthNormalTex;
          uniform sampler2D uNorthAlbedoTex;
          uniform sampler2D uNorthTopoTex;
          uniform sampler2D uNorthNormalTex;
          uniform float uPolarInvSpan;
          uniform float uTopoMix;
          uniform float uReliefStrength;
          varying vec3 vObjDir;
          varying vec3 vViewRight;
          varying vec3 vViewUp;
          varying vec3 vViewFwd;

          vec2 lunarSphereToUv(vec3 p) {
            float lon = atan(p.z, -p.x);
            float u = fract(lon / 6.28318530718 + 0.5);
            float v = clamp(asin(clamp(p.y, -1.0, 1.0)) / 3.14159265359 + 0.5, 0.0005, 0.9995);
            return vec2(u, v);
          }

          vec4 sampleEquirectGrad(sampler2D tex, vec2 uv, vec2 ddx, vec2 ddy) {
            return textureGrad(tex, uv, ddx, ddy);
          }

          vec2 southStereoUv(vec3 p, out float xs, out float ys) {
            float denom = max(0.05, 1.0 - p.y);
            xs = p.z / denom;
            ys = -p.x / denom;
            return vec2(0.5 + xs * uPolarInvSpan, 0.5 - ys * uPolarInvSpan);
          }

          vec2 northStereoUv(vec3 p, out float xs, out float ys) {
            float denom = max(0.05, 1.0 + p.y);
            xs = p.z / denom;
            ys = -p.x / denom;
            return vec2(0.5 + xs * uPolarInvSpan, 0.5 - ys * uPolarInvSpan);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec3 pColorDir = normalize(vObjDir);
          vec2 sphUv = lunarSphereToUv(pColorDir);
          vec2 sphDdx = dFdx(sphUv);
          vec2 sphDdy = dFdy(sphUv);
          if (abs(sphDdx.x) > 0.5) sphDdx.x -= sign(sphDdx.x);
          if (abs(sphDdy.x) > 0.5) sphDdy.x -= sign(sphDdy.x);

          vec3 albCol = sampleEquirectGrad(uAlbedoTex, sphUv, sphDdx, sphDdy).rgb;
          vec3 topCol = sampleEquirectGrad(uTopoTex, sphUv, sphDdx, sphDdy).rgb;

          float sXs;
          float sYs;
          vec2 sUv = clamp(southStereoUv(pColorDir, sXs, sYs), 0.002, 0.998);
          vec2 sDdx = dFdx(sUv);
          vec2 sDdy = dFdy(sUv);
          float wSouth = smoothstep(-0.9026, -0.9272, pColorDir.y);
          if (wSouth > 0.001) {
            albCol = mix(albCol, textureGrad(uSouthAlbedoTex, sUv, sDdx, sDdy).rgb, wSouth);
            topCol = mix(topCol, textureGrad(uSouthTopoTex, sUv, sDdx, sDdy).rgb, wSouth);
          }

          float nXs;
          float nYs;
          vec2 nUv = clamp(northStereoUv(pColorDir, nXs, nYs), 0.002, 0.998);
          vec2 nCapDdx = dFdx(nUv);
          vec2 nCapDdy = dFdy(nUv);
          float wNorth = smoothstep(0.9026, 0.9272, pColorDir.y);
          if (wNorth > 0.001) {
            albCol = mix(albCol, textureGrad(uNorthAlbedoTex, nUv, nCapDdx, nCapDdy).rgb, wNorth);
            topCol = mix(topCol, textureGrad(uNorthTopoTex, nUv, nCapDdx, nCapDdy).rgb, wNorth);
          }

          diffuseColor.rgb *= mix(albCol, topCol, uTopoMix);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          vec3 pDir = normalize(vObjDir);
          vec2 uvN = lunarSphereToUv(pDir);
          vec2 nDdx = dFdx(uvN);
          vec2 nDdy = dFdy(uvN);
          if (abs(nDdx.x) > 0.5) nDdx.x -= sign(nDdx.x);
          if (abs(nDdy.x) > 0.5) nDdy.x -= sign(nDdy.x);

          vec3 nTan = sampleEquirectGrad(uNormalTex, uvN, nDdx, nDdy).xyz * 2.0 - 1.0;
          vec2 xz = vec2(pDir.z, -pDir.x);
          float xzLen = length(xz);
          vec3 eastObj = xzLen > 0.002 ? vec3(xz.x / xzLen, 0.0, xz.y / xzLen) : vec3(0.0, 0.0, 1.0);
          vec3 northObj = normalize(cross(pDir, eastObj));
          vec3 eqObjN = normalize(eastObj * (nTan.x * uReliefStrength) + northObj * (nTan.y * uReliefStrength) + pDir * max(0.45, nTan.z));

          vec3 detailObjN = eqObjN;

          float xsS;
          float ysS;
          vec2 sUvN = clamp(southStereoUv(pDir, xsS, ysS), 0.002, 0.998);
          vec2 sDdxN = dFdx(sUvN);
          vec2 sDdyN = dFdy(sUvN);
          float wSouthN = smoothstep(-0.9026, -0.9272, pDir.y);
          if (wSouthN > 0.001) {
            vec3 nCap = textureGrad(uSouthNormalTex, sUvN, sDdxN, sDdyN).xyz * 2.0 - 1.0;
            vec3 tU = normalize(vec3(2.0 * xsS * ysS, 2.0 * xsS, 1.0 - xsS * xsS + ysS * ysS));
            vec3 tV = normalize(vec3(1.0 + xsS * xsS - ysS * ysS, -2.0 * ysS, 2.0 * xsS * ysS));
            vec3 southObjN = normalize(tU * (nCap.x * uReliefStrength) + tV * (nCap.y * uReliefStrength) + pDir * max(0.42, nCap.z));
            detailObjN = normalize(mix(detailObjN, southObjN, wSouthN));
          }

          float xsN;
          float ysN;
          vec2 nUvN = clamp(northStereoUv(pDir, xsN, ysN), 0.002, 0.998);
          vec2 nDdxN = dFdx(nUvN);
          vec2 nDdyN = dFdy(nUvN);
          float wNorthN = smoothstep(0.9026, 0.9272, pDir.y);
          if (wNorthN > 0.001) {
            vec3 nCap = textureGrad(uNorthNormalTex, nUvN, nDdxN, nDdyN).xyz * 2.0 - 1.0;
            vec3 tU = normalize(vec3(2.0 * xsN * ysN, -2.0 * xsN, 1.0 - xsN * xsN + ysN * ysN));
            vec3 tV = normalize(vec3(1.0 + xsN * xsN - ysN * ysN, 2.0 * ysN, 2.0 * xsN * ysN));
            vec3 northObjN = normalize(tU * (nCap.x * uReliefStrength) + tV * (nCap.y * uReliefStrength) + pDir * max(0.42, nCap.z));
            detailObjN = normalize(mix(detailObjN, northObjN, wNorthN));
          }

          mat3 objToViewMat = mat3(normalize(vViewRight), normalize(vViewUp), normalize(vViewFwd));
          vec3 detailViewN = normalize(objToViewMat * detailObjN);
          vec3 baseSphViewN = normalize(objToViewMat * pDir);
          normal = normalize(normal + (detailViewN - baseSphViewN) * 0.85);`,
        );
    };
    moonMaterial.customProgramCacheKey = () => 'lunar-nasa-real-v6';

    const moonMesh = new THREE.Mesh(sphereGeo, moonMaterial);
    moonMesh.castShadow = !isSoftwareGl;
    moonMesh.receiveShadow = !isSoftwareGl;
    moonGroup.add(moonMesh);

    const starfield = createStarfieldPoints();
    scene.add(starfield);

    const hemiLight = new THREE.HemisphereLight(0xd4d4d8, 0x09090b, 0.22);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.65);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 1.0;
    sunLight.shadow.camera.far = 18.0;
    sunLight.shadow.camera.left = -1.4;
    sunLight.shadow.camera.right = 1.4;
    sunLight.shadow.camera.top = 1.4;
    sunLight.shadow.camera.bottom = -1.4;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.015;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0xa1a1aa, 0.22);
    rimLight.position.set(4, -2, -5);
    scene.add(rimLight);

    const setTargetLayout = (started: boolean, snapImmediate: boolean) => {
      const w = mountEl.clientWidth || initW;
      const h = mountEl.clientHeight || initH;
      const aspect = w / Math.max(1, h);
      const narrowScale = aspect < 0.9 ? Math.max(1.0, 0.88 / aspect) : 1.0;

      if (!started) {
        if (aspect >= 1.0) {
          _targetControlsLook.set(-0.78, 0.0, 0.0);
          _targetCamPos.set(-1.82, 2.28, 3.72);
        } else {
          _targetControlsLook.set(0.0, -0.34, 0.0);
          _targetCamPos.set(-1.1, 2.8, 7.6);
        }
      } else {
        _targetControlsLook.set(0.0, 0.0, 0.0);
        _targetCamPos.set(-0.72 * narrowScale, 3.15 * narrowScale, 1.08 * narrowScale);
      }

      if (snapImmediate) {
        camera.position.copy(_targetCamPos);
        controls.target.copy(_targetControlsLook);
        controls.update();
      }
    };

    setTargetLayout(propsRef.current.hasStarted, true);

    let transitionActive = false;
    let lastFrameTime = performance.now();
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let disposed = false;
    const raycaster = new THREE.Raycaster();

    const applySurfaceAndLighting = () => {
      const { surfaceMode: sm, hasStarted: started, subSolarLonDeg: sLon, subSolarLatDeg: sLat } =
        propsRef.current;

      moonUniforms.uTopoMix.value = sm === 'topography' ? 1.0 : 0.0;
      moonUniforms.uReliefStrength.value = sm === 'topography' ? 1.04 : 1.15;
      controls.enableZoom = started;

      if (sm === 'topography') {
        hemiLight.intensity = 0.96;
        sunLight.intensity = 1.72;
        scene.environmentIntensity = 0.16;
      } else {
        hemiLight.intensity = started ? 0.24 : 0.2;
        sunLight.intensity = started ? 2.65 : 2.75;
        scene.environmentIntensity = 0.05;
      }

      moonGroup.updateMatrixWorld(true);
      if (!started) {
        _scratchV1.set(-4.8, 2.3, 3.5);
      } else {
        const sunLocal = latLonToSphereUnit(sLat, sLon);
        _scratchV1.set(sunLocal.x * 8, sunLocal.y * 8, sunLocal.z * 8);
        _scratchV1.applyQuaternion(moonGroup.quaternion);
      }
      sunLight.position.copy(_scratchV1);
    };

    const projectWorldToOverlay = (
      localVec: THREE.Vector3,
      w: number,
      h: number,
    ): { x: number; y: number; visible: boolean } => {
      _scratchV2.copy(localVec).applyMatrix4(moonGroup.matrixWorld);
      _scratchNorm.copy(_scratchV2).normalize();
      _scratchToCam.copy(camera.position).sub(_scratchV2).normalize();
      const frontFacing = _scratchNorm.dot(_scratchToCam) > 0.04;
      _scratchV2.project(camera);
      return {
        x: (_scratchV2.x * 0.5 + 0.5) * w,
        y: (-_scratchV2.y * 0.5 + 0.5) * h,
        visible: frontFacing && _scratchV2.z > -1 && _scratchV2.z < 1,
      };
    };

    const syncMarkers = () => {
      const p = propsRef.current;
      if (p.mode !== '3d' || !p.hasStarted) return;

      const w = mountEl.clientWidth || initW;
      const h = mountEl.clientHeight || initH;
      moonGroup.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);

      const selectedIds = new Set(p.entries.map((e) => e.site.id));

      for (const s of p.sites) {
        const gEl = sitePinRefs.current[s.id];
        if (!gEl) continue;
        if (selectedIds.has(s.id)) {
          gEl.setAttribute('visibility', 'hidden');
          continue;
        }
        const u = latLonToSphereUnit(s.center.latitude_deg, s.center.longitude_east_deg);
        const r = displacedRadiusAt(activeAtlas, s.center.latitude_deg, s.center.longitude_east_deg);
        _scratchV1.set(u.x * r, u.y * r, u.z * r);
        const proj = projectWorldToOverlay(_scratchV1, w, h);
        if (!proj.visible) {
          gEl.setAttribute('visibility', 'hidden');
        } else {
          gEl.setAttribute('visibility', 'visible');
          gEl.setAttribute('transform', `translate(${proj.x.toFixed(1)}, ${proj.y.toFixed(1)})`);
        }
      }

      const visibleSlots: Array<{
        lbl: SlotLabel;
        el: SVGGElement;
        px: number;
        py: number;
        dx: number;
        dy: number;
      }> = [];

      for (const lbl of SLOT_LABELS) {
        const mEl = slotMarkerRefs.current[lbl];
        if (!mEl) continue;
        const entry = p.entries.find((e) => e.label === lbl);
        if (!entry) {
          mEl.setAttribute('visibility', 'hidden');
          continue;
        }
        const u = latLonToSphereUnit(
          entry.site.center.latitude_deg,
          entry.site.center.longitude_east_deg,
        );
        const r = displacedRadiusAt(
          activeAtlas,
          entry.site.center.latitude_deg,
          entry.site.center.longitude_east_deg,
        );
        _scratchV1.set(u.x * r, u.y * r, u.z * r);
        const proj = projectWorldToOverlay(_scratchV1, w, h);
        if (!proj.visible) {
          mEl.setAttribute('visibility', 'hidden');
        } else {
          mEl.setAttribute('visibility', 'visible');
          mEl.setAttribute('transform', `translate(${proj.x.toFixed(1)}, ${proj.y.toFixed(1)})`);
          const baseOff = CALLOUT_OFFSETS[lbl];
          visibleSlots.push({
            lbl,
            el: mEl,
            px: proj.x,
            py: proj.y,
            dx: baseOff.dx,
            dy: baseOff.dy,
          });
        }
      }

      if (visibleSlots.length > 1) {
        const cx = visibleSlots.reduce((acc, s) => acc + s.px, 0) / visibleSlots.length;
        const cy = visibleSlots.reduce((acc, s) => acc + s.py, 0) / visibleSlots.length;
        for (let i = 0; i < visibleSlots.length; i += 1) {
          const item = visibleSlots[i];
          const vx = item.px - cx;
          const vy = item.py - cy;
          const dist = Math.hypot(vx, vy);
          if (dist > 6) {
            item.dx = (vx / dist) * 44;
            item.dy = (vy / dist) * 42;
          }
        }
        for (let iter = 0; iter < 4; iter += 1) {
          for (let i = 0; i < visibleSlots.length; i += 1) {
            for (let j = i + 1; j < visibleSlots.length; j += 1) {
              const a = visibleSlots[i];
              const b = visibleSlots[j];
              const ax = a.px + a.dx;
              const ay = a.py + a.dy;
              const bx = b.px + b.dx;
              const by = b.py + b.dy;
              const overlapX = 44 - Math.abs(bx - ax);
              const overlapY = 40 - Math.abs(by - ay);
              if (overlapX > 0 && overlapY > 0) {
                const ux = bx - ax;
                const uy = by - ay;
                const d = Math.hypot(ux, uy) || 1;
                const push = 14;
                a.dx -= (ux / d) * push;
                a.dy -= (uy / d) * push;
                b.dx += (ux / d) * push;
                b.dy += (uy / d) * push;
              }
            }
          }
        }
      }

      for (const item of visibleSlots) {
        const lineEl = item.el.querySelector('line.vp-callout-line');
        const rectEl = item.el.querySelector('rect.vp-callout-box');
        const textEl = item.el.querySelector('text.vp-callout-label');
        if (lineEl) {
          lineEl.setAttribute('x2', item.dx.toFixed(1));
          lineEl.setAttribute('y2', item.dy.toFixed(1));
        }
        if (rectEl) {
          rectEl.setAttribute('x', (item.dx - 16).toFixed(1));
          rectEl.setAttribute('y', (item.dy - 15).toFixed(1));
        }
        if (textEl) {
          textEl.setAttribute('x', item.dx.toFixed(1));
          textEl.setAttribute('y', (item.dy + 4.5).toFixed(1));
        }
      }

      const poleUnit = latLonToSphereUnit(-90, 0);
      const poleProj = projectWorldToOverlay(
        _scratchV1.set(poleUnit.x * 1.04, poleUnit.y * 1.04, poleUnit.z * 1.04),
        w,
        h,
      );

      if (sunMarkerRef.current) {
        const sU = latLonToSphereUnit(p.subSolarLatDeg, p.subSolarLonDeg);
        const sunProj = projectWorldToOverlay(
          _scratchV1.set(sU.x * 1.04, sU.y * 1.04, sU.z * 1.04),
          w,
          h,
        );
        if (poleProj.visible && sunProj.visible) {
          sunMarkerRef.current.setAttribute('visibility', 'visible');
          const lineEl = sunMarkerRef.current.querySelector('line');
          const dotEl = sunMarkerRef.current.querySelector('circle');
          const textEl = sunMarkerRef.current.querySelector('text');
          if (lineEl) {
            lineEl.setAttribute('x1', poleProj.x.toFixed(1));
            lineEl.setAttribute('y1', poleProj.y.toFixed(1));
            lineEl.setAttribute('x2', sunProj.x.toFixed(1));
            lineEl.setAttribute('y2', sunProj.y.toFixed(1));
          }
          if (dotEl) {
            dotEl.setAttribute('cx', sunProj.x.toFixed(1));
            dotEl.setAttribute('cy', sunProj.y.toFixed(1));
          }
          if (textEl) {
            textEl.setAttribute('x', (sunProj.x + 8).toFixed(1));
            textEl.setAttribute('y', (sunProj.y + 4).toFixed(1));
          }
        } else {
          sunMarkerRef.current.setAttribute('visibility', 'hidden');
        }
      }

      if (earthMarkerRef.current) {
        const eU = latLonToSphereUnit(p.subEarthLatDeg, p.subEarthLonDeg);
        const earthProj = projectWorldToOverlay(
          _scratchV1.set(eU.x * 1.04, eU.y * 1.04, eU.z * 1.04),
          w,
          h,
        );
        if (poleProj.visible && earthProj.visible) {
          earthMarkerRef.current.setAttribute('visibility', 'visible');
          const lineEl = earthMarkerRef.current.querySelector('line');
          const dotEl = earthMarkerRef.current.querySelector('circle');
          const textEl = earthMarkerRef.current.querySelector('text');
          if (lineEl) {
            lineEl.setAttribute('x1', poleProj.x.toFixed(1));
            lineEl.setAttribute('y1', poleProj.y.toFixed(1));
            lineEl.setAttribute('x2', earthProj.x.toFixed(1));
            lineEl.setAttribute('y2', earthProj.y.toFixed(1));
          }
          if (dotEl) {
            dotEl.setAttribute('cx', earthProj.x.toFixed(1));
            dotEl.setAttribute('cy', earthProj.y.toFixed(1));
          }
          if (textEl) {
            textEl.setAttribute('x', (earthProj.x + 8).toFixed(1));
            textEl.setAttribute('y', (earthProj.y + 4).toFixed(1));
          }
        } else {
          earthMarkerRef.current.setAttribute('visibility', 'hidden');
        }
      }
    };

    const updateReticleCoords = () => {
      const p = propsRef.current;
      if (!p.onReticleChange || !p.hasStarted || p.mode !== '3d') return;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits = raycaster.intersectObject(moonMesh, false);
      if (hits.length > 0) {
        _scratchHitLocal.copy(hits[0].point);
        moonGroup.worldToLocal(_scratchHitLocal);
        const geo = sphereUnitToLatLon(_scratchHitLocal.x, _scratchHitLocal.y, _scratchHitLocal.z);
        p.onReticleChange(geo.latDeg, geo.lonEastDeg);
      }
    };

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 40);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 65);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (propsRef.current.mode !== '3d') return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const dt = Math.min(0.08, Math.max(0.001, (now - lastFrameTime) / 1000));
        lastFrameTime = now;

        if (transitionActive) {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 6.5, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 6.5, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 6.5, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetControlsLook.x, 7.5, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetControlsLook.y, 7.5, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetControlsLook.z, 7.5, dt);

          const distLeft =
            camera.position.distanceTo(_targetCamPos) + controls.target.distanceTo(_targetControlsLook);
          if (distLeft < 0.008) {
            camera.position.copy(_targetCamPos);
            controls.target.copy(_targetControlsLook);
            transitionActive = false;
          } else {
            renderDirty = true;
          }
        }

        const didMove = controls.update();
        if (didMove && !isSoftwareGl) {
          renderDirty = true;
        }
        applySurfaceAndLighting();
        renderer.render(scene, camera);
        syncMarkers();

        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    };

    // Load genuine NASA LRO LROC + LOLA 2K & South Pole LDEM_80S_80M and upgrade textures + 3D relief
    loadRealNasaLunarAtlas()
      .then((realAtlas) => {
        if (disposed) return;
        setAtlasStatus('nasa');
        activeAtlas = realAtlas;
        applyVertexDisplacement(realAtlas);

        const nextAlbedo = makeSphericalTex(realAtlas.albedoRgba, realAtlas.width, realAtlas.height, true);
        const nextTopo = makeSphericalTex(realAtlas.topoRgba, realAtlas.width, realAtlas.height, true);
        const nextNormal = makeSphericalTex(realAtlas.normalRgba, realAtlas.width, realAtlas.height, false);
        const nextSouthAlbedo = makePolarCapTex(realAtlas.southCapAlbedoRgba, realAtlas.southCapWidth, true);
        const nextSouthTopo = makePolarCapTex(realAtlas.southCapTopoRgba, realAtlas.southCapWidth, true);
        const nextSouthNormal = makePolarCapTex(realAtlas.southCapNormalRgba, realAtlas.southCapWidth, false);
        const nextNorthAlbedo = makePolarCapTex(realAtlas.northCapAlbedoRgba, realAtlas.northCapWidth, true);
        const nextNorthTopo = makePolarCapTex(realAtlas.northCapTopoRgba, realAtlas.northCapWidth, true);
        const nextNorthNormal = makePolarCapTex(realAtlas.northCapNormalRgba, realAtlas.northCapWidth, false);

        const prevTextures = [
          albedoTex,
          topoTex,
          normalTex,
          southAlbedoTex,
          southTopoTex,
          southNormalTex,
          northAlbedoTex,
          northTopoTex,
          northNormalTex,
        ];

        albedoTex = nextAlbedo;
        topoTex = nextTopo;
        normalTex = nextNormal;
        southAlbedoTex = nextSouthAlbedo;
        southTopoTex = nextSouthTopo;
        southNormalTex = nextSouthNormal;
        northAlbedoTex = nextNorthAlbedo;
        northTopoTex = nextNorthTopo;
        northNormalTex = nextNorthNormal;

        moonUniforms.uAlbedoTex.value = nextAlbedo;
        moonUniforms.uTopoTex.value = nextTopo;
        moonUniforms.uNormalTex.value = nextNormal;
        moonUniforms.uSouthAlbedoTex.value = nextSouthAlbedo;
        moonUniforms.uSouthTopoTex.value = nextSouthTopo;
        moonUniforms.uSouthNormalTex.value = nextSouthNormal;
        moonUniforms.uNorthAlbedoTex.value = nextNorthAlbedo;
        moonUniforms.uNorthTopoTex.value = nextNorthTopo;
        moonUniforms.uNorthNormalTex.value = nextNorthNormal;

        prevTextures.forEach((t) => t.dispose());

        requestRender();
      })
      .catch(() => {
        if (!disposed) setAtlasStatus('fallback');
      });

    const onControlsStart = () => {
      transitionActive = false;
    };
    const onControlsChange = () => {
      updateReticleCoords();
      requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    let pointerDownPos: { x: number; y: number } | null = null;
    let lastPointerPos: { x: number; y: number } | null = null;
    let dragPointerId: number | null = null;
    const pointerIds = new Set<number>();
    const onPointerDown = (e: PointerEvent) => {
      pointerIds.add(e.pointerId);
      if (pointerIds.size > 1 || e.button !== 0) {
        pointerDownPos = null;
        lastPointerPos = null;
        dragPointerId = null;
        return;
      }
      transitionActive = false;
      pointerDownPos = { x: e.clientX, y: e.clientY };
      lastPointerPos = pointerDownPos;
      dragPointerId = e.pointerId;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerId || !lastPointerPos || propsRef.current.mode !== '3d') return;
      const dx = e.clientX - lastPointerPos.x;
      const dy = e.clientY - lastPointerPos.y;
      lastPointerPos = { x: e.clientX, y: e.clientY };
      const radiansPerPixel = (Math.PI * 2 * controls.rotateSpeed) / Math.max(1, renderer.domElement.clientHeight || initH);
      rotateMoonOnOwnAxes(moonGroup, camera, -dx * radiansPerPixel, dy * radiansPerPixel);
      updateReticleCoords();
      requestRender();
    };
    const onPointerCancel = (e: PointerEvent) => {
      pointerIds.delete(e.pointerId);
      pointerDownPos = null;
      lastPointerPos = null;
      dragPointerId = null;
    };
    const onPointerUp = (e: PointerEvent) => {
      pointerIds.delete(e.pointerId);
      if (e.pointerId !== dragPointerId || !pointerDownPos) return;
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      pointerDownPos = null;
      lastPointerPos = null;
      dragPointerId = null;
      const p = propsRef.current;
      if (dist > 6 || !p.hasStarted || p.mode !== '3d' || p.selectionMode !== 'cursor') return;

      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(moonMesh, false);
      if (hits.length > 0) {
        _scratchHitLocal.copy(hits[0].point);
        moonGroup.worldToLocal(_scratchHitLocal);
        const geo = sphereUnitToLatLon(_scratchHitLocal.x, _scratchHitLocal.y, _scratchHitLocal.z);
        p.onOutsidePolarCoverage(geo.latDeg, geo.lonEastDeg, p.activeSlotIdx, activeAtlas);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);

    const onResize = () => {
      const w = mountEl.clientWidth || window.innerWidth || 1280;
      const h = mountEl.clientHeight || window.innerHeight || 720;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      setTargetLayout(propsRef.current.hasStarted, true);
      requestRender();
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    resizeObserver?.observe(mountEl);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    threeCtrlRef.current = {
      requestRender,
      beginCameraTransition: (started: boolean) => {
        resetMoonOrientation(moonGroup);
        setTargetLayout(started, isSoftwareGl || reduceMotion);
        transitionActive = !isSoftwareGl && !reduceMotion;
        updateReticleCoords();
        requestRender();
      },
      flyToSouthPole: () => {
        resetMoonOrientation(moonGroup);
        const w = mountEl.clientWidth || initW;
        const h = mountEl.clientHeight || initH;
        const aspect = w / Math.max(1, h);
        const narrowScale = aspect < 0.9 ? Math.max(1.0, 0.88 / aspect) : 1.0;
        _targetControlsLook.set(0, 0, 0);
        _targetCamPos.set(-0.18 * narrowScale, 1.76 * narrowScale, 0.18 * narrowScale);
        if (isSoftwareGl || reduceMotion) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetControlsLook);
          controls.update();
          transitionActive = false;
        } else {
          transitionActive = true;
        }
        updateReticleCoords();
        requestRender();
      },
      flyToFullMoon: () => {
        resetMoonOrientation(moonGroup);
        const w = mountEl.clientWidth || initW;
        const h = mountEl.clientHeight || initH;
        const aspect = w / Math.max(1, h);
        const narrowScale = aspect < 0.9 ? Math.max(1.0, 0.88 / aspect) : 1.0;
        _targetControlsLook.set(0, 0, 0);
        _targetCamPos.set(-1.15 * narrowScale, 3.85 * narrowScale, 2.2 * narrowScale);
        if (isSoftwareGl || reduceMotion) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetControlsLook);
          controls.update();
          transitionActive = false;
        } else {
          transitionActive = true;
        }
        updateReticleCoords();
        requestRender();
      },
      zoomStep: (delta: number) => {
        transitionActive = false;
        const offset = camera.position.clone().sub(controls.target);
        const curLen = offset.length();
        const nextLen = clamp(curLen * (1 - delta), controls.minDistance, controls.maxDistance);
        offset.setLength(nextLen);
        camera.position.copy(controls.target).add(offset);
        controls.update();
        requestRender();
      },
      nudgeOrbit: (dAzRad: number, dPolRad: number) => {
        transitionActive = false;
        rotateMoonOnOwnAxes(moonGroup, camera, -dAzRad, dPolRad);
        updateReticleCoords();
        requestRender();
      },
    };

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      sphereGeo.dispose();
      moonMaterial.dispose();
      albedoTex.dispose();
      topoTex.dispose();
      normalTex.dispose();
      southAlbedoTex.dispose();
      southTopoTex.dispose();
      southNormalTex.dispose();
      northAlbedoTex.dispose();
      northTopoTex.dispose();
      northNormalTex.dispose();
      envTarget.dispose();
      starfield.geometry.dispose();
      (starfield.material as THREE.Material).dispose();
      renderer.dispose();
      threeCtrlRef.current = null;
    };
  }, []);

  const prevStartedRef = useRef(hasStarted);
  const entrySignature = entries.map((e) => `${e.label}:${e.site.id}`).join('|');

  useEffect(() => {
    const ctrl = threeCtrlRef.current;
    if (!ctrl) return;
    if (prevStartedRef.current !== hasStarted) {
      prevStartedRef.current = hasStarted;
      ctrl.beginCameraTransition(hasStarted);
      return;
    }
    if (mode === '3d') {
      ctrl.requestRender();
    }
  }, [hasStarted, mode, surfaceMode, entrySignature, activeSlotIdx, epochIdx, showSkyMarkers, viewportSize.w, viewportSize.h]);

  const svgW = viewportSize.w;
  const svgH = viewportSize.h;
  const centerX = svgW / 2;
  const centerY = svgH / 2;

  const handleStageKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasStarted || mode !== '3d') return;
    const stepRad = (e.shiftKey ? 10 : 4) * DEG;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      threeCtrlRef.current?.nudgeOrbit(-stepRad, 0);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      threeCtrlRef.current?.nudgeOrbit(stepRad, 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      threeCtrlRef.current?.nudgeOrbit(0, -stepRad);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      threeCtrlRef.current?.nudgeOrbit(0, stepRad);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      threeCtrlRef.current?.zoomStep(0.18);
    } else if (e.key === '-') {
      e.preventDefault();
      threeCtrlRef.current?.zoomStep(-0.18);
    }
  };

  const selectedIds = new Set(entries.map((e) => e.site.id));

  return (
    <div
      ref={stageRef}
      className="lunar-stage"
      data-viewport-mode={mode}
      data-surface-mode={surfaceMode}
      data-site-a={entries[0]?.site.id ?? ''}
      data-slots-count={entries.length}
      tabIndex={hasStarted && mode === '3d' ? 0 : -1}
      onKeyDown={handleStageKeyDown}
      role="region"
      aria-label={`NASA LRO 3D Moon globe (${surfaceMode === 'topography' ? 'LOLA Elevation' : 'LROC Surface'}). Drag to rotate or select a pin for Site ${activeEntry.label}.`}
    >
      <div
        ref={webglMountRef}
        data-testid="lunar-webgl-canvas"
        className={`lunar-webgl-mount ${mode === '3d' ? 'is-visible' : 'is-hidden'} ${
          selectionMode === 'cursor' && hasStarted ? 'cursor-pick' : 'cursor-grab'
        }`}
        aria-hidden={mode !== '3d'}
      />
      <p className="viewport-status" role="status" aria-label="3D view status">
        {renderStatus === 'unavailable'
          ? '3D view unavailable. Choose a location from the list to keep exploring.'
          : atlasStatus === 'nasa'
            ? 'NASA imagery · relief is visual only'
            : atlasStatus === 'fallback'
              ? 'Illustrative fallback surface · NASA imagery could not load'
              : 'Loading NASA imagery · temporary illustrative surface'}
      </p>

      {mode === '3d' && (
        <svg
          className="lunar-hud-overlay overlay-passthrough"
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          role="img"
          aria-label={`3D Moon site markers for ${entries.map((e) => `${e.label}: ${e.site.name}`).join(', ')}`}
        >
          {hasStarted && showSkyMarkers && (
            <g pointerEvents="none" opacity={0.85}>
              <g ref={sunMarkerRef} visibility="hidden">
                <line stroke="#ffffff" strokeWidth={1.2} strokeDasharray="4 3" />
                <circle r={3.8} fill="#ffffff" stroke="#000000" strokeWidth={1.2} />
                <text className="vp-vec-sun">Sun</text>
              </g>
              <g ref={earthMarkerRef} visibility="hidden">
                <line stroke="#a1a1aa" strokeWidth={1.2} strokeDasharray="2 3" />
                <circle r={3.8} fill="#a1a1aa" stroke="#000000" strokeWidth={1.2} />
                <text className="vp-vec-earth">Earth</text>
              </g>
            </g>
          )}

          {hasStarted &&
            sites.map((site) => {
              if (selectedIds.has(site.id)) return null;
              const isHovered = hoveredPinId === site.id;
              const labelW = Math.max(96, site.name.length * 6.6 + 18);
              return (
                <g
                  key={site.id}
                  ref={(el) => {
                    sitePinRefs.current[site.id] = el;
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Assign ${site.name} to Site ${activeEntry.label}`}
                  className="vp-site-pin overlay-pointer-target"
                  visibility="hidden"
                  onMouseEnter={() => setHoveredPinId(site.id)}
                  onMouseLeave={() => setHoveredPinId((prev) => (prev === site.id ? null : prev))}
                  onFocus={() => setHoveredPinId(site.id)}
                  onBlur={() => setHoveredPinId((prev) => (prev === site.id ? null : prev))}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSiteDirect(site.id, activeSlotIdx);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectSiteDirect(site.id, activeSlotIdx);
                    }
                  }}
                >
                  <circle cx={0} cy={0} r={17} fill="transparent" />
                  <circle
                    cx={0}
                    cy={0}
                    r={isHovered ? 7.5 : 5}
                    fill={site.center.is_psr ? '#71717a' : '#ffffff'}
                    stroke="#000000"
                    strokeWidth={isHovered ? 2 : 1.5}
                    opacity={0.95}
                  />
                  {isHovered && (
                    <g transform="translate(12, -13)" pointerEvents="none">
                      <rect
                        x={0}
                        y={-12}
                        width={labelW}
                        height={24}
                        rx={3}
                        fill="rgba(0, 0, 0, 0.94)"
                      />
                      <text x={8} y={4} className="vp-pin-hover-label">
                        {site.name}
                      </text>
                    </g>
                  )}
                  <title>{`${site.name} — Click to set Site ${activeEntry.label}`}</title>
                </g>
              );
            })}

          {hasStarted &&
            SLOT_LABELS.map((lbl) => {
              const entryIndex = entries.findIndex((e) => e.label === lbl);
              const entry = entryIndex >= 0 ? entries[entryIndex] : null;
              const off = CALLOUT_OFFSETS[lbl];
              const meta = SLOT_META[lbl];
              const isArmed = entryIndex === activeSlotIdx;
              const boxX = off.dx - 16;
              const boxY = off.dy - 15;

              return (
                <g
                  key={lbl}
                  ref={(el) => {
                    slotMarkerRefs.current[lbl] = el;
                  }}
                  className="vp-marker-slot overlay-pointer-target"
                  role="button"
                  tabIndex={entry ? 0 : -1}
                  aria-label={entry ? `Site ${lbl}: ${entry.site.name}` : undefined}
                  visibility="hidden"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (entryIndex >= 0) onSelectActiveSlot(entryIndex);
                  }}
                  onKeyDown={(e) => {
                    if (entryIndex >= 0 && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectActiveSlot(entryIndex);
                    }
                  }}
                >
                  <line
                    className="vp-callout-line"
                    x1={0}
                    y1={0}
                    x2={off.dx}
                    y2={off.dy}
                    stroke={meta.color}
                    strokeWidth={1.4}
                  />
                  {renderSlotShapeSvg(lbl, meta.color, isArmed)}
                  <rect
                    className="vp-callout-box"
                    x={boxX}
                    y={boxY}
                    width={32}
                    height={30}
                    rx={3}
                    fill={isArmed ? '#ffffff' : 'rgba(10, 10, 12, 0.92)'}
                  />
                  <text
                    className="vp-callout-label"
                    x={off.dx}
                    y={off.dy + 4.5}
                    textAnchor="middle"
                    fill={isArmed ? '#000000' : '#ffffff'}
                    fontSize={13}
                    fontWeight={600}
                  >
                    {lbl}
                  </text>
                  {entry && <title>{`Site ${lbl}: ${entry.site.name}`}</title>}
                </g>
              );
            })}

          {hasStarted && selectionMode === 'crosshair' && (
            <g data-testid="center-crosshair" className="vp-crosshair" pointerEvents="none">
              <circle cx={centerX} cy={centerY} r={20} fill="none" stroke="#ffffff" strokeWidth={1.2} strokeDasharray="4 3" />
              <line x1={centerX - 30} y1={centerY} x2={centerX - 10} y2={centerY} stroke="#ffffff" strokeWidth={1.4} />
              <line x1={centerX + 10} y1={centerY} x2={centerX + 30} y2={centerY} stroke="#ffffff" strokeWidth={1.4} />
              <line x1={centerX} y1={centerY - 30} x2={centerX} y2={centerY - 10} stroke="#ffffff" strokeWidth={1.4} />
              <line x1={centerX} y1={centerY + 10} x2={centerX} y2={centerY + 30} stroke="#ffffff" strokeWidth={1.4} />
              <circle cx={centerX} cy={centerY} r={2.8} fill="#ffffff" />
              <text x={centerX} y={centerY + 40} textAnchor="middle" className="vp-crosshair-readout">
                {reticleCoords.latDeg.toFixed(1)}°, {reticleCoords.lonEastDeg.toFixed(1)}° E
              </text>
            </g>
          )}
        </svg>
      )}

      {hasStarted && mode === '3d' && (
        <div className="viewport-camera-tools" aria-label="Lunar globe camera controls">
          <button
            type="button"
            className="cam-btn"
            onClick={() => threeCtrlRef.current?.zoomStep(0.18)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="cam-btn"
            onClick={() => threeCtrlRef.current?.zoomStep(-0.18)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="cam-btn cam-btn-pole"
            onClick={() => threeCtrlRef.current?.flyToSouthPole()}
          >
            South Pole
          </button>
          <button
            type="button"
            className="cam-btn cam-btn-pole"
            onClick={() => threeCtrlRef.current?.flyToFullMoon()}
          >
            Globe
          </button>
        </div>
      )}
    </div>
  );
};
