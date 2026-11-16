import * as THREE from 'three';

/**
 * Small procedural Earth for the lunar sky. Purely illustrative artwork (procedural continents and
 * clouds, no real geography). It keeps the true apparent size seen from the Moon (~1.9°), is lit by
 * the same Sun direction as the scene (so its phase follows the Sun) and is depth-tested so the
 * horizon and props hide it when it is low or below the horizon.
 */

/** Apparent angular diameter of the Earth from the Moon, degrees (≈ 12 742 km / 384 400 km). */
export const EARTH_ANGULAR_DIAMETER_DEG = 1.9;

// --- tiny deterministic 3D value noise (seamless on the sphere) ---
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), ux), lerp(c(0, 1, 0), c(1, 1, 0), ux), uy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), ux), lerp(c(0, 1, 1), c(1, 1, 1), ux), uy),
    uz,
  );
}

function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(x * f, y * f, z * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Equirectangular RGBA8 (sRGB) Earth-like albedo map; deterministic, works without a canvas. */
export function buildEarthTexture(width = 256, height = 128): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    // DataTexture rows start at v = 0 (south) when flipY is false.
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const sy = Math.sin(lat);
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * Math.PI * 2;
      const px = cl * Math.cos(lon);
      const pz = cl * Math.sin(lon);
      const land = fbm3(px * 1.6 + 3.1, sy * 1.6 - 1.7, pz * 1.6 + 0.4, 881, 5);
      const dry = fbm3(px * 3.2 - 5, sy * 3.2 + 2, pz * 3.2 + 7, 233, 3);
      const cloud = fbm3(px * 2.4 + 11, sy * 4.2 - 4, pz * 2.4 - 2, 419, 5);
      const absLat = Math.abs(lat);

      // Ocean: deep blue, slightly lighter in shallows near coasts.
      let r = 14;
      let g = 42;
      let b = 92;
      const coast = land - 0.53;
      if (coast > 0) {
        // Land: greens near the equator band edges, tans for dry areas.
        const t = Math.min(1, Math.max(0, (dry - 0.42) * 3));
        r = Math.round(58 + (150 - 58) * t);
        g = Math.round(84 + (128 - 84) * t);
        b = Math.round(44 + (86 - 44) * t);
      } else if (coast > -0.03) {
        r = 26;
        g = 70;
        b = 118;
      }
      // Polar ice.
      const ice = Math.min(1, Math.max(0, (absLat - 1.15) * 6));
      r = Math.round(r + (232 - r) * ice);
      g = Math.round(g + (238 - g) * ice);
      b = Math.round(b + (245 - b) * ice);
      // Clouds: banded, more common at mid-latitudes.
      const band = 0.85 + 0.25 * Math.cos(absLat * 3.2);
      const cw = Math.min(0.92, Math.max(0, (cloud * band - 0.45) * 3.4));
      r = Math.round(r + (246 - r) * cw);
      g = Math.round(g + (248 - g) * cw);
      b = Math.round(b + (252 - b) * cw);

      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vNormalW = normalize( mat3( modelMatrix ) * normal );
    vViewDirW = normalize( cameraPosition - wp.xyz );
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDir;
  uniform float uSunIrradiance;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vec3 n = normalize( vNormalW );
    vec3 v = normalize( vViewDirW );
    vec3 albedo = texture2D( uMap, vUv ).rgb;
    float ndl = dot( n, uSunDir );
    float lit = smoothstep( -0.08, 0.25, ndl ) * max( ndl, 0.0 ) * 0.65 + smoothstep( -0.05, 0.15, ndl ) * 0.35;
    vec3 col = albedo * lit * uSunIrradiance;
    // Ocean glint (oceans are the bluest, darkest texels).
    float ocean = smoothstep( 0.05, 0.0, albedo.g - albedo.b * 0.55 );
    vec3 h = normalize( uSunDir + v );
    col += ocean * pow( max( dot( n, h ), 0.0 ), 60.0 ) * 0.35 * step( 0.0, ndl ) * uSunIrradiance;
    // Thin atmosphere: blue rim on the day side.
    float rim = pow( 1.0 - max( dot( n, v ), 0.0 ), 3.0 );
    col += vec3( 0.25, 0.45, 1.0 ) * rim * smoothstep( -0.15, 0.35, ndl ) * 0.45 * uSunIrradiance;
    gl_FragColor = vec4( col, 1.0 );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface EarthBody {
  mesh: THREE.Mesh;
  setDirection(dir: THREE.Vector3): void;
  setSunDirection(dir: THREE.Vector3): void;
  update(camera: THREE.PerspectiveCamera): void;
  dispose(): void;
}

export function createEarth(lowPower: boolean): EarthBody {
  const texture = lowPower ? buildEarthTexture(128, 64) : buildEarthTexture(256, 128);
  // Unit sphere, scaled every frame so it subtends EARTH_ANGULAR_DIAMETER_DEG at its distance.
  const geometry = new THREE.SphereGeometry(1, lowPower ? 24 : 40, lowPower ? 16 : 28);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uSunDir: { value: new THREE.Vector3(0, 0.17, -1).normalize() },
      uSunIrradiance: { value: 1.0 },
    },
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'earth';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Fixed, arbitrary tilt so the poles are not exactly vertical.
  mesh.rotation.set(0.41, 1.3, 0.12);
  const dir = new THREE.Vector3(0.5, 0.05, -1).normalize();
  const halfAngle = ((EARTH_ANGULAR_DIAMETER_DEG / 2) * Math.PI) / 180;
  const camPos = new THREE.Vector3();

  return {
    mesh,
    setDirection(d) {
      dir.copy(d).normalize();
    },
    setSunDirection(d) {
      (material.uniforms.uSunDir.value as THREE.Vector3).copy(d).normalize();
    },
    update(camera) {
      const dist = camera.far * 0.9;
      mesh.position.copy(camera.getWorldPosition(camPos)).addScaledVector(dir, dist);
      mesh.scale.setScalar(dist * Math.sin(halfAngle));
      // Hidden well below the horizon: skip the draw entirely.
      mesh.visible = dir.y > -0.05;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
