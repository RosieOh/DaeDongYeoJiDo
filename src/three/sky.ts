import * as THREE from "three";
import { shared } from "./quality";

export type TimeOfDay = "day" | "sunset" | "night";
export type AtmospherePreset = {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  glow: number;
  cloudCover: number;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  haze: THREE.Color;
  hazeSun: THREE.Color;
  hazeDensity: number;
  hazeFalloff: number;
  mist: THREE.Color;
  mistDensity: number;
  mistHeight: number;
  exposure: number;
  envIntensity: number;
  night: number;
  saturation: number;
  contrast: number;
  shadowTint: THREE.Color;
  highlightTint: THREE.Color;
  bloom: number;
};
const c = (hex: string) => new THREE.Color(hex);
const dir = (x: number, y: number, z: number) =>
  new THREE.Vector3(x, y, z).normalize();

/**
 * Art-directed looks inspired by wuxia landscape painting: layered haze, soft
 * jade greens, warm highlights. Colours are authored in sRGB, lit in linear.
 */
export const presets: Record<TimeOfDay, AtmospherePreset> = {
  day: {
    sunDir: dir(-0.5, 0.62, 0.6),
    sunColor: c("#fff1dc"),
    sunIntensity: 3.1,
    zenith: c("#4f88c4"),
    horizon: c("#d0e1e7"),
    ground: c("#aab8b0"),
    glow: 0.55,
    cloudCover: 0.46,
    cloudLit: c("#ffffff"),
    cloudShade: c("#a9b8c6"),
    haze: c("#b9cdd2"),
    hazeSun: c("#f4e7cf"),
    hazeDensity: 0.00042,
    hazeFalloff: 0.0021,
    mist: c("#dde7e4"),
    mistDensity: 0.0017,
    mistHeight: 22,
    exposure: 1.0,
    envIntensity: 1.0,
    night: 0,
    saturation: 1.14,
    contrast: 1.07,
    shadowTint: c("#2f4d5a"),
    highlightTint: c("#fff3df"),
    bloom: 0.36,
  },
  sunset: {
    sunDir: dir(-0.94, 0.085, 0.33),
    sunColor: c("#ffa25c"),
    sunIntensity: 2.6,
    zenith: c("#4d5f8f"),
    horizon: c("#f6b77f"),
    ground: c("#8f7f7a"),
    glow: 1.5,
    cloudCover: 0.52,
    cloudLit: c("#ffc59a"),
    cloudShade: c("#7d6a86"),
    haze: c("#c69a8c"),
    hazeSun: c("#ffb373"),
    hazeDensity: 0.00058,
    hazeFalloff: 0.0019,
    mist: c("#e2b9a0"),
    mistDensity: 0.0034,
    mistHeight: 26,
    exposure: 1.05,
    envIntensity: 0.9,
    night: 0,
    saturation: 1.16,
    contrast: 1.08,
    shadowTint: c("#3d2f55"),
    highlightTint: c("#ffd8b0"),
    bloom: 0.5,
  },
  night: {
    sunDir: dir(0.48, 0.5, 0.72),
    sunColor: c("#a9c1ff"),
    sunIntensity: 1.15,
    zenith: c("#0c1a38"),
    horizon: c("#2b4470"),
    ground: c("#18222f"),
    glow: 0.5,
    cloudCover: 0.34,
    cloudLit: c("#7e8fb3"),
    cloudShade: c("#1c2740"),
    haze: c("#22345a"),
    hazeSun: c("#5a6f9e"),
    hazeDensity: 0.00052,
    hazeFalloff: 0.0021,
    mist: c("#304566"),
    mistDensity: 0.0032,
    mistHeight: 24,
    exposure: 1.55,
    envIntensity: 1.1,
    night: 1,
    saturation: 0.92,
    contrast: 1.05,
    shadowTint: c("#0f1a35"),
    highlightTint: c("#ffd9a6"),
    bloom: 0.55,
  },
};

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const skyFragment = /* glsl */ `
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon, uGround, uCloudLit, uCloudShade;
uniform float uGlow, uCloudCover, uTime, uNight;
varying vec3 vDir;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float mu = dot(d, uSunDir);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.48));
  // Warm the horizon toward the sun's azimuth, as in Rayleigh/Mie twilight.
  float az = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-4)), 0.0);
  col += uSunColor * pow(az, 6.0) * exp(-max(h, 0.0) * 7.0) * 0.35 * uGlow;
  col = mix(col, uGround, smoothstep(0.0, -0.18, h));
  col += uSunColor * (pow(max(mu, 0.0), 8.0) * 0.28 + pow(max(mu, 0.0), 90.0) * 0.9) * uGlow;
  // Painted cloud bands projected on a dome.
  if (h > -0.05) {
    vec2 p = d.xz / (h + 0.22) * 1.25 + uTime * vec2(0.0035, 0.0012);
    float n = fbm(p * 1.3) * 0.75 + fbm(p * 4.1 + 3.0) * 0.25;
    float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n);
    float lit = clamp(0.55 + 0.45 * mu + (n - 0.5), 0.0, 1.0);
    vec3 cloud = mix(uCloudShade, uCloudLit, lit) * (1.0 + pow(max(mu, 0.0), 12.0) * 1.2 * uGlow);
    float fade = smoothstep(-0.03, 0.18, h) * (1.0 - smoothstep(0.75, 1.0, h) * 0.4);
    col = mix(col, cloud, cover * fade * 0.86);
  }
  // Sun disc by day, a large bright moon and stars at night.
  float disc = smoothstep(0.99955, 0.9998, mu);
  col += uSunColor * disc * mix(40.0, 0.0, uNight);
  if (uNight > 0.0) {
    float moon = smoothstep(0.99915, 0.99935, mu);
    float crater = fbm((d.xy - uSunDir.xy) * 900.0);
    col += vec3(1.0, 0.97, 0.9) * moon * (5.0 - crater * 2.0) * uNight;
    col += vec3(0.55, 0.65, 0.9) * pow(max(mu, 0.0), 300.0) * 1.2 * uNight;
    vec2 sp = d.xz / (abs(h) + 0.6) * 260.0;
    float star = step(0.9965, hash(floor(sp))) * smoothstep(0.05, 0.4, h);
    col += vec3(0.9, 0.93, 1.0) * star * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp)) * 40.0)) * uNight;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: shared.sunDir,
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uCloudLit: { value: new THREE.Color() },
      uCloudShade: { value: new THREE.Color() },
      uGlow: { value: 1 },
      uCloudCover: { value: 0.4 },
      uTime: shared.time,
      uNight: shared.night,
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function applySkyPreset(
  material: THREE.ShaderMaterial,
  p: AtmospherePreset,
) {
  const u = material.uniforms;
  u.uSunColor.value.copy(p.sunColor);
  u.uZenith.value.copy(p.zenith);
  u.uHorizon.value.copy(p.horizon);
  u.uGround.value.copy(p.ground);
  u.uCloudLit.value.copy(p.cloudLit);
  u.uCloudShade.value.copy(p.cloudShade);
  u.uGlow.value = p.glow;
  u.uCloudCover.value = p.cloudCover;
}

/** A camera-centred dome drawn behind everything (depth stays at the far plane). */
export function createSkyDome(material: THREE.ShaderMaterial) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  dome.name = "sky";
  return dome;
}

/** Image-based lighting from the same sky, so shading matches the backdrop. */
export function bakeEnvironment(
  renderer: THREE.WebGLRenderer,
  material: THREE.ShaderMaterial,
  previous?: THREE.WebGLRenderTarget,
) {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), material);
  scene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02, 0.1, 200);
  pmrem.dispose();
  dome.geometry.dispose();
  previous?.dispose();
  return target;
}
