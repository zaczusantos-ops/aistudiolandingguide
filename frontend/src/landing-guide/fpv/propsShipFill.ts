import type * as THREE from 'three';

/**
 * Ambient fill for the ship's painted hull. In the reference walk the landed ship reads evenly lit
 * on every face it shows (flank ≈ 115–130 sRGB) even where the hazard containers beside it, facing
 * the same way, fall into shade: the game scene clearly lit its hero hull with a strong ambient term.
 * The scene's own fill (regolith-bounce environment) is calibrated for dark shaded props, so the hull
 * gets this extra term instead: `albedo · strength · (base + up · n.y)` added to the indirect
 * diffuse light, which keeps tops a little brighter than flanks and leaves the baked per-vertex
 * shading (darker undersides, light chamfers) and the sunlit faces' extra brightness intact.
 * Illustrative look-matching only.
 */
export function addHullFill(material: THREE.MeshStandardMaterial, strength: number, base = 0.85, up = 0.3): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHullFill = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHullFill;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          vec3 upView = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
          float k = clamp( ${base.toFixed(3)} + ${up.toFixed(3)} * dot( normal, upView ), 0.0, 2.0 );
          reflectedLight.indirectDiffuse += material.diffuseColor * ( uHullFill * k );
        }`,
      );
  };
  material.customProgramCacheKey = () => `hull-fill-${base}-${up}`;
}
