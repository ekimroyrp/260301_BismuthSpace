import { Color, MathUtils, MeshPhysicalMaterial } from 'three';
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

function applyReflectiveness(material: MeshPhysicalMaterial, reflectiveness: number): void {
  const t = MathUtils.clamp(reflectiveness, 0, 1);
  material.roughness = MathUtils.lerp(0.62, 0.08, t);
  material.envMapIntensity = MathUtils.lerp(0.15, 1.75, t);
  material.clearcoat = MathUtils.lerp(0, 0.55, t);
  material.clearcoatRoughness = MathUtils.lerp(0.75, 0.05, t);
  material.iridescence = MathUtils.lerp(0.3, 0.85, t);
  material.needsUpdate = true;
}

export function createBismuthMaterial(initialParams: MaterialParams, seed: number): BismuthMaterialController {
  const material = new MeshPhysicalMaterial({
    color: new Color('#f5f7fa'),
    flatShading: true,
    metalness: 1,
    roughness: 0.08,
    clearcoat: 0.55,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.75,
    iridescence: 0.85,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [120, 980],
    toneMapped: true,
  });

  const params: MaterialParams = {
    iridescenceStrength: initialParams.iridescenceStrength,
    hueBandFrequency: initialParams.hueBandFrequency,
    huePhaseSpeed: initialParams.huePhaseSpeed,
    reflectiveness: MathUtils.clamp(initialParams.reflectiveness ?? 1, 0, 1),
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
vWorldPosBismuth = worldPosition.xyz;
vWorldNormalBismuth = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
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

float saturate01(float value) {
  return clamp(value, 0.0, 1.0);
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

float smoothNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
}

vec3 bismuthPalette(float t) {
  t = fract(t);
  vec3 c0 = vec3(1.00, 0.84, 0.20); // gold
  vec3 c1 = vec3(1.00, 0.33, 0.77); // pink-magenta
  vec3 c2 = vec3(0.18, 0.93, 1.00); // cyan-blue
  vec3 c3 = vec3(0.30, 1.00, 0.46); // green
  if (t < 0.25) {
    return mix(c0, c1, t * 4.0);
  }
  if (t < 0.50) {
    return mix(c1, c2, (t - 0.25) * 4.0);
  }
  if (t < 0.75) {
    return mix(c2, c3, (t - 0.50) * 4.0);
  }
  return mix(c3, c0, (t - 0.75) * 4.0);
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 iriNormal = normalize(vWorldNormalBismuth);
vec3 iriViewDir = normalize(cameraPosition - vWorldPosBismuth);
float ndv = saturate01(dot(iriNormal, iriViewDir));
float jitter = smoothNoise3(vWorldPosBismuth * 1.5 + vec3(uSeedPhase * 83.0));
float broadNoise = smoothNoise3(vWorldPosBismuth * 0.48 + vec3(11.7));

// Approximate oxide-film thickness variations with continuous, non-blocky bands.
float bandFreq = max(0.2, uHueBandFreq);
float facetBand =
  (vWorldPosBismuth.y * 1.8 + vWorldPosBismuth.x * 0.42 - vWorldPosBismuth.z * 0.31) * bandFreq;
float stepBand = (abs(vWorldPosBismuth.x) + abs(vWorldPosBismuth.z)) * 0.92;
float swirl =
  0.5 +
  0.5 *
    sin(
      dot(vWorldPosBismuth, vec3(0.73, 0.51, -0.46)) * bandFreq * 1.25 +
      broadNoise * 4.6 +
      uSeedPhase * 6.283
    );
float thicknessT = fract(facetBand * 0.123 + stepBand * 0.081 + swirl * 0.39 + jitter * 0.27 + uSeedPhase * 5.7);
float thicknessNm = mix(120.0, 980.0, thicknessT);

// Thin-film interference approximation by wavelength.
vec3 wavelengths = vec3(680.0, 540.0, 440.0);
vec3 phase = (4.0 * PI * 1.65 * thicknessNm * max(ndv, 0.08)) / wavelengths;
vec3 interference = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.094, 4.188));

float hueSweep =
  fract(
    thicknessT * (0.55 + uHueBandFreq * 0.65) +
    dot(iriNormal, vec3(0.23, 0.11, -0.37)) * 0.18 +
    uTime * uHuePhaseSpeed * 0.02
  );
vec3 oxidePalette = bismuthPalette(hueSweep);
vec3 oxideColor = mix(interference, oxidePalette, 0.68);

float fresnel = pow(1.0 - ndv, 2.2);
float iriStrength = saturate01(uIriStrength);
float filmAmount = iriStrength * (0.48 + 0.52 * fresnel);
vec3 gradientColor = clamp(diffuseColor.rgb, 0.0, 1.0);
vec3 branchTint = mix(vec3(1.0), gradientColor, 0.58);
vec3 metallicBase = vec3(0.92, 0.94, 0.98) * mix(vec3(1.0), branchTint, 0.26);
vec3 oxideTinted = mix(oxideColor, oxideColor * branchTint, 0.62);
vec3 blendTint = mix(metallicBase, oxideTinted, saturate01(filmAmount * 0.78));
vec3 overlayTint = mix(vec3(1.0), blendTint, 0.62 * iriStrength);
vec3 iridescentOverGradient = gradientColor * overlayTint;
iridescentOverGradient += oxideColor * fresnel * iriStrength * 0.22;
diffuseColor.rgb = mix(gradientColor, iridescentOverGradient, 0.85 * iriStrength);
`,
      );
  };

  const updateUniforms = (): void => {
    uniforms.uIriStrength.value = params.iridescenceStrength;
    uniforms.uHueBandFreq.value = params.hueBandFrequency;
    uniforms.uHuePhaseSpeed.value = params.huePhaseSpeed;
    applyReflectiveness(material, params.reflectiveness);
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
      params.reflectiveness = MathUtils.clamp(partial.reflectiveness ?? params.reflectiveness, 0, 1);
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
