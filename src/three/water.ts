import * as THREE from "three";
import { shared } from "./quality";
import { normalTexture, rng } from "./textures";

let waves: THREE.Texture | null = null;
/** Tileable wave normals built from integer-frequency sine waves. */
function waveNormals() {
  if (waves) return waves;
  const random = rng(91),
    list = Array.from({ length: 28 }, () => ({
      fx: Math.round((random() - 0.5) * 14),
      fy: Math.round((random() - 0.5) * 14),
      phase: random() * Math.PI * 2,
      amp: 0.4 + random(),
    }));
  waves = normalTexture(
    256,
    256,
    (x, y) =>
      list.reduce(
        (h, w) =>
          h +
          (Math.sin(((w.fx * x + w.fy * y) / 256) * Math.PI * 2 + w.phase) *
            w.amp) /
            Math.max(1, Math.hypot(w.fx, w.fy)),
        0,
      ),
    3.2,
  );
  return waves;
}

/** Mirrors the scene about the nearest water surface (high quality only). */
export class PlanarReflection {
  readonly target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
  });
  readonly camera = new THREE.PerspectiveCamera();
  readonly uniforms = {
    tReflect: { value: this.target.texture },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectOn: { value: 0 },
  };
  level = 0;
  enabled = false;
  private fog = new THREE.FogExp2("#b9cdd2", 0.0005);
  private plane = new THREE.Plane();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  private rotation = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private target3 = new THREE.Vector3();
  private look = new THREE.Vector3();
  private normal = new THREE.Vector3(0, 1, 0);
  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
  }
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    hidden: THREE.Object3D[],
    haze: THREE.Color,
  ) {
    const u = this.uniforms;
    u.uReflectOn.value = 0;
    if (!this.enabled) return;
    const origin = this.v.set(camera.position.x, this.level, camera.position.z);
    const eye = camera.position.clone();
    if (eye.y <= this.level + 0.05) return;
    // Mirror the eye, look target and up vector about the water plane.
    const view = origin
      .clone()
      .sub(eye)
      .reflect(this.normal)
      .negate()
      .add(origin);
    this.rotation.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rotation).add(eye);
    this.target3
      .copy(origin)
      .sub(this.look)
      .reflect(this.normal)
      .negate()
      .add(origin);
    const c = this.camera;
    c.position.copy(view);
    c.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(this.normal);
    c.lookAt(this.target3);
    c.near = camera.near;
    c.far = camera.far;
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    u.uReflectMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(c.projectionMatrix)
      .multiply(c.matrixWorldInverse);
    // Oblique near plane so nothing below the water leaks into the mirror.
    this.plane
      .setFromNormalAndCoplanarPoint(this.normal, origin)
      .applyMatrix4(c.matrixWorldInverse);
    this.clip.set(
      this.plane.normal.x,
      this.plane.normal.y,
      this.plane.normal.z,
      this.plane.constant,
    );
    const p = c.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clip.x) + p[8]) / p[0],
      (Math.sign(this.clip.y) + p[9]) / p[5],
      -1,
      (1 + p[10]) / p[14],
    );
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1;
    p[14] = this.clip.w;
    const visible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const fog = scene.fog;
    this.fog.color.copy(haze);
    scene.fog = this.fog;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, c);
    scene.fog = fog;
    hidden.forEach((o, i) => (o.visible = visible[i]));
    u.uReflectOn.value = 1;
  }
  dispose() {
    this.target.dispose();
  }
}

export function createWaterMaterial(
  color = "#2c5a62",
  reflection?: PlanarReflection,
  calm = false,
) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.07,
    metalness: 0,
    envMapIntensity: 1.25,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaves = { value: waveNormals() };
    shader.uniforms.uTime = shared.time;
    if (reflection) Object.assign(shader.uniforms, reflection.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vWaterPos;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uWaves;
uniform float uTime;
varying vec3 vWaterPos;
${reflection ? "#define USE_PLANAR\nuniform sampler2D tReflect;\nuniform mat4 uReflectMatrix;\nuniform float uReflectOn;" : ""}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec2 wpos = vWaterPos.xz;
vec3 n1 = texture2D(uWaves, wpos / 23.0 + vec2(0.011, 0.006) * uTime).xyz * 2.0 - 1.0;
vec3 n2 = texture2D(uWaves, wpos / 9.0 + vec2(-0.017, 0.012) * uTime).xyz * 2.0 - 1.0;
vec3 n3 = texture2D(uWaves, wpos / 61.0 + vec2(0.004, -0.009) * uTime).xyz * 2.0 - 1.0;
vec3 wn = n1 + n2 * 0.6 + n3 * 0.8;
float fade = clamp(length(vWaterPos - cameraPosition) / 900.0, 0.0, 1.0);
vec3 waterN = normalize(vec3(wn.x, ${calm ? "15.0" : "7.0"} + fade * 30.0, -wn.y));
normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
#ifdef USE_PLANAR
if (uReflectOn > 0.5) {
  vec4 rp = uReflectMatrix * vec4(vWaterPos, 1.0);
  vec2 ruv = rp.xy / rp.w + waterN.xz * 0.035;
  vec3 mirror = texture2D(tReflect, ruv).rgb;
  float facing = max(dot(normalize(cameraPosition - vWaterPos), waterN), 0.0);
  float fres = 0.05 + 0.95 * pow(1.0 - facing, 4.0);
  totalEmissiveRadiance += mirror * fres * 0.72;
}
#endif`,
      );
  };
  material.customProgramCacheKey = () => `water-${!!reflection}-${calm}`;
  return material;
}

export function buildOcean(
  level: number,
  size: number,
  material: THREE.Material,
) {
  const geometry = new THREE.PlaneGeometry(size * 2, size * 2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const ocean = new THREE.Mesh(geometry, material);
  ocean.position.y = level;
  ocean.receiveShadow = true;
  ocean.name = "ocean";
  return ocean;
}
