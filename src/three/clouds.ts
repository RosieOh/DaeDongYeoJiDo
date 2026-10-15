import * as THREE from "three";
import type { HeightField } from "./terrain";
import { noiseGLSL } from "./terrain";
import { shared } from "./quality";

/**
 * 운해: a sea of clouds filling the valleys below a high viewpoint. The layer
 * thins out where ridges approach it, so peaks rise through it like islands.
 */
export function cloudSea(field: HeightField) {
  const far = field.data.far;
  if (!far) return null;
  const land = far.heights.filter((h) => h > 0).sort((a, b) => a - b);
  if (land.length < 100) return null;
  const low = land[Math.floor(land.length * 0.3)];
  // Only when the traveller stands well above the surrounding valleys.
  if (field.base - low < 260) return null;
  const level = low + (field.base - low) * 0.42 - field.base;
  const step = (far.extent * 2) / (far.size - 1);
  // Clearance follows the same art-directed relief as the rendered ridges.
  const heights = new Float32Array(
    far.heights.map((h, k) =>
      field.exaggerate(
        h - field.base,
        Math.max(
          Math.abs(-far.extent + (k % far.size) * step),
          Math.abs(-far.extent + Math.floor(k / far.size) * step),
        ),
      ),
    ),
  );
  const texture = new THREE.DataTexture(
    heights,
    far.size,
    far.size,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uSunDir: shared.sunDir,
      uSunColor: shared.sunColor,
      uNight: shared.night,
      uFar: { value: texture },
      uGrid: { value: new THREE.Vector3(far.size, far.extent, level) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight;
      uniform vec3 uSunDir, uSunColor, uGrid;
      uniform highp sampler2D uFar;
      varying vec3 vPos;
      ${noiseGLSL}
      float ground(vec2 p) {
        float n = uGrid.x;
        vec2 g = clamp((p + uGrid.y) / (2.0 * uGrid.y) * (n - 1.0), vec2(0.0), vec2(n - 1.001));
        ivec2 i = ivec2(floor(g));
        vec2 f = g - vec2(i);
        float a = texelFetch(uFar, i, 0).r, b = texelFetch(uFar, i + ivec2(1, 0), 0).r;
        float c = texelFetch(uFar, i + ivec2(0, 1), 0).r, d = texelFetch(uFar, i + ivec2(1, 1), 0).r;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec2 p = vPos.xz * 0.0016 + uTime * vec2(0.004, 0.0015);
        vec2 warp = vec2(vfbm(p * 1.7 + 3.1), vfbm(p * 1.7 - 2.3)) - 0.5;
        float n = vfbm(p + warp * 0.9) * 0.7 + vfbm(p * 3.3 + warp) * 0.3;
        float clearance = smoothstep(0.0, 70.0, uGrid.z - ground(vPos.xz));
        float edge = 1.0 - smoothstep(uGrid.y * 0.55, uGrid.y * 0.95, length(vPos.xz));
        float horizon = 1.0 - smoothstep(3500.0, 9000.0, distance(vPos, cameraPosition));
        float density = smoothstep(0.32, 0.72, n) * clearance * edge * horizon;
        if (density < 0.01) discard;
        vec3 view = normalize(vPos - cameraPosition);
        float silver = pow(max(dot(view, uSunDir), 0.0), 6.0);
        vec3 shade = mix(vec3(0.72, 0.78, 0.86), vec3(0.16, 0.2, 0.3), uNight);
        vec3 lit = mix(vec3(1.0, 0.98, 0.95), vec3(0.45, 0.5, 0.62), uNight);
        vec3 color = mix(shade, lit * (0.6 + uSunColor * 0.5), smoothstep(0.4, 0.85, n)) + uSunColor * silver * 0.5;
        gl_FragColor = vec4(color * 1.15, density * 0.93);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(
    far.extent * 2,
    far.extent * 2,
    1,
    1,
  );
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = level;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.name = "cloud-sea";
  return mesh;
}
