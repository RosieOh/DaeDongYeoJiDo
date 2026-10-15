import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  GTAOShader,
  generateMagicSquareNoise,
} from "three/addons/shaders/GTAOShader.js";
import {
  PoissonDenoiseShader,
  generatePdSamplePointInitializer,
} from "three/addons/shaders/PoissonDenoiseShader.js";
import type { QualitySettings } from "./quality";
import type { AtmospherePreset } from "./sky";

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** AO, aerial perspective and valley mist, applied in linear HDR before bloom. */
const compositeFragment = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos, uSunDir, uSunColor, uHaze, uHazeSun, uMist;
uniform float uHazeDensity, uHazeFalloff, uHazeBase, uMistDensity, uMistHeight, uMistBase, uAO;
uniform vec3 uSunScreen;
uniform float uShafts;
varying vec2 vUv;
float opticalDepth(float y0, float dy, float dist, float density, float falloff, float base) {
  // Bounded below so views down into deep valleys never white out.
  float k = max(falloff * dy * dist, -2.2);
  float f = abs(k) > 1e-4 ? (1.0 - exp(-k)) / k : 1.0;
  return density * exp(-falloff * (y0 - base)) * dist * f;
}
void main() {
  vec3 rgb = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  view /= view.w;
  vec3 ray = (uViewInv * vec4(view.xyz, 1.0)).xyz - uCamPos;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  float mu = max(dot(dir, uSunDir), 0.0);
  if (depth < 1.0) {
    #ifdef USE_AO
      rgb *= mix(1.0, texture2D(tAO, vUv).r, uAO);
    #endif
    float haze = opticalDepth(uCamPos.y, dir.y, dist, uHazeDensity, uHazeFalloff, uHazeBase);
    float mist = opticalDepth(uCamPos.y, dir.y, dist, uMistDensity, 1.0 / uMistHeight, uMistBase);
    vec3 scatter = uHaze + uHazeSun * (pow(mu, 6.0) * 0.9 + pow(mu, 32.0) * 0.6);
    rgb = mix(rgb, scatter, 1.0 - exp(-haze));
    rgb = mix(rgb, uMist + uHazeSun * pow(mu, 4.0) * 0.35, 1.0 - exp(-mist));
  }
  #ifdef USE_SHAFTS
  if (uSunScreen.z > 0.0 && uShafts > 0.0) {
    vec2 delta = (uSunScreen.xy - vUv) / 28.0;
    vec2 p = vUv;
    float light = 0.0, decay = 1.0;
    for (int i = 0; i < 28; i++) {
      p += delta;
      if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) break;
      light += step(0.99999, texture2D(tDepth, p).x) * decay;
      decay *= 0.96;
    }
    float facing = pow(mu, 3.0);
    rgb += uSunColor * light / 28.0 * uShafts * facing * uSunScreen.z;
  }
  #endif
  gl_FragColor = vec4(rgb, 1.0);
}`;

/** Filmic tone map, painterly grade, vignette, optional FXAA, sRGB out. */
const finalFragment = /* glsl */ `
uniform sampler2D tHDR;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform vec2 uTexel;
uniform float uExposure, uSaturation, uContrast, uVignette, uTime, uSpeed;
uniform vec3 uShadowTint, uHighlightTint;
varying vec2 vUv;
const vec2 DISC[8] = vec2[8](
  vec2(1.0, 0.0), vec2(0.707, 0.707), vec2(0.0, 1.0), vec2(-0.707, 0.707),
  vec2(-1.0, 0.0), vec2(-0.707, -0.707), vec2(0.0, -1.0), vec2(0.707, -0.707));
/** Scene radiance with cinematic lens effects applied in HDR. */
vec3 hdrAt(vec2 uv) {
  vec3 c = texture2D(tHDR, uv).rgb;
  #ifdef USE_LENS
    // Distant scenery softens like a long lens (depth of field).
    float depth = texture2D(tDepth, uv).x;
    vec4 view = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    float dist = length(view.xyz / view.w);
    float coc = smoothstep(260.0, 1400.0, dist) * 2.6;
    if (coc > 0.2) {
      vec3 sum = c;
      for (int i = 0; i < 8; i++) {
        vec2 o = DISC[i] * coc * uTexel * (i % 2 == 0 ? 1.0 : 1.9);
        sum += texture2D(tHDR, uv + o).rgb;
      }
      c = sum / 9.0;
    }
    // Radial speed blur and colour fringing while flying.
    if (uSpeed > 0.01) {
      vec2 dir = uv - 0.5;
      float edge = smoothstep(0.08, 0.6, length(dir));
      vec3 acc = c;
      for (int i = 1; i <= 8; i++) {
        float t = float(i) / 8.0 * uSpeed * 0.07 * edge;
        acc += texture2D(tHDR, uv - dir * t).rgb;
      }
      c = acc / 9.0;
      float ca = uSpeed * edge * 0.006;
      c.r = mix(c.r, texture2D(tHDR, uv + dir * ca).r, 0.6);
      c.b = mix(c.b, texture2D(tHDR, uv - dir * ca).b, 0.6);
    }
  #endif
  return c;
}
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 inMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = outMat * RRTAndODTFit(inMat * color);
  return clamp(color, 0.0, 1.0);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 ldr(vec2 uv) {
  vec3 c = aces(hdrAt(uv));
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation);
  c += (uShadowTint - luma(uShadowTint)) * (1.0 - smoothstep(0.0, 0.55, l)) * 0.22;
  c += (uHighlightTint - luma(uHighlightTint)) * smoothstep(0.45, 1.0, l) * 0.18;
  c = toSRGB(clamp(c, 0.0, 1.0));
  return clamp((c - 0.5) * uContrast + 0.5, 0.0, 1.0);
}
void main() {
  #ifdef USE_FXAA
    vec3 nw = ldr(vUv + vec2(-1.0, -1.0) * uTexel), ne = ldr(vUv + vec2(1.0, -1.0) * uTexel);
    vec3 sw = ldr(vUv + vec2(-1.0, 1.0) * uTexel), se = ldr(vUv + vec2(1.0, 1.0) * uTexel);
    vec3 m = ldr(vUv);
    float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se), lM = luma(m);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 d = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    d = clamp(d / (min(abs(d.x), abs(d.y)) + reduce), -8.0, 8.0) * uTexel;
    vec3 a = 0.5 * (ldr(vUv - d / 6.0) + ldr(vUv + d / 6.0));
    vec3 b = a * 0.5 + 0.25 * (ldr(vUv - d * 0.5) + ldr(vUv + d * 0.5));
    float lb = luma(b);
    vec3 color = (lb < lMin || lb > lMax) ? a : b;
  #else
    vec3 color = ldr(vUv);
  #endif
  vec2 q = vUv - 0.5;
  color *= 1.0 - dot(q, q) * uVignette;
  #ifdef USE_LENS
  // Wind streaks racing past the screen edges at speed.
  if (uSpeed > 0.05) {
    float ang = atan(q.y, q.x);
    float lane = floor(ang * 70.0);
    float h = fract(sin(lane * 91.7 + floor(uTime * 14.0) * 13.1) * 43758.5453);
    float r = length(q);
    float streak = step(0.93, h) * smoothstep(0.28, 0.62, r) * (1.0 - smoothstep(0.62, 0.75, r));
    color += vec3(0.85, 0.95, 0.95) * streak * uSpeed * 0.35;
  }
  #endif
  // Blue-noise-ish dither removes banding in the haze gradients.
  float n = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(color + (n - 0.5) / 255.0, 1.0);
}`;

export type AtmosphereState = AtmospherePreset & {
  hazeBase: number;
  mistBase: number;
  shafts: number;
  /** 0–1: radial speed blur and streaks while flying fast. */
  speed?: number;
};

export class PostPipeline {
  private sceneTarget: THREE.WebGLRenderTarget;
  private hdrTarget: THREE.WebGLRenderTarget;
  private aoTarget: THREE.WebGLRenderTarget | null = null;
  private aoBlurTarget: THREE.WebGLRenderTarget | null = null;
  private aoMaterial: THREE.ShaderMaterial | null = null;
  private denoiseMaterial: THREE.ShaderMaterial | null = null;
  private composite: THREE.ShaderMaterial;
  private final: THREE.ShaderMaterial;
  private bloom: UnrealBloomPass | null = null;
  private quad = new FullScreenQuad();
  private size = new THREE.Vector2(1, 1);
  private sun = new THREE.Vector3();
  constructor(
    private renderer: THREE.WebGLRenderer,
    quality: QualitySettings,
  ) {
    const depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
      depthTexture,
    });
    this.hdrTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
    if (quality.ao) {
      const options = { type: THREE.HalfFloatType, depthBuffer: false };
      this.aoTarget = new THREE.WebGLRenderTarget(1, 1, options);
      this.aoBlurTarget = new THREE.WebGLRenderTarget(1, 1, options);
      this.aoMaterial = new THREE.ShaderMaterial({
        defines: {
          ...GTAOShader.defines,
          NORMAL_VECTOR_TYPE: 0,
          SAMPLES: 16,
          PERSPECTIVE_CAMERA: 1,
        },
        uniforms: THREE.UniformsUtils.clone(GTAOShader.uniforms),
        vertexShader: GTAOShader.vertexShader,
        fragmentShader: GTAOShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      const u = this.aoMaterial.uniforms;
      u.tDepth.value = depthTexture;
      u.tNoise.value = generateMagicSquareNoise();
      u.radius.value = 1.7;
      u.thickness.value = 1.4;
      u.distanceExponent.value = 1.6;
      u.distanceFallOff.value = 1;
      u.scale.value = 1.15;
      this.denoiseMaterial = new THREE.ShaderMaterial({
        defines: {
          ...PoissonDenoiseShader.defines,
          NORMAL_VECTOR_TYPE: 0,
          SAMPLES: 16,
          SAMPLE_VECTORS: generatePdSamplePointInitializer(16, 2, 1),
        },
        uniforms: THREE.UniformsUtils.clone(PoissonDenoiseShader.uniforms),
        vertexShader: PoissonDenoiseShader.vertexShader,
        fragmentShader: PoissonDenoiseShader.fragmentShader,
        depthTest: false,
        depthWrite: false,
      });
      const d = this.denoiseMaterial.uniforms;
      d.tDiffuse.value = this.aoTarget.texture;
      d.tDepth.value = depthTexture;
      d.tNoise.value = u.tNoise.value;
      d.lumaPhi.value = 10;
      d.depthPhi.value = 2;
      d.normalPhi.value = 3;
      d.radius.value = 7;
    }
    this.composite = new THREE.ShaderMaterial({
      defines: {
        ...(quality.ao ? { USE_AO: "" } : {}),
        ...(quality.level === "high" ? { USE_SHAFTS: "" } : {}),
      },
      uniforms: {
        tColor: { value: this.sceneTarget.texture },
        tDepth: { value: depthTexture },
        tAO: { value: this.aoBlurTarget?.texture ?? null },
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uHazeSun: { value: new THREE.Color() },
        uMist: { value: new THREE.Color() },
        uHazeDensity: { value: 0 },
        uHazeFalloff: { value: 0 },
        uHazeBase: { value: 0 },
        uMistDensity: { value: 0 },
        uMistHeight: { value: 20 },
        uMistBase: { value: 0 },
        uAO: { value: 0.85 },
        uSunScreen: { value: new THREE.Vector3() },
        uShafts: { value: 0 },
      },
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.final = new THREE.ShaderMaterial({
      defines: {
        ...(quality.msaa ? {} : { USE_FXAA: "" }),
        ...(quality.level === "high" ? { USE_LENS: "" } : {}),
      },
      uniforms: {
        tHDR: { value: this.hdrTarget.texture },
        tDepth: { value: depthTexture },
        uProjInv: { value: new THREE.Matrix4() },
        uSpeed: { value: 0 },
        uTexel: { value: new THREE.Vector2() },
        uExposure: { value: 1 },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uVignette: { value: 0.55 },
        uTime: { value: 0 },
        uShadowTint: { value: new THREE.Color() },
        uHighlightTint: { value: new THREE.Color() },
      },
      vertexShader: quadVertex,
      fragmentShader: finalFragment,
      depthTest: false,
      depthWrite: false,
    });
    if (quality.bloom)
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.7, 1.02);
  }
  setSize(width: number, height: number) {
    this.size.set(Math.max(1, width), Math.max(1, height));
    const { x, y } = this.size;
    this.sceneTarget.setSize(x, y);
    this.sceneTarget.depthTexture!.image.width = x;
    this.sceneTarget.depthTexture!.image.height = y;
    this.hdrTarget.setSize(x, y);
    const hx = Math.ceil(x / 2),
      hy = Math.ceil(y / 2);
    this.aoTarget?.setSize(hx, hy);
    this.aoBlurTarget?.setSize(hx, hy);
    this.aoMaterial?.uniforms.resolution.value.set(hx, hy);
    this.denoiseMaterial?.uniforms.resolution.value.set(hx, hy);
    this.bloom?.setSize(x, y);
    this.final.uniforms.uTexel.value.set(1 / x, 1 / y);
  }
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    a: AtmosphereState,
    time: number,
  ) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneTarget);
    r.clear();
    r.render(scene, camera);
    if (this.aoMaterial && this.denoiseMaterial && this.aoTarget) {
      const u = this.aoMaterial.uniforms;
      u.cameraNear.value = camera.near;
      u.cameraFar.value = camera.far;
      u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
      u.cameraProjectionMatrixInverse.value.copy(
        camera.projectionMatrixInverse,
      );
      u.cameraWorldMatrix.value.copy(camera.matrixWorld);
      this.denoiseMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(
        camera.projectionMatrixInverse,
      );
      this.pass(this.aoMaterial, this.aoTarget, true);
      this.pass(this.denoiseMaterial, this.aoBlurTarget, false);
    }
    const u = this.composite.uniforms;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uViewInv.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uSunDir.value.copy(a.sunDir);
    u.uSunColor.value.copy(a.sunColor).multiplyScalar(a.night ? 0.2 : 1);
    u.uHaze.value.copy(a.haze);
    u.uHazeSun.value.copy(a.hazeSun);
    u.uMist.value.copy(a.mist);
    u.uHazeDensity.value = a.hazeDensity;
    u.uHazeFalloff.value = a.hazeFalloff;
    u.uHazeBase.value = a.hazeBase;
    u.uMistDensity.value = a.mistDensity;
    u.uMistHeight.value = a.mistHeight;
    u.uMistBase.value = a.mistBase;
    u.uShafts.value = a.shafts;
    // Project the sun to screen space for light shafts.
    this.sun
      .copy(a.sunDir)
      .multiplyScalar(500)
      .add(u.uCamPos.value)
      .project(camera);
    const inFront = this.sun.z < 1 && a.sunDir.y > -0.02 ? 1 : 0;
    const onScreen = Math.max(
      0,
      1 - Math.max(Math.abs(this.sun.x), Math.abs(this.sun.y)) / 1.6,
    );
    u.uSunScreen.value.set(
      this.sun.x * 0.5 + 0.5,
      this.sun.y * 0.5 + 0.5,
      inFront * onScreen,
    );
    this.pass(this.composite, this.hdrTarget, false);
    if (this.bloom) {
      this.bloom.strength = a.bloom;
      this.bloom.render(r, this.hdrTarget, this.hdrTarget, 0, false);
    }
    const f = this.final.uniforms;
    f.uExposure.value = a.exposure;
    f.uSaturation.value = a.saturation;
    f.uContrast.value = a.contrast;
    f.uShadowTint.value.copy(a.shadowTint);
    f.uHighlightTint.value.copy(a.highlightTint);
    f.uTime.value = time % 100;
    f.uProjInv.value.copy(camera.projectionMatrixInverse);
    f.uSpeed.value = a.speed ?? 0;
    this.pass(this.final, null, false);
  }
  private pass(
    material: THREE.Material,
    target: THREE.WebGLRenderTarget | null,
    clearWhite: boolean,
  ) {
    const r = this.renderer;
    r.setRenderTarget(target);
    if (clearWhite) {
      r.setClearColor(0xffffff, 1);
      r.clear(true, false, false);
    }
    this.quad.material = material;
    this.quad.render(r);
  }
  dispose() {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.hdrTarget.dispose();
    this.aoTarget?.dispose();
    this.aoBlurTarget?.dispose();
    this.aoMaterial?.uniforms.tNoise.value?.dispose();
    this.aoMaterial?.dispose();
    this.denoiseMaterial?.dispose();
    this.composite.dispose();
    this.final.dispose();
    this.bloom?.dispose();
    this.quad.dispose();
  }
}
