import * as THREE from "three";
import type { MoveMode } from "./motion";
import { shared } from "./quality";

export type Capsule = { a: THREE.Vector3; b: THREE.Vector3; r: number };
export type AirState = {
  grounded: boolean;
  vy: number;
  gliding: boolean;
  flips: number;
  landed: number;
  mode?: MoveMode;
  modeTime?: number;
  jumps?: number;
  /** Roll into turns while gliding (radians). */
  bank?: number;
  /** Horizontal speed in m/s. */
  speed?: number;
  plunged?: number;
};

/** Soft sky-coloured rim light so the figure reads against busy scenery. */
export function rim<T extends THREE.MeshStandardMaterial>(
  material: T,
  strength = 0.35,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunColor = shared.sunColor;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uSunColor;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float rimLight = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
totalEmissiveRadiance += mix(vec3(0.75, 0.85, 1.0), uSunColor, 0.5) * rimLight * ${strength.toFixed(2)};`,
      );
  };
  material.customProgramCacheKey = () => `rim-${strength}`;
  return material;
}
export const std = (
  color: string,
  o: THREE.MeshStandardMaterialParameters = {},
) => rim(new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o }));
export const silk = (
  color: string,
  o: THREE.MeshPhysicalMaterialParameters = {},
) =>
  rim(
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.58,
      sheen: 1,
      sheenColor: new THREE.Color("#d6e6f2"),
      sheenRoughness: 0.35,
      side: THREE.DoubleSide,
      ...o,
    }),
    0.45,
  );
function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const _v = new THREE.Vector3(),
  _w = new THREE.Vector3();

function pushOut(p: THREE.Vector3, colliders: Capsule[], pad: number) {
  for (const c of colliders) {
    _v.subVectors(c.b, c.a);
    const len = _v.lengthSq();
    const t =
      len > 1e-8
        ? THREE.MathUtils.clamp(_w.subVectors(p, c.a).dot(_v) / len, 0, 1)
        : 0;
    _w.copy(c.a).addScaledVector(_v, t);
    const d = p.distanceTo(_w),
      r = c.r + pad;
    if (d < r && d > 1e-5)
      p.sub(_w)
        .multiplyScalar(r / d)
        .add(_w);
  }
}

/** Hair, ribbons and tassels: a verlet chain drawn as two crossed tapered strips. */
export class Strand {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[];
  private previous: THREE.Vector3[];
  private geometry = new THREE.BufferGeometry();
  private quat = new THREE.Quaternion();
  constructor(
    private anchor: THREE.Object3D,
    private count: number,
    private length: number,
    private w0: number,
    private w1: number,
    material: THREE.Material,
    private stiffness = 0,
    private rest = new THREE.Vector3(0, -1, 0),
  ) {
    this.points = Array.from({ length: count }, () => new THREE.Vector3());
    this.previous = this.points.map((p) => p.clone());
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 4 * 3), 3),
    );
    const index: number[] = [];
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < count - 1; i++) {
        const a = s * count * 2 + i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    this.geometry.setIndex(index);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }
  private restWorld() {
    return _v
      .copy(this.rest)
      .applyQuaternion(this.anchor.getWorldQuaternion(this.quat));
  }
  reset() {
    this.anchor.getWorldPosition(this.points[0]);
    const dir = this.restWorld().clone();
    for (let i = 1; i < this.count; i++)
      this.points[i]
        .copy(this.points[0])
        .addScaledVector(dir, (i * this.length) / (this.count - 1));
    this.previous.forEach((p, i) => p.copy(this.points[i]));
  }
  update(
    dt: number,
    right: THREE.Vector3,
    back: THREE.Vector3,
    time: number,
    colliders: Capsule[],
  ) {
    const seg = this.length / (this.count - 1),
      wind = shared.wind.value;
    this.anchor.getWorldPosition(this.points[0]);
    const rest = this.restWorld().clone();
    for (let i = 1; i < this.count; i++) {
      const p = this.points[i],
        prev = this.previous[i],
        vx = (p.x - prev.x) * 0.96,
        vy = (p.y - prev.y) * 0.96,
        vz = (p.z - prev.z) * 0.96;
      prev.copy(p);
      const flutter = 0.6 + Math.sin(time * 6 + i * 0.8) * 0.4;
      p.x += vx + wind.x * flutter * dt * dt * 5;
      p.y += vy - 9.8 * dt * dt;
      p.z += vz + wind.y * flutter * dt * dt * 5;
      // A gentle pull toward the rest shape keeps a ponytail from going limp.
      if (this.stiffness)
        p.lerp(
          _w.copy(this.points[i - 1]).addScaledVector(rest, seg),
          this.stiffness,
        );
    }
    for (let k = 0; k < 4; k++)
      for (let i = 1; i < this.count; i++) {
        const a = this.points[i - 1],
          b = this.points[i];
        _v.subVectors(b, a);
        const l = _v.length() || 1e-5;
        b.copy(a).addScaledVector(_v, seg / l);
        if (colliders.length) pushOut(b, colliders, 0.03);
      }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let s = 0; s < 2; s++) {
      const side = s ? back : right;
      this.points.forEach((p, i) => {
        const w = this.w0 + (this.w1 - this.w0) * (i / (this.count - 1)),
          k = s * this.count * 2 + i * 2;
        pos.setXYZ(k, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
        pos.setXYZ(k + 1, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
      });
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

/** A cloth panel pinned along its top edge (robe tails, sleeve flaps). */
export class Cloth {
  readonly mesh: THREE.Mesh;
  private points: THREE.Vector3[] = [];
  private previous: THREE.Vector3[] = [];
  private links: [number, number, number][] = [];
  private geometry = new THREE.BufferGeometry();
  constructor(
    private pins: { obj: THREE.Object3D; offset: THREE.Vector3 }[],
    private rows: number,
    private length: number,
    flare: number,
    private hang: THREE.Vector3,
    material: THREE.Material,
    trim: string,
  ) {
    const cols = pins.length,
      seg = length / (rows - 1);
    for (let i = 0; i < rows * cols; i++) {
      this.points.push(new THREE.Vector3());
      this.previous.push(new THREE.Vector3());
    }
    const top = pins.map((p) => p.offset);
    const idx = (r: number, c: number) => r * cols + c;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const widen = 1 + (flare - 1) * (r / (rows - 1));
        const w = c < cols - 1 ? top[c].distanceTo(top[c + 1]) * widen : 0;
        if (c < cols - 1) this.links.push([idx(r, c), idx(r, c + 1), w]);
        if (r < rows - 1) this.links.push([idx(r, c), idx(r + 1, c), seg]);
        if (r < rows - 1 && c < cols - 1) {
          this.links.push([idx(r, c), idx(r + 1, c + 1), Math.hypot(w, seg)]);
          this.links.push([idx(r, c + 1), idx(r + 1, c), Math.hypot(w, seg)]);
        }
      }
    const index: number[] = [],
      uv: number[] = [],
      color: number[] = [];
    const white = new THREE.Color("#ffffff"),
      band = new THREE.Color(trim);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        uv.push(c / (cols - 1), 1 - r / (rows - 1));
        (r >= rows - 2 ? band : white).toArray(color, color.length);
      }
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++)
        index.push(
          idx(r, c),
          idx(r + 1, c),
          idx(r, c + 1),
          idx(r, c + 1),
          idx(r + 1, c),
          idx(r + 1, c + 1),
        );
    this.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(this.points.length * 3), 3),
    );
    this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    this.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(color, 3),
    );
    this.geometry.setIndex(index);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }
  private pin(c: number, target: THREE.Vector3) {
    return target
      .copy(this.pins[c].offset)
      .applyMatrix4(this.pins[c].obj.matrixWorld);
  }
  reset() {
    const cols = this.pins.length,
      seg = this.length / (this.rows - 1),
      dir = new THREE.Vector3(),
      top = new THREE.Vector3();
    for (let c = 0; c < cols; c++) {
      this.pin(c, top);
      dir.copy(this.hang).transformDirection(this.pins[c].obj.matrixWorld);
      for (let r = 0; r < this.rows; r++) {
        const p = this.points[r * cols + c]
          .copy(top)
          .addScaledVector(dir, r * seg);
        this.previous[r * cols + c].copy(p);
      }
    }
  }
  update(dt: number, colliders: Capsule[], time: number) {
    const cols = this.pins.length,
      wind = shared.wind.value;
    for (let i = cols; i < this.points.length; i++) {
      const p = this.points[i],
        prev = this.previous[i],
        r = Math.floor(i / cols);
      const vx = (p.x - prev.x) * 0.95,
        vy = (p.y - prev.y) * 0.95,
        vz = (p.z - prev.z) * 0.95;
      prev.copy(p);
      const flutter =
        (0.5 + Math.sin(time * 7 + i * 1.3) * 0.5) * (r / this.rows);
      p.x += vx + wind.x * flutter * dt * dt * 7;
      p.y += vy - 9.8 * dt * dt;
      p.z += vz + wind.y * flutter * dt * dt * 7;
    }
    for (let k = 0; k < 6; k++) {
      for (let c = 0; c < cols; c++) this.pin(c, this.points[c]);
      for (const [a, b, rest] of this.links) {
        const pa = this.points[a],
          pb = this.points[b];
        _v.subVectors(pb, pa);
        const d = _v.length() || 1e-5,
          diff = (d - rest) / d;
        const wa = a < cols ? 0 : 1,
          wb = b < cols ? 0 : 1,
          sum = wa + wb || 1;
        pa.addScaledVector(_v, (diff * wa) / sum);
        pb.addScaledVector(_v, (-diff * wb) / sum);
      }
      for (let i = cols; i < this.points.length; i++)
        pushOut(this.points[i], colliders, 0.035);
    }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    this.points.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}

/* ------------------------------ painted maps ------------------------------ */

function canvas(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
) {
  const el = document.createElement("canvas");
  el.width = w;
  el.height = h;
  draw(el.getContext("2d")!);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The face is painted onto the head sphere in the manner of wuxia MMO heroes:
 * sharp sword brows, long inked eyes with catch-lights and soft rosy lips.
 * u = 0.25 faces forward on a three.js sphere.
 */
function faceTexture() {
  return canvas(1024, 512, (c) => {
    c.fillStyle = "#ecc9a8";
    c.fillRect(0, 0, 1024, 512);
    const cx = 256;
    // Gentle shading: cheeks, temples and under the brow ridge.
    for (const s of [-1, 1]) {
      const g = c.createRadialGradient(
        cx + s * 70,
        300,
        4,
        cx + s * 70,
        300,
        70,
      );
      g.addColorStop(0, "rgba(235, 150, 140, 0.28)");
      g.addColorStop(1, "rgba(235, 150, 140, 0)");
      c.fillStyle = g;
      c.fillRect(cx + s * 70 - 80, 220, 160, 160);
    }
    const shade = c.createLinearGradient(0, 180, 0, 260);
    shade.addColorStop(0, "rgba(150, 100, 80, 0)");
    shade.addColorStop(1, "rgba(150, 100, 80, 0.08)");
    c.fillStyle = shade;
    c.fillRect(cx - 100, 180, 200, 80);
    for (const s of [-1, 1]) {
      const ex = cx + s * 62,
        ey = 244;
      // Sword brow (劍眉): thick, rising outward, tapering to a point.
      c.fillStyle = "#1a1512";
      c.beginPath();
      c.moveTo(cx + s * 20, ey - 30);
      c.quadraticCurveTo(cx + s * 60, ey - 48, cx + s * 104, ey - 56);
      c.quadraticCurveTo(cx + s * 66, ey - 38, cx + s * 22, ey - 22);
      c.closePath();
      c.fill();
      // Sclera, iris and the long upper lid line.
      c.save();
      c.translate(ex, ey);
      c.scale(s, 1);
      c.beginPath();
      c.moveTo(-36, 2);
      c.quadraticCurveTo(-6, -16, 38, -6);
      c.quadraticCurveTo(8, 14, -36, 2);
      c.closePath();
      c.fillStyle = "#f6f1ea";
      c.fill();
      c.save();
      c.clip();
      const iris = c.createRadialGradient(0, -2, 1, 0, -2, 14);
      iris.addColorStop(0, "#120c0a");
      iris.addColorStop(0.55, "#3b2418");
      iris.addColorStop(1, "#1a110c");
      c.fillStyle = iris;
      c.beginPath();
      c.arc(0, -2, 14, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "rgba(255,255,255,0.95)";
      c.beginPath();
      c.arc(-5, -8, 3.6, 0, Math.PI * 2);
      c.fill();
      c.restore();
      c.strokeStyle = "#140f0d";
      c.lineCap = "round";
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(-38, 4);
      c.quadraticCurveTo(-6, -18, 40, -8);
      c.lineTo(48, -12);
      c.stroke();
      c.lineWidth = 1.6;
      c.strokeStyle = "rgba(90, 50, 40, 0.6)";
      c.beginPath();
      c.moveTo(-30, 7);
      c.quadraticCurveTo(4, 14, 34, 0);
      c.stroke();
      // Double-lid crease.
      c.strokeStyle = "rgba(120, 70, 55, 0.45)";
      c.lineWidth = 1.8;
      c.beginPath();
      c.moveTo(-26, -10);
      c.quadraticCurveTo(0, -24, 34, -16);
      c.stroke();
      c.restore();
    }
    // Nose bridge shadow and lips.
    c.strokeStyle = "rgba(150, 95, 75, 0.35)";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx + 6, 262);
    c.quadraticCurveTo(cx + 10, 300, cx + 2, 318);
    c.stroke();
    c.fillStyle = "#c97a72";
    c.beginPath();
    c.moveTo(cx - 24, 340);
    c.quadraticCurveTo(cx, 330, cx + 24, 340);
    c.quadraticCurveTo(cx, 356, cx - 24, 340);
    c.fill();
    c.strokeStyle = "rgba(110, 50, 45, 0.6)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx - 24, 340);
    c.quadraticCurveTo(cx, 344, cx + 24, 340);
    c.stroke();
  });
}

/** Silk with a tonal cloud jacquard; the hem carries a gold-on-indigo band. */
export function silkTexture(hem: boolean) {
  return canvas(256, 512, (c) => {
    c.fillStyle = "#f7f4ee";
    c.fillRect(0, 0, 256, 512);
    c.strokeStyle = "rgba(170, 185, 200, 0.28)";
    c.lineWidth = 2;
    for (let y = 30; y < 512; y += 64)
      for (let x = (y / 64) % 2 ? 0 : 64; x < 300; x += 128) {
        c.beginPath();
        c.arc(x, y, 14, Math.PI, Math.PI * 2.4);
        c.arc(x + 22, y + 4, 10, Math.PI, Math.PI * 2.2);
        c.stroke();
      }
    if (!hem) return;
    const top = 512 * 0.8;
    c.fillStyle = "#24365a";
    c.fillRect(0, top, 256, 512 - top);
    c.fillStyle = "#c9a45c";
    c.fillRect(0, top, 256, 5);
    c.fillRect(0, 504, 256, 3);
    c.strokeStyle = "#d9b86e";
    c.lineWidth = 3;
    c.lineCap = "round";
    for (let x = 10; x < 280; x += 64) {
      const y = top + 50;
      c.beginPath();
      c.arc(x, y, 16, Math.PI * 0.9, Math.PI * 2.6);
      c.stroke();
      c.beginPath();
      c.arc(x + 26, y - 10, 10, Math.PI * 1.1, Math.PI * 2.7);
      c.stroke();
      c.beginPath();
      c.moveTo(x - 16, y + 12);
      c.bezierCurveTo(x, y + 26, x + 36, y + 20, x + 48, y + 6);
      c.stroke();
    }
  });
}

type Ghost = {
  root: THREE.Group;
  nodes: THREE.Object3D[];
  material: THREE.MeshBasicMaterial;
  life: number;
};

/**
 * A wandering swordsman in the wuxia manner: high ponytail and long back
 * hair, a layered silk robe split into four tails under a sheer gauze outer
 * robe, wide sleeves and a sword across the back. Cloth and hair are
 * simulated; 경공 techniques each have their own pose and leave afterimages.
 */
export function createTraveler(ghostCount = 6) {
  const group = new THREE.Group();
  const robe = silk("#ffffff", { map: silkTexture(false) }),
    robeCloth = silk("#ffffff", { map: silkTexture(true) }),
    gauze = silk("#d6e8f5", {
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      roughness: 0.4,
      sheenColor: new THREE.Color("#ffffff"),
    }),
    inner = silk("#c9d9e8"),
    trim = std("#2a3a58", { roughness: 0.6, side: THREE.DoubleSide }),
    skin = std("#ecc9a8", { roughness: 0.6 }),
    faceSkin = std("#ffffff", { roughness: 0.55, map: faceTexture() }),
    hairMat = std("#0e0f13", { roughness: 0.38, side: THREE.DoubleSide }),
    dark = std("#16171c", { roughness: 0.45 }),
    silver = std("#d2d5db", { metalness: 0.85, roughness: 0.28 }),
    gold = std("#c9a45c", { metalness: 0.7, roughness: 0.35 }),
    pants = std("#e4e2dc"),
    boot = std("#1c1c22", { roughness: 0.55 }),
    ribbon = std("#9fc1dc", { side: THREE.DoubleSide, roughness: 0.6 }),
    tassel = std("#b8392d", { side: THREE.DoubleSide, roughness: 0.6 }),
    grip = std("#3a2a22");

  // The engine faces travellers down local -z; the model is authored facing +z.
  const body = new THREE.Group();
  body.rotation.y = Math.PI;
  group.add(body);
  const hips = new THREE.Group();
  hips.position.y = 0.98;
  body.add(hips);
  const chest = new THREE.Group();
  chest.position.y = 0.1;
  hips.add(chest);
  const torsoProfile = [
    [0.0, -0.06],
    [0.15, -0.04],
    [0.145, 0.12],
    [0.175, 0.3],
    [0.205, 0.42],
    [0.17, 0.49],
    [0.06, 0.53],
    [0.0, 0.53],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = part(new THREE.LatheGeometry(torsoProfile, 24), robe);
  torso.scale.z = 0.7;
  chest.add(torso);
  // Crossed collar over a pale inner layer, edged in gold.
  chest.add(
    part(new THREE.BoxGeometry(0.1, 0.16, 0.02), inner, 0, 0.44, 0.128),
  );
  for (const [x, y, len, rot] of [
    [0.03, 0.37, 0.32, 0.7],
    [0.09, 0.41, 0.16, -0.45],
  ]) {
    const collar = part(new THREE.BoxGeometry(0.05, len, 0.022), trim);
    collar.position.set(x, y, 0.135);
    collar.rotation.z = rot;
    chest.add(collar);
    const edge = part(new THREE.BoxGeometry(0.008, len, 0.024), gold);
    edge.position.set(
      x + 0.026 * Math.cos(rot),
      y - 0.026 * Math.sin(rot),
      0.136,
    );
    edge.rotation.z = rot;
    chest.add(edge);
  }
  // Wide belt with a jade-and-silver plaque.
  const belt = part(
    new THREE.CylinderGeometry(0.158, 0.155, 0.1, 24, 1, true),
    trim,
  );
  belt.scale.z = 0.72;
  belt.position.y = 0.02;
  chest.add(belt);
  chest.add(
    part(new THREE.BoxGeometry(0.075, 0.064, 0.02), silver, 0, 0.02, 0.118),
  );
  chest.add(
    part(
      new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12),
      std("#5fa38a", { roughness: 0.2 }),
      0,
      0.02,
      0.128,
    ).rotateX(Math.PI / 2),
  );
  const sashAnchor = new THREE.Object3D();
  sashAnchor.position.set(-0.07, 0.0, 0.11);
  chest.add(sashAnchor);
  // A jade pendant swinging from the belt.
  const pendantAnchor = new THREE.Object3D();
  pendantAnchor.position.set(0.09, -0.01, 0.1);
  chest.add(pendantAnchor);

  // Head: painted face, hair cap, high ponytail, bangs, long back hair.
  const neck = new THREE.Group();
  neck.position.y = 0.53;
  chest.add(neck);
  neck.add(
    part(new THREE.CylinderGeometry(0.042, 0.048, 0.08, 10), skin, 0, 0.02, 0),
  );
  const head = new THREE.Group();
  head.position.y = 0.155;
  neck.add(head);
  const face = part(new THREE.SphereGeometry(0.095, 40, 28), faceSkin);
  face.scale.set(0.9, 1.13, 0.96);
  head.add(face);
  const jaw = part(
    new THREE.SphereGeometry(0.06, 16, 12),
    skin,
    0,
    -0.065,
    0.012,
  );
  jaw.scale.set(1, 0.78, 1);
  head.add(jaw);
  for (const s of [-1, 1])
    head.add(
      part(new THREE.SphereGeometry(0.016, 8, 6), skin, s * 0.088, 0.0, -0.005),
    );
  const nose = part(
    new THREE.ConeGeometry(0.01, 0.028, 6),
    skin,
    0,
    -0.014,
    0.093,
  );
  nose.rotation.x = 1.25;
  head.add(nose);
  const cap = part(
    new THREE.SphereGeometry(0.1, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.6),
    hairMat,
  );
  cap.rotation.x = -0.3;
  cap.position.set(0, 0.012, -0.01);
  cap.scale.set(0.96, 1.08, 1.05);
  head.add(cap);
  // Side locks framing the face.
  for (const s of [-1, 1]) {
    const lock = part(
      new THREE.BoxGeometry(0.018, 0.12, 0.03),
      hairMat,
      s * 0.082,
      -0.02,
      0.035,
    );
    lock.rotation.z = s * 0.08;
    head.add(lock);
  }
  // Silver crown (발관) holding the topknot.
  const crown = part(
    new THREE.CylinderGeometry(0.03, 0.038, 0.045, 12),
    silver,
    0,
    0.118,
    -0.06,
  );
  crown.rotation.x = -0.35;
  head.add(crown);
  const pin = part(
    new THREE.CylinderGeometry(0.005, 0.005, 0.15, 6),
    gold,
    0,
    0.125,
    -0.06,
  );
  pin.rotation.z = Math.PI / 2;
  head.add(pin);
  head.add(
    part(new THREE.SphereGeometry(0.03, 10, 8), hairMat, 0, 0.14, -0.065),
  );
  const tail = new THREE.Object3D();
  tail.position.set(0, 0.13, -0.09);
  head.add(tail);
  const bangL = new THREE.Object3D(),
    bangR = new THREE.Object3D();
  bangL.position.set(-0.07, 0.06, 0.06);
  bangR.position.set(0.07, 0.06, 0.06);
  head.add(bangL, bangR);
  const nape = [-0.05, 0, 0.05].map((x) => {
    const o = new THREE.Object3D();
    o.position.set(x, 0.0, -0.085);
    head.add(o);
    return o;
  });

  // Arms with wide silk sleeves and a hanging sleeve flap.
  const arm = (s: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.205, 0.45, 0);
    chest.add(shoulder);
    shoulder.add(
      part(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 14), robe, 0, -0.15, 0),
    );
    const elbow = new THREE.Group();
    elbow.position.y = -0.29;
    shoulder.add(elbow);
    elbow.add(
      part(
        new THREE.CylinderGeometry(0.08, 0.12, 0.28, 16, 1, true),
        robe,
        0,
        -0.13,
        0,
      ),
    );
    const cuff = part(
      new THREE.TorusGeometry(0.12, 0.01, 6, 18),
      gold,
      0,
      -0.27,
      0,
    );
    cuff.rotation.x = Math.PI / 2;
    elbow.add(cuff);
    const hand = part(
      new THREE.SphereGeometry(0.04, 10, 8),
      skin,
      0,
      -0.31,
      0.01,
    );
    hand.scale.set(0.85, 1.25, 0.7);
    elbow.add(hand);
    // The long hanging back of a wide sleeve, pinned around the cuff.
    const flap = new Cloth(
      [125, 155, 180, 205, 235].map((deg) => {
        const t = (deg * Math.PI) / 180;
        return {
          obj: elbow,
          offset: new THREE.Vector3(
            Math.sin(t) * 0.12,
            -0.27,
            Math.cos(t) * 0.12,
          ),
        };
      }),
      7,
      0.42,
      1.3,
      new THREE.Vector3(0, -1, -0.25).normalize(),
      robeCloth,
      "#2a3a58",
    );
    return { shoulder, elbow, hand, flap };
  };
  const leftArm = arm(-1),
    rightArm = arm(1);

  const leg = (s: number) => {
    const thigh = new THREE.Group();
    thigh.position.set(s * 0.09, -0.03, 0);
    hips.add(thigh);
    thigh.add(
      part(
        new THREE.CylinderGeometry(0.075, 0.06, 0.45, 12),
        pants,
        0,
        -0.225,
        0,
      ),
    );
    const knee = new THREE.Group();
    knee.position.y = -0.45;
    thigh.add(knee);
    knee.add(
      part(new THREE.CylinderGeometry(0.06, 0.05, 0.3, 12), pants, 0, -0.12, 0),
    );
    knee.add(
      part(
        new THREE.CylinderGeometry(0.055, 0.05, 0.22, 12),
        boot,
        0,
        -0.33,
        0,
      ),
    );
    knee.add(
      part(new THREE.BoxGeometry(0.09, 0.07, 0.24), boot, 0, -0.44, 0.05),
    );
    const ankle = new THREE.Object3D();
    ankle.position.y = -0.42;
    knee.add(ankle);
    return { thigh, knee, ankle };
  };
  const leftLeg = leg(-1),
    rightLeg = leg(1);

  // Four robe tails split at the sides, front and back, like a long 도포.
  const panel = (from: number, to: number) => {
    const cols = 4,
      pins = [];
    for (let c = 0; c < cols; c++) {
      const a = from + ((to - from) * c) / (cols - 1);
      pins.push({
        obj: hips,
        offset: new THREE.Vector3(
          Math.sin(a) * 0.16,
          0.08,
          Math.cos(a) * 0.118,
        ),
      });
    }
    const mid = (from + to) / 2;
    return new Cloth(
      pins,
      9,
      0.9,
      1.55,
      new THREE.Vector3(
        Math.sin(mid) * 0.18,
        -1,
        Math.cos(mid) * 0.18,
      ).normalize(),
      robeCloth,
      "#2a3a58",
    );
  };
  const deg = Math.PI / 180;
  const tails = [
    panel(-82 * deg, -6 * deg),
    panel(6 * deg, 82 * deg),
    panel(98 * deg, 174 * deg),
    panel(-174 * deg, -98 * deg),
  ];
  // Sheer outer robe (披紗) falling from the shoulders behind the back.
  const veil = (from: number, to: number) => {
    const cols = 5,
      pins = [];
    for (let c = 0; c < cols; c++) {
      const a = from + ((to - from) * c) / (cols - 1);
      pins.push({
        obj: chest,
        offset: new THREE.Vector3(
          Math.sin(a) * 0.215,
          0.44,
          Math.cos(a) * 0.16,
        ),
      });
    }
    return new Cloth(
      pins,
      11,
      1.3,
      1.5,
      new THREE.Vector3(0, -1, -0.3).normalize(),
      gauze,
      "#ffffff",
    );
  };
  const veils = [veil(125 * deg, 180 * deg), veil(180 * deg, 235 * deg)];

  // Sword slung across the back with a red tassel.
  const sword = new THREE.Group();
  sword.position.set(0, 0.26, -0.17);
  sword.rotation.set(0.12, 0, 0.62);
  chest.add(sword);
  sword.add(
    part(new THREE.CylinderGeometry(0.024, 0.02, 0.86, 8), dark, 0, -0.1, 0),
  );
  sword.add(
    part(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), grip, 0, 0.44, 0),
  );
  sword.add(part(new THREE.BoxGeometry(0.11, 0.022, 0.04), gold, 0, 0.32, 0));
  for (const y of [-0.5, 0.1])
    sword.add(
      part(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 8), silver, 0, y, 0),
    );
  const pommel = new THREE.Object3D();
  pommel.position.y = 0.56;
  sword.add(pommel);

  // Night lantern carried in the right hand.
  const lantern = new THREE.Group();
  lantern.add(
    part(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), dark, 0, -0.1, 0),
  );
  const shadeMat = new THREE.MeshStandardMaterial({
    color: "#f3c47a",
    emissive: "#ffb054",
    emissiveIntensity: 1.4,
  });
  lantern.add(
    part(
      new THREE.CylinderGeometry(0.06, 0.07, 0.15, 10),
      shadeMat,
      0,
      -0.27,
      0,
    ),
  );
  const light = new THREE.PointLight("#ffb766", 2.6, 13, 1.7);
  light.position.y = -0.27;
  lantern.add(light);
  lantern.position.set(0, -0.06, 0.04);
  rightArm.hand.add(lantern);
  lantern.visible = false;

  const down = (x: number, z: number) =>
    new THREE.Vector3(x, -1, z).normalize();
  const strands = [
    new Strand(tail, 12, 0.95, 0.08, 0.016, hairMat, 0.05, down(0, -0.35)),
    new Strand(tail, 10, 0.78, 0.055, 0.012, hairMat, 0.07, down(0.1, -0.25)),
    new Strand(tail, 9, 0.7, 0.045, 0.01, hairMat, 0.07, down(-0.1, -0.25)),
    new Strand(bangL, 5, 0.24, 0.022, 0.008, hairMat, 0.2, down(-0.15, 0.15)),
    new Strand(bangR, 5, 0.24, 0.022, 0.008, hairMat, 0.2, down(0.15, 0.15)),
    ...nape.map(
      (n, i) =>
        new Strand(
          n,
          8,
          0.5 + i * 0.04,
          0.035,
          0.012,
          hairMat,
          0.1,
          down((i - 1) * 0.1, -0.3),
        ),
    ),
    new Strand(tail, 8, 0.7, 0.016, 0.012, ribbon),
    new Strand(sashAnchor, 9, 0.85, 0.03, 0.026, ribbon),
    new Strand(sashAnchor, 8, 0.65, 0.024, 0.02, ribbon),
    new Strand(pommel, 6, 0.3, 0.016, 0.034, tassel),
    new Strand(pendantAnchor, 5, 0.22, 0.008, 0.026, tassel),
  ];
  const HEAD_STRANDS = 8;
  const cloths = [...tails, leftArm.flap, rightArm.flap, ...veils];
  const capsule = (r: number): Capsule => ({
    a: new THREE.Vector3(),
    b: new THREE.Vector3(),
    r,
  });
  const colliders = [
    capsule(0.15),
    capsule(0.095),
    capsule(0.08),
    capsule(0.095),
    capsule(0.08),
  ];
  const headColliders = [capsule(0.11), colliders[0]];
  const updateColliders = () => {
    hips.getWorldPosition(colliders[0].a);
    neck.getWorldPosition(colliders[0].b);
    leftLeg.thigh.getWorldPosition(colliders[1].a);
    leftLeg.knee.getWorldPosition(colliders[1].b);
    colliders[2].a.copy(colliders[1].b);
    leftLeg.ankle.getWorldPosition(colliders[2].b);
    rightLeg.thigh.getWorldPosition(colliders[3].a);
    rightLeg.knee.getWorldPosition(colliders[3].b);
    colliders[4].a.copy(colliders[3].b);
    rightLeg.ankle.getWorldPosition(colliders[4].b);
    head.getWorldPosition(headColliders[0].a);
    headColliders[0].b.copy(headColliders[0].a);
  };

  // 잔상: translucent copies of the body that hold a pose and fade away.
  const bodyNodes: THREE.Object3D[] = [];
  body.traverse((o) => bodyNodes.push(o));
  const ghosts: Ghost[] = Array.from({ length: ghostCount }, () => {
    const copy = body.clone(true);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#9fe3d8").multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nodes: THREE.Object3D[] = [];
    copy.traverse((o) => {
      nodes.push(o);
      if (o instanceof THREE.Mesh) {
        o.material = material;
        o.castShadow = o.receiveShadow = false;
      }
      if (o instanceof THREE.Light) o.visible = false;
    });
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.add(copy);
    root.visible = false;
    return { root, nodes, material, life: 0 };
  });
  let ghostClock = 0,
    ghostNext = 0;
  const spawnGhost = () => {
    if (!ghosts.length) return;
    const g = ghosts[ghostNext++ % ghosts.length];
    g.root.matrix.copy(group.matrixWorld);
    bodyNodes.forEach((o, i) => {
      const n = g.nodes[i];
      if (!n) return;
      n.position.copy(o.position);
      n.quaternion.copy(o.quaternion);
      n.scale.copy(o.scale);
      n.visible = o.visible;
    });
    g.life = 1;
    g.root.visible = true;
    g.root.updateMatrixWorld(true);
  };

  let added = false,
    phase = 0,
    blend = 0,
    time = 0,
    air = 0,
    glide = 0,
    flip = 0,
    flipKind = 0,
    lastFlips = 0,
    crouch = 0,
    roll = 0,
    spin = 0,
    bank = 0;
  const w = { dash: 0, soar: 0, wall: 0, plunge: 0 };
  const right = new THREE.Vector3(),
    back = new THREE.Vector3();
  const ease = (
    o: THREE.Object3D,
    axis: "x" | "y" | "z",
    target: number,
    k: number,
  ) => {
    o.rotation[axis] += (target - o.rotation[axis]) * k;
  };
  const sim = () => {
    group.updateMatrixWorld(true);
    updateColliders();
  };

  return {
    group,
    attach(scene: THREE.Object3D) {
      if (added) return;
      added = true;
      for (const s of strands) scene.add(s.mesh);
      for (const c of cloths) scene.add(c.mesh);
      for (const g of ghosts) scene.add(g.root);
      this.reset();
    },
    reset() {
      sim();
      strands.forEach((s) => s.reset());
      cloths.forEach((c) => c.reset());
    },
    setLantern(on: boolean) {
      lantern.visible = on;
    },
    /** World positions for trails: hands, feet and the head. */
    anchors() {
      return {
        left: leftArm.hand.getWorldPosition(new THREE.Vector3()),
        right: rightArm.hand.getWorldPosition(new THREE.Vector3()),
        leftFoot: leftLeg.ankle.getWorldPosition(new THREE.Vector3()),
        rightFoot: rightLeg.ankle.getWorldPosition(new THREE.Vector3()),
        head: head.getWorldPosition(new THREE.Vector3()),
      };
    },
    /** speed: 0 idle, 1 walk, ~1.85 run; state comes from the 경공 motion. */
    update(dt: number, speed: number, state?: AirState) {
      time += dt;
      const k = 1 - Math.exp(-dt * 14),
        kf = 1 - Math.exp(-dt * 22);
      const mode = state?.mode ?? "ground";
      blend += (Math.min(speed, 2.4) - blend) * Math.min(1, dt * 8);
      const grounded = state?.grounded ?? true;
      air += ((grounded ? 0 : 1) - air) * Math.min(1, dt * 10);
      glide += ((state?.gliding ? 1 : 0) - glide) * Math.min(1, dt * 6);
      for (const key of Object.keys(w) as (keyof typeof w)[])
        w[key] += ((mode === key ? 1 : 0) - w[key]) * Math.min(1, dt * 12);
      bank +=
        ((state?.bank ?? 0) * (glide + w.dash * 0.5) - bank) *
        Math.min(1, dt * 5);
      if (state && state.flips !== lastFlips) {
        lastFlips = state.flips;
        flip = 1;
        // The second jump is a forward somersault; the third a corkscrew.
        flipKind = (state.jumps ?? 0) >= 3 ? 1 : 0;
      }
      if (state?.landed && state.landed > 7) {
        if (state.landed > 13 && (state.speed ?? 0) > 4 && mode !== "plunge")
          roll = 1;
        else crouch = state.landed > 20 ? 0.4 : 0.22;
      }
      if (state?.plunged) crouch = 0.45;
      crouch = Math.max(0, crouch - dt);
      roll = Math.max(0, roll - dt / 0.55);
      flip = Math.max(0, flip - dt / (flipKind ? 0.6 : 0.5));
      if (mode === "soar")
        spin += dt * 16 * (1 - Math.min(1, (state?.modeTime ?? 0) / 0.9) * 0.6);
      else
        spin +=
          (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) *
          Math.min(1, dt * 6);
      const run = THREE.MathUtils.clamp(blend - 1, 0, 1.4),
        moving = Math.min(1, blend) * (1 - air);
      const climb = w.wall;
      phase += dt * ((7.4 + run * 3.6) * (moving > 0.05 ? 1 : 0) + climb * 16);
      const s = Math.sin(phase),
        c = Math.cos(phase);
      const rising = state && !grounded && state.vy > 0 ? 1 : 0;
      const free = 1 - Math.min(1, w.dash + w.soar + w.wall + w.plunge);
      // Legs: stride on the ground, tucked on the rise, trailing in a glide.
      const stride = (0.42 + run * 0.4) * moving + climb * 0.9,
        tuck = air * (rising ? 1 : 0.45) * (1 - glide) * free,
        bend = (x: number) =>
          Math.max(0, x) * ((0.55 + run * 0.7) * moving + climb * 1.6);
      ease(
        leftLeg.thigh,
        "x",
        -s * stride -
          tuck * 0.9 +
          glide * 0.35 +
          w.dash * 0.55 -
          w.soar * 1.3 +
          w.plunge * -0.25 -
          roll * 1.4,
        kf,
      );
      ease(
        rightLeg.thigh,
        "x",
        s * stride -
          tuck * 0.6 +
          glide * 0.2 +
          w.dash * 0.35 +
          w.soar * 0.15 +
          w.plunge * -0.15 -
          roll * 1.4,
        kf,
      );
      ease(
        leftLeg.knee,
        "x",
        bend(Math.sin(phase + 1.2)) +
          tuck * 1.5 +
          glide * 0.4 +
          crouch * 4 +
          w.dash * 0.25 +
          w.soar * 2 +
          roll * 2.2,
        kf,
      );
      ease(
        rightLeg.knee,
        "x",
        bend(-Math.sin(phase + 1.2)) +
          tuck * 1.1 +
          glide * 0.25 +
          crouch * 3 +
          w.dash * 0.5 +
          w.soar * 0.2 +
          roll * 2.2,
        kf,
      );
      // Body: bob, lean into runs and glides, flips, spins and banking.
      hips.position.y =
        0.98 -
        Math.abs(c) * (0.025 + run * 0.035) * moving -
        crouch * 0.9 -
        roll * 0.45 +
        Math.sin(time * 2) * 0.004 * (1 - moving);
      hips.rotation.y = s * 0.07 * moving;
      const flipAngle = flip > 0 ? (1 - Math.pow(flip, 1.4)) * Math.PI * 2 : 0;
      const rollAngle = roll > 0 ? (1 - roll) * Math.PI * 2 : 0;
      hips.rotation.x =
        0.06 * run +
        glide * 0.75 +
        w.dash * 1.15 +
        climb * 0.2 +
        (flipKind ? 0.5 * Math.sin(flipAngle / 2) : flipAngle) +
        rollAngle;
      hips.rotation.z = -bank;
      body.rotation.y = Math.PI + spin + (flipKind ? flipAngle : 0);
      chest.rotation.y = -s * 0.12 * moving;
      ease(
        chest,
        "x",
        0.04 +
          run * 0.14 +
          Math.sin(time * 2) * 0.01 * (1 - moving) -
          w.dash * 0.25,
        k,
      );
      head.rotation.y = Math.sin(time * 0.37) * 0.25 * (1 - moving) * (1 - air);
      ease(
        neck,
        "x",
        -run * 0.1 - glide * 0.55 - w.dash * 0.7 + w.plunge * 0.3 - climb * 0.3,
        k,
      );
      // Arms: swing, balance in the air, spread to glide, swept back to dash.
      const swing = (0.45 + run * 0.45) * moving + climb * 0.6;
      ease(
        leftArm.shoulder,
        "x",
        s * swing -
          air * 0.5 * (1 - glide) * free +
          glide * 0.35 +
          w.dash * 1.4 -
          w.soar * 0.4 -
          w.plunge * 0.2 +
          climb * 0.8,
        kf,
      );
      ease(
        rightArm.shoulder,
        "x",
        -s * swing -
          air * 0.3 * (1 - glide) * free +
          glide * 0.35 +
          w.dash * 1.4 -
          w.soar * 2.9 -
          w.plunge * 0.2 +
          climb * 0.8,
        kf,
      );
      ease(
        leftArm.shoulder,
        "z",
        -0.14 -
          run * 0.08 -
          air * 0.5 * free -
          glide * 0.95 -
          w.dash * 0.35 -
          w.soar * 1.2 -
          w.plunge * 2.3 -
          climb * 0.3,
        kf,
      );
      ease(
        rightArm.shoulder,
        "z",
        0.14 +
          run * 0.08 +
          air * 0.5 * free +
          glide * 0.95 +
          w.dash * 0.35 +
          w.soar * 0.2 +
          w.plunge * 2.3 +
          climb * 0.3,
        kf,
      );
      ease(
        leftArm.elbow,
        "x",
        -(0.18 + run * 0.9 + Math.max(0, s) * 0.3 * moving) *
          (1 - glide) *
          (1 - w.dash) -
          w.soar * 0.6,
        kf,
      );
      ease(
        rightArm.elbow,
        "x",
        -(0.18 + run * 0.9 + Math.max(0, -s) * 0.3 * moving) *
          (1 - glide) *
          (1 - w.dash),
        kf,
      );
      if (lantern.visible && mode === "ground") {
        rightArm.shoulder.rotation.x = -0.35;
        rightArm.elbow.rotation.x = -0.9;
        lantern.rotation.x = 1.25 + s * 0.12 * moving;
      }
      sim();
      // Afterimages trail the fast techniques.
      ghostClock -= dt;
      const fast =
        mode === "dash" ||
        mode === "soar" ||
        mode === "plunge" ||
        (mode === "glide" && (state?.speed ?? 0) > 9);
      if (fast && ghostClock <= 0) {
        ghostClock = mode === "glide" ? 0.12 : 0.045;
        spawnGhost();
      }
      for (const g of ghosts) {
        if (!g.root.visible) continue;
        g.life -= dt / 0.4;
        g.material.opacity = Math.max(0, g.life) * 0.32;
        if (g.life <= 0) g.root.visible = false;
      }
      right.set(1, 0, 0).applyQuaternion(group.quaternion);
      back.set(0, 0, 1).applyQuaternion(group.quaternion);
      const step = Math.min(dt, 1 / 30);
      for (const cloth of cloths) cloth.update(step, colliders, time);
      strands.forEach((strand, i) =>
        strand.update(
          step,
          right,
          back,
          time,
          i < HEAD_STRANDS ? headColliders : colliders,
        ),
      );
    },
  };
}

export type Traveler = ReturnType<typeof createTraveler>;
