import * as THREE from "three";
import type { MoveMode } from "./motion";
import { canvasTexture } from "./textures";

type Ring = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  from: number;
  to: number;
  opacity: number;
};

let haloTexture: THREE.Texture | null = null;
const halo = () =>
  (haloTexture ??= canvasTexture(128, 128, (c, w) => {
    const g = c.createRadialGradient(
      w / 2,
      w / 2,
      w * 0.18,
      w / 2,
      w / 2,
      w / 2,
    );
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.62, "rgba(255,255,255,0.9)");
    g.addColorStop(0.78, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
  }));

const QI = new THREE.Color("#a8f0e0");
const DUST = new THREE.Color("#b7a68a");
const SPRAY = new THREE.Color("#e9f4f6");

/** Pooled point particles with velocity, drag, gravity and fade. */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private baseSize: Float32Array;
  private next = 0;
  constructor(private count: number) {
    this.pos = new Float32Array(count * 3).fill(-1e5);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.grav = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aAlpha;
          attribute vec3 color;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vColor = color;
            vAlpha = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * 300.0 / -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.1, d) * vAlpha;
            if (a < 0.01) discard;
            gl_FragColor = vec4(vColor, a);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(
    at: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    size: number,
    life: number,
    gravity = 0,
  ) {
    const i = this.next++ % this.count;
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([vel.x, vel.y, vel.z], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = gravity;
  }
  update(dt: number) {
    const drag = Math.exp(-dt * 1.8);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, t * 2.5) * 0.9;
      this.size[i] = this.baseSize[i] * (1.3 - t * 0.3);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

/** A fading ribbon that follows one point (a hand, a foot). */
class Trail {
  readonly mesh: THREE.Mesh;
  private history: { p: THREE.Vector3; age: number }[] = [];
  private side = new THREE.Vector3();
  private view = new THREE.Vector3();
  constructor(
    private length: number,
    private width: number,
    private color: THREE.Color,
  ) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(length * 2 * 3), 3),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(length * 2 * 3), 3),
    );
    const index: number[] = [];
    for (let i = 0; i < length - 1; i++)
      index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(index);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }
  update(
    dt: number,
    at: THREE.Vector3 | null,
    life: number,
    camera: THREE.Vector3,
  ) {
    for (const h of this.history) h.age += dt;
    if (at) this.history.unshift({ p: at.clone(), age: 0 });
    while (
      this.history.length > this.length ||
      (this.history.length && this.history[this.history.length - 1].age > life)
    )
      this.history.pop();
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute,
      col = this.mesh.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < this.length; i++) {
      const n = this.history.length;
      const h = this.history[i];
      if (!h || n < 2) {
        pos.setXYZ(i * 2, 0, -1e5, 0);
        pos.setXYZ(i * 2 + 1, 0, -1e5, 0);
        continue;
      }
      // Face the ribbon toward the camera so it never collapses to a line.
      const a = this.history[Math.max(0, i - 1)].p,
        b = this.history[Math.min(n - 1, i + 1)].p;
      this.view.subVectors(camera, h.p).normalize();
      this.side.subVectors(b, a).cross(this.view).normalize();
      const fade = Math.max(0, 1 - h.age / life) * (1 - i / this.length),
        w = this.width * fade * Math.min(1, i / 2);
      const s = this.side;
      pos.setXYZ(i * 2, h.p.x + s.x * w, h.p.y + s.y * w, h.p.z + s.z * w);
      pos.setXYZ(i * 2 + 1, h.p.x - s.x * w, h.p.y - s.y * w, h.p.z - s.z * w);
      const c = 1.8 * fade;
      col.setXYZ(i * 2, this.color.r * c, this.color.g * c, this.color.b * c);
      col.setXYZ(
        i * 2 + 1,
        this.color.r * c,
        this.color.g * c,
        this.color.b * c,
      );
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

export type FxContext = {
  player: THREE.Vector3;
  anchors: {
    left: THREE.Vector3;
    right: THREE.Vector3;
    leftFoot: THREE.Vector3;
    rightFoot: THREE.Vector3;
  };
  mode: MoveMode;
  airborne: boolean;
  onWater: boolean;
  moving: boolean;
  speed: number;
  camera: THREE.Vector3;
};

/**
 * 경공 feedback: qi bursts and spiralling motes, light ribbons from both
 * sleeves and feet, dust and debris, water spray and ripples, shockwaves.
 */
export class Effects {
  readonly group = new THREE.Group();
  private rings: Ring[] = [];
  private particles: Particles;
  private trails: Trail[];
  private stepClock = 0;
  private stepFoot = 0;
  private v = new THREE.Vector3();
  private p = new THREE.Vector3();
  constructor(rich = true) {
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: halo(),
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.rings.push({ mesh, age: 1, life: 1, from: 0, to: 1, opacity: 0 });
    }
    this.particles = new Particles(rich ? 900 : 300);
    this.group.add(this.particles.points);
    this.trails = [
      new Trail(26, 0.07, new THREE.Color("#b6f5ea")),
      new Trail(26, 0.07, new THREE.Color("#b6f5ea")),
      new Trail(18, 0.05, new THREE.Color("#ffffff")),
      new Trail(18, 0.05, new THREE.Color("#ffffff")),
    ];
    for (const t of this.trails) this.group.add(t.mesh);
  }
  /** An expanding halo; flat on the ground, or facing `normal` (dash bursts). */
  ring(
    at: THREE.Vector3,
    color: THREE.ColorRepresentation,
    from: number,
    to: number,
    life: number,
    opacity: number,
    additive: boolean,
    normal = new THREE.Vector3(0, 1, 0),
  ) {
    const r = this.rings.reduce((a, b) =>
      b.age / b.life > a.age / a.life ? b : a,
    );
    r.mesh.position.copy(at);
    if (normal.y > 0.99) r.mesh.position.y += 0.06;
    r.mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal.clone().normalize(),
    );
    r.mesh.material.color.set(color);
    r.mesh.material.blending = additive
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
    r.mesh.material.needsUpdate = true;
    Object.assign(r, { age: 0, life, from, to, opacity });
    r.mesh.visible = true;
  }
  private burst(
    at: THREE.Vector3,
    n: number,
    color: THREE.Color,
    speed: number,
    up: number,
    size: number,
    life: number,
    gravity: number,
  ) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        s = speed * (0.4 + Math.random() * 0.6);
      this.v.set(Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s);
      this.p.set(
        at.x + Math.cos(a) * 0.3,
        at.y + 0.1,
        at.z + Math.sin(a) * 0.3,
      );
      this.particles.emit(
        this.p,
        this.v,
        color,
        size * (0.6 + Math.random() * 0.8),
        life * (0.6 + Math.random() * 0.6),
        gravity,
      );
    }
  }
  jump(at: THREE.Vector3, count: number) {
    const glow = QI.clone().multiplyScalar(count > 1 ? 1.8 : 1.2);
    this.ring(at, glow, 0.4, count > 1 ? 4.6 : 3, 0.55, 0.9, true);
    if (count > 1) this.ring(at, glow, 0.2, 2.4, 0.4, 0.7, true);
    this.burst(
      at,
      count > 1 ? 26 : 12,
      QI.clone().multiplyScalar(2),
      3.5,
      1.5,
      0.12,
      0.7,
      -0.5,
    );
  }
  dash(at: THREE.Vector3, dir: THREE.Vector3) {
    const center = at.clone().add(new THREE.Vector3(0, 1.1, 0));
    this.ring(
      center,
      QI.clone().multiplyScalar(2),
      0.3,
      3.4,
      0.35,
      0.9,
      true,
      dir,
    );
    this.ring(center, new THREE.Color("#ffffff"), 0.2, 2, 0.25, 0.8, true, dir);
    for (let i = 0; i < 30; i++) {
      this.v
        .copy(dir)
        .multiplyScalar(-4 - Math.random() * 6)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3,
          ),
        );
      this.particles.emit(
        center,
        this.v,
        QI.clone().multiplyScalar(2.2),
        0.09,
        0.5,
        0,
      );
    }
  }
  soar(at: THREE.Vector3) {
    this.ring(at, QI.clone().multiplyScalar(2.4), 0.5, 7, 0.8, 1, true);
    this.ring(at, new THREE.Color("#ffffff"), 0.3, 4, 0.5, 0.8, true);
    this.burst(at, 40, DUST, 6, 1.2, 0.35, 1.1, 2);
    this.burst(at, 30, QI.clone().multiplyScalar(2.2), 4, 4, 0.12, 1, -1);
  }
  land(at: THREE.Vector3, impact: number, water: boolean) {
    if (water) {
      this.ring(at, "#e8f4f6", 0.3, 3.2, 1.1, 0.6, true);
      this.burst(at, 30, SPRAY, 3, 4, 0.12, 0.8, 12);
    } else if (impact > 7) {
      this.ring(at, "#b7a68a", 0.4, 2.6 + impact * 0.08, 0.7, 0.55, false);
      this.burst(
        at,
        Math.min(40, impact * 1.5),
        DUST,
        3 + impact * 0.1,
        0.8,
        0.3,
        0.9,
        1.5,
      );
    }
  }
  /** 천근추 impact: a shockwave, a dust wall and flying debris. */
  shockwave(at: THREE.Vector3, height: number, water: boolean) {
    const power = Math.min(1, height / 25);
    this.ring(
      at,
      water ? "#e8f4f6" : "#d9c9a8",
      0.5,
      10 + power * 8,
      0.9,
      0.85,
      water,
    );
    this.ring(
      at,
      QI.clone().multiplyScalar(2.6),
      0.4,
      6 + power * 5,
      0.5,
      1,
      true,
    );
    this.ring(at, "#ffffff", 0.2, 3, 0.3, 0.9, true);
    this.burst(
      at,
      70,
      water ? SPRAY : DUST,
      10 + power * 8,
      0.6,
      0.55,
      1.3,
      2.5,
    );
    this.burst(
      at,
      30,
      water ? SPRAY : new THREE.Color("#7c6d58"),
      7,
      7,
      0.1,
      1.2,
      18,
    );
    this.burst(at, 24, QI.clone().multiplyScalar(2.6), 6, 3, 0.1, 0.8, 0);
  }
  /** Brief qi sparks when a wall run starts or the traveller kicks off. */
  wall(at: THREE.Vector3) {
    this.burst(at, 14, QI.clone().multiplyScalar(2), 2.5, 2, 0.1, 0.6, 0);
  }
  update(dt: number, ctx: FxContext) {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const s = r.from + (r.to - r.from) * (1 - Math.pow(1 - t, 2.4));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = r.opacity * (1 - t);
    }
    const { mode, anchors, player } = ctx;
    // Footfalls: spray on water, dust at a sprint, chips when running up walls.
    this.stepClock -= dt;
    if (
      ctx.moving &&
      this.stepClock <= 0 &&
      (!ctx.airborne || mode === "wall")
    ) {
      const foot = this.stepFoot++ % 2 ? anchors.leftFoot : anchors.rightFoot;
      if (mode === "wall") {
        this.stepClock = 0.09;
        this.burst(foot, 5, DUST, 1.5, 0.5, 0.12, 0.6, 9);
      } else if (ctx.onWater) {
        this.stepClock = 0.16;
        this.ring(player, "#e8f4f6", 0.2, 1.9, 0.9, 0.5, true);
        this.burst(foot, 8, SPRAY, 1.6, 3, 0.08, 0.6, 12);
      } else if (ctx.speed > 6.5) {
        this.stepClock = 0.2;
        this.burst(foot, 3, DUST, 0.8, 0.4, 0.22, 0.7, 0.5);
      }
    }
    // 제운종: qi motes spiral around the body as it climbs.
    if (mode === "soar")
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2,
          r = 0.6 + Math.random() * 0.6;
        this.p.set(
          player.x + Math.cos(a) * r,
          player.y + Math.random() * 2,
          player.z + Math.sin(a) * r,
        );
        this.v.set(-Math.sin(a) * 4, -6 - Math.random() * 4, Math.cos(a) * 4);
        this.particles.emit(
          this.p,
          this.v,
          QI.clone().multiplyScalar(2),
          0.1,
          0.6,
          0,
        );
      }
    // Gliding sheds a fine wake of light from the sleeves.
    if (mode === "glide" && Math.random() < dt * 30) {
      const hand = Math.random() < 0.5 ? anchors.left : anchors.right;
      this.v.set(
        (Math.random() - 0.5) * 0.4,
        -0.3,
        (Math.random() - 0.5) * 0.4,
      );
      this.particles.emit(
        hand,
        this.v,
        QI.clone().multiplyScalar(1.6),
        0.06,
        0.9,
        0,
      );
    }
    this.particles.update(dt);
    const flying = ctx.airborne || mode === "dash";
    const life =
      mode === "glide" || mode === "soar" ? 0.7 : mode === "dash" ? 0.45 : 0.35;
    this.trails[0].update(dt, flying ? anchors.left : null, life, ctx.camera);
    this.trails[1].update(dt, flying ? anchors.right : null, life, ctx.camera);
    const feet = mode === "dash" || mode === "soar" || mode === "plunge";
    this.trails[2].update(dt, feet ? anchors.leftFoot : null, 0.3, ctx.camera);
    this.trails[3].update(dt, feet ? anchors.rightFoot : null, 0.3, ctx.camera);
  }
}
