import * as THREE from "three";
import type { PlaceStyle } from "./placeStyles";
import { shared } from "./quality";
import { rng } from "./textures";

const driftColors: Record<PlaceStyle["drift"], string[]> = {
  petals: ["#f7d7de", "#f3c4cf", "#fbe9ec"],
  maple: ["#d6532d", "#e47b35", "#c23b2a", "#e9a23f"],
  ginkgo: ["#e8c13d", "#f0d35a", "#d9a92c"],
  seeds: ["#f4f1e6", "#e9e4d4"],
};

/** Drifting petals or leaves by day and fireflies by night, around the traveller. */
export class Ambient {
  readonly group = new THREE.Group();
  private drift: THREE.InstancedMesh;
  private state: {
    p: THREE.Vector3;
    v: THREE.Vector3;
    axis: THREE.Vector3;
    spin: number;
    speed: number;
  }[] = [];
  private flies: THREE.Points;
  private skyLanterns: THREE.Mesh;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  constructor(style: PlaceStyle, count = 180) {
    const random = rng(31);
    const size =
      style.drift === "seeds" ? 0.03 : style.drift === "petals" ? 0.04 : 0.055;
    const geometry = new THREE.PlaneGeometry(size, size * 0.75);
    const material = new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: 0.7,
      emissive: "#ffffff",
      emissiveIntensity: 0.08,
    });
    this.drift = new THREE.InstancedMesh(geometry, material, count);
    this.drift.frustumCulled = false;
    const palette = driftColors[style.drift];
    for (let i = 0; i < count; i++) {
      this.state.push({
        p: new THREE.Vector3(
          (random() - 0.5) * 50,
          random() * 16,
          (random() - 0.5) * 50,
        ),
        v: new THREE.Vector3(),
        axis: new THREE.Vector3(
          random() - 0.5,
          random() - 0.5,
          random() - 0.5,
        ).normalize(),
        spin: random() * 6,
        speed: 0.35 + random() * 0.6,
      });
      this.drift.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    }
    this.group.add(this.drift);
    const positions = new Float32Array(140 * 3),
      seeds = new Float32Array(140);
    for (let i = 0; i < 140; i++) {
      positions.set(
        [(random() - 0.5) * 60, 0.3 + random() * 2.6, (random() - 0.5) * 60],
        i * 3,
      );
      seeds[i] = random() * 100;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    fg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.flies = new THREE.Points(
      fg,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: shared.time,
          uNight: shared.night,
          uPlayer: shared.player,
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime, uNight;
          uniform vec3 uPlayer;
          varying float vGlow;
          void main() {
            vec3 p = position;
            p.xz = mod(p.xz - uPlayer.xz + 30.0, 60.0) - 30.0 + uPlayer.xz;
            p.y += uPlayer.y + sin(uTime * 0.7 + aSeed) * 0.5;
            p.x += sin(uTime * 0.4 + aSeed * 2.0) * 1.2;
            p.z += cos(uTime * 0.33 + aSeed) * 1.2;
            vGlow = uNight * pow(max(sin(uTime * 1.3 + aSeed * 7.0), 0.0), 3.0);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = 70.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vGlow;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vGlow;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * 9.0 * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.flies.frustumCulled = false;
    this.group.add(this.flies);
    // 풍등: sky lanterns rising slowly over the valley at night.
    const skyCount = 110,
      sky = new Float32Array(skyCount * 4);
    for (let i = 0; i < skyCount; i++)
      sky.set(
        [(random() - 0.5) * 300, random(), (random() - 0.5) * 300, random()],
        i * 4,
      );
    const body = new THREE.CylinderGeometry(0.42, 0.3, 0.9, 10, 1, true);
    body.translate(0, 0.45, 0);
    const lanternGeo = new THREE.InstancedBufferGeometry();
    lanternGeo.index = body.index;
    lanternGeo.attributes = body.attributes;
    lanternGeo.setAttribute("aSky", new THREE.InstancedBufferAttribute(sky, 4));
    lanternGeo.instanceCount = skyCount;
    this.skyLanterns = new THREE.Mesh(
      lanternGeo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.time, uPlayer: shared.player },
        vertexShader: /* glsl */ `
          attribute vec4 aSky;
          uniform float uTime;
          uniform vec3 uPlayer;
          varying float vGlow;
          varying float vH;
          void main() {
            float life = fract(aSky.y + uTime * 0.006 * (0.7 + aSky.w * 0.6));
            vec3 p = position * (2.2 + aSky.w * 1.4);
            p.x += aSky.x + sin(uTime * 0.2 + aSky.w * 20.0) * 6.0;
            p.z += aSky.z + cos(uTime * 0.17 + aSky.w * 13.0) * 6.0;
            p.y += 8.0 + life * 190.0;
            p.xz += uPlayer.xz;
            p.y += uPlayer.y;
            vGlow = smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.75, life) * (0.8 + 0.2 * sin(uTime * 3.0 + aSky.w * 50.0));
            vH = position.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying float vGlow;
          varying float vH;
          void main() {
            vec3 warm = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.82, 0.45), vH / 0.9);
            gl_FragColor = vec4(warm * (2.0 + 4.0 * vGlow), vGlow);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.skyLanterns.frustumCulled = false;
    this.group.add(this.skyLanterns);
  }
  update(dt: number, time: number, player: THREE.Vector3, reduced: boolean) {
    const night = shared.night.value;
    this.drift.visible = night < 0.5 && !reduced;
    this.flies.visible = night > 0.5 && !reduced;
    this.skyLanterns.visible = night > 0.5;
    if (!this.drift.visible) return;
    const wind = shared.wind.value;
    this.state.forEach((s, i) => {
      s.p.x += (wind.x * 0.9 + Math.sin(time * 0.8 + i) * 0.35) * dt;
      s.p.z += (wind.y * 0.9 + Math.cos(time * 0.6 + i * 1.3) * 0.35) * dt;
      s.p.y -= s.speed * dt;
      if (s.p.y < -2) s.p.y += 18;
      // Wrap around the traveller so the drift never thins out.
      s.p.x = ((((s.p.x - player.x + 25) % 50) + 50) % 50) - 25 + player.x;
      s.p.z = ((((s.p.z - player.z + 25) % 50) + 50) % 50) - 25 + player.z;
      s.spin += dt * (1.5 + s.speed * 2);
      this.quat.setFromAxisAngle(s.axis, s.spin);
      this.matrix.compose(
        new THREE.Vector3(s.p.x, player.y + s.p.y, s.p.z),
        this.quat,
        new THREE.Vector3(1, 1, 1),
      );
      this.drift.setMatrixAt(i, this.matrix);
    });
    this.drift.instanceMatrix.needsUpdate = true;
  }
}
