import { Color, MeshPhysicalMaterial } from 'three';
import type { MaterialParams } from '../../types';

export interface BismuthMaterialController {
  material: MeshPhysicalMaterial;
  setParams(partial: Partial<MaterialParams>): void;
  setSeed(seed: number): void;
  setTime(seconds: number): void;
  dispose(): void;
}

interface UniformState {
  uIriStrength: { value: number };
  uHueBandFreq: { value: number };
  uHuePhaseSpeed: { value: number };
  uSeedPhase: { value: number };
  uTime: { value: number };
}

interface MaterialShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

function normalizeSeed(seed: number): number {
  const value = Math.abs(seed % 1000000);
  return value / 1000000;
}

export function createBismuthMaterial(initialParams: MaterialParams, seed: number): BismuthMaterialController {
  const material = new MeshPhysicalMaterial({
    color: new Color('#f2f2ff'),
    metalness: 0.9,
    roughness: 0.2,
    clearcoat: 0.9,
    clearcoatRoughness: 0.18,
    envMapIntensity: 1,
    iridescence: 1,
    iridescenceIOR: 1.55,
    iridescenceThicknessRange: [160, 690],
    toneMapped: true,
  });

  const params: MaterialParams = {
    iridescenceStrength: initialParams.iridescenceStrength,
    hueBandFrequency: initialParams.hueBandFrequency,
    huePhaseSpeed: initialParams.huePhaseSpeed,
  };

  const uniforms: UniformState = {
    uIriStrength: { value: params.iridescenceStrength },
    uHueBandFreq: { value: params.hueBandFrequency },
    uHuePhaseSpeed: { value: params.huePhaseSpeed },
    uSeedPhase: { value: normalizeSeed(seed) },
    uTime: { value: 0 },
  };

  let shaderRef: MaterialShaderLike | null = null;

  material.onBeforeCompile = (shader) => {
    const shaderLike = shader as MaterialShaderLike;
    shaderRef = shaderLike;
    shaderLike.uniforms.uIriStrength = uniforms.uIriStrength;
    shaderLike.uniforms.uHueBandFreq = uniforms.uHueBandFreq;
    shaderLike.uniforms.uHuePhaseSpeed = uniforms.uHuePhaseSpeed;
    shaderLike.uniforms.uSeedPhase = uniforms.uSeedPhase;
    shaderLike.uniforms.uTime = uniforms.uTime;

    shaderLike.vertexShader = shaderLike.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosBismuth;
varying vec3 vWorldNormalBismuth;
`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWorldPosBismuth = (modelMatrix * vec4(transformed, 1.0)).xyz;
mat3 worldNormalMatrix = transpose(inverse(mat3(modelMatrix)));
vWorldNormalBismuth = normalize(worldNormalMatrix * objectNormal);
`,
      );

    shaderLike.fragmentShader = shaderLike.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPosBismuth;
varying vec3 vWorldNormalBismuth;
uniform float uIriStrength;
uniform float uHueBandFreq;
uniform float uHuePhaseSpeed;
uniform float uSeedPhase;
uniform float uTime;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

vec3 hueToRgb(float h) {
  vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return rgb * rgb * (3.0 - 2.0 * rgb);
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 iriNormal = normalize(vWorldNormalBismuth);
vec3 iriViewDir = normalize(cameraPosition - vWorldPosBismuth);
float fresnel = pow(1.0 - max(dot(iriNormal, iriViewDir), 0.0), 2.9);
float jitter = hash13(vWorldPosBismuth * 0.71 + vec3(uSeedPhase));
float phase =
  dot(vWorldPosBismuth, vec3(0.33, 0.51, 0.67)) * uHueBandFreq +
  dot(iriNormal, vec3(-0.41, 0.27, 0.87)) * 0.75 +
  uSeedPhase * 13.0 +
  jitter * 0.6 +
  uTime * uHuePhaseSpeed;
vec3 iridescent = hueToRgb(fract(phase));
diffuseColor.rgb += iridescent * fresnel * uIriStrength;
`,
      );
  };

  const updateUniforms = (): void => {
    uniforms.uIriStrength.value = params.iridescenceStrength;
    uniforms.uHueBandFreq.value = params.hueBandFrequency;
    uniforms.uHuePhaseSpeed.value = params.huePhaseSpeed;
    if (shaderRef) {
      shaderRef.uniforms.uIriStrength = uniforms.uIriStrength;
      shaderRef.uniforms.uHueBandFreq = uniforms.uHueBandFreq;
      shaderRef.uniforms.uHuePhaseSpeed = uniforms.uHuePhaseSpeed;
      shaderRef.uniforms.uSeedPhase = uniforms.uSeedPhase;
      shaderRef.uniforms.uTime = uniforms.uTime;
    }
  };

  updateUniforms();

  return {
    material,
    setParams(partial: Partial<MaterialParams>): void {
      params.iridescenceStrength = partial.iridescenceStrength ?? params.iridescenceStrength;
      params.hueBandFrequency = partial.hueBandFrequency ?? params.hueBandFrequency;
      params.huePhaseSpeed = partial.huePhaseSpeed ?? params.huePhaseSpeed;
      updateUniforms();
    },
    setSeed(nextSeed: number): void {
      uniforms.uSeedPhase.value = normalizeSeed(nextSeed);
    },
    setTime(seconds: number): void {
      uniforms.uTime.value = seconds;
    },
    dispose(): void {
      material.dispose();
      shaderRef = null;
    },
  };
}
