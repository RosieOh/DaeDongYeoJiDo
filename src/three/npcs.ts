import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GeoRoad } from "./geo";
import { shared } from "./quality";
import type { HeightField } from "./terrain";
import { rng } from "./textures";

/**
 * Villagers (마을 사람) strolling along the real lanes. All of them share
 * three instanced meshes; legs and arms swing in the vertex shader, so a
 * whole crowd costs only a few draw calls.
 */

type Part = 0 | 1 | 2 | 3 | 4; // body, left leg, right leg, left arm, right arm

function piece(
  geometry: THREE.BufferGeometry,
  color: string,
  part: Part,
  tinted: boolean,
  at: [number, number, number],
  scale?: [number, number, number],
) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (scale) g.scale(...scale);
  g.translate(...at);
  const n = g.attributes.position.count,
    c = new THREE.Color(color),
    colors = new Float32Array(n * 3),
    parts = new Float32Array(n),
    tint = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    c.toArray(colors, i * 3);
    parts[i] = part;
    tint[i] = tinted ? 1 : 0;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aPart", new THREE.BufferAttribute(parts, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
  g.deleteAttribute("uv");
  return g;
}

/** One villager: robe, sash, head, hands, legs and a hat of the given kind. */
function villager(hat: "gat" | "satgat" | "bun") {
  const skin = "#e2bc98",
    hair = "#16161a";
  const parts: THREE.BufferGeometry[] = [
    // Long robe (tinted per villager) and an inner jacket.
    piece(
      new THREE.CylinderGeometry(0.2, 0.36, 0.95, 12, 1),
      "#ffffff",
      0,
      true,
      [0, 0.72, 0],
    ),
    piece(
      new THREE.CylinderGeometry(0.17, 0.2, 0.5, 12),
      "#ffffff",
      0,
      true,
      [0, 1.42, 0],
    ),
    piece(
      new THREE.CylinderGeometry(0.205, 0.205, 0.07, 12),
      "#5a3f2e",
      0,
      false,
      [0, 1.17, 0],
    ),
    piece(
      new THREE.SphereGeometry(0.115, 12, 10),
      skin,
      0,
      false,
      [0, 1.82, 0],
      [0.92, 1.08, 0.95],
    ),
    piece(
      new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8),
      skin,
      0,
      false,
      [0, 1.69, 0],
    ),
  ];
  if (hat === "gat")
    parts.push(
      piece(
        new THREE.CylinderGeometry(0.3, 0.31, 0.012, 24),
        "#121216",
        0,
        false,
        [0, 1.92, 0],
      ),
      piece(
        new THREE.CylinderGeometry(0.085, 0.1, 0.16, 16),
        "#121216",
        0,
        false,
        [0, 2.0, 0],
      ),
    );
  else if (hat === "satgat")
    parts.push(
      piece(
        new THREE.ConeGeometry(0.34, 0.22, 16),
        "#c9a86a",
        0,
        false,
        [0, 2.0, 0],
      ),
    );
  else
    parts.push(
      piece(
        new THREE.SphereGeometry(0.12, 12, 8),
        hair,
        0,
        false,
        [0, 1.86, -0.02],
      ),
      piece(
        new THREE.SphereGeometry(0.07, 10, 8),
        hair,
        0,
        false,
        [0, 1.84, -0.13],
      ),
      piece(
        new THREE.CylinderGeometry(0.008, 0.008, 0.22, 6),
        "#c9a45c",
        0,
        false,
        [0, 1.85, -0.13],
        [1, 1, 1],
      ),
    );
  // Legs hang from the hip pivot, arms from the shoulders.
  for (const [part, x] of [
    [1, -0.09],
    [2, 0.09],
  ] as [Part, number][]) {
    parts.push(
      piece(
        new THREE.CylinderGeometry(0.06, 0.05, 0.8, 8),
        "#e8e3d6",
        part,
        false,
        [x, 0.5, 0],
      ),
    );
    parts.push(
      piece(new THREE.BoxGeometry(0.1, 0.07, 0.22), "#2a2420", part, false, [
        x,
        0.08,
        0.04,
      ]),
    );
  }
  for (const [part, x] of [
    [3, -0.24],
    [4, 0.24],
  ] as [Part, number][]) {
    parts.push(
      piece(
        new THREE.CylinderGeometry(0.07, 0.1, 0.55, 8),
        "#ffffff",
        part,
        true,
        [x, 1.15, 0],
      ),
    );
    parts.push(
      piece(new THREE.SphereGeometry(0.045, 8, 6), skin, part, false, [
        x,
        0.86,
        0.02,
      ]),
    );
  }
  const merged = mergeGeometries(parts)!;
  return merged;
}

function crowdMaterial() {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aPart;
attribute float aTint;
attribute vec2 aGait;
uniform float uTime;
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }`,
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = mix(color.rgb, color.rgb * instanceColor.rgb, aTint);
#endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = position;
// aGait.x: phase, aGait.y: stride amount (0 when standing).
float swing = sin(uTime * 6.5 + aGait.x) * 0.5 * aGait.y;
float sway = sin(uTime * 1.3 + aGait.x) * 0.04 * (1.0 - aGait.y);
vec3 pivot = aPart < 0.5 ? vec3(0.0) : aPart < 2.5 ? vec3(aPart < 1.5 ? -0.09 : 0.09, 0.9, 0.0) : vec3(aPart < 3.5 ? -0.2 : 0.2, 1.42, 0.0);
float angle = aPart < 0.5 ? 0.0 : aPart < 1.5 ? swing : aPart < 2.5 ? -swing : aPart < 3.5 ? -swing * 0.8 : swing * 0.8;
transformed = rotX(angle) * (transformed - pivot) + pivot;
transformed.x += sway * transformed.y;
transformed.y += abs(cos(uTime * 6.5 + aGait.x)) * 0.03 * aGait.y;`,
      );
  };
  m.customProgramCacheKey = () => "crowd";
  return m;
}

type Walker = {
  road: GeoRoad;
  lengths: number[];
  total: number;
  s: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
  offset: number;
  kind: number;
  index: number;
  color: THREE.Color;
  phase: number;
};

const ROBES = [
  "#f4f1ea",
  "#dfe9ef",
  "#c8d8cf",
  "#e8d7b5",
  "#c9b3c8",
  "#b9c4cc",
  "#e7c9b0",
  "#a9c1b3",
  "#d9cfe6",
];

export class Crowd {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private walkers: Walker[] = [];
  private gait: THREE.InstancedBufferAttribute[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  constructor(
    private field: HeightField,
    roads: GeoRoad[],
    center: { x: number; z: number },
    count: number,
  ) {
    const random = rng(321);
    const lanes = roads.filter((r) => {
      if (
        !["path", "minor", "service", "track", "tertiary"].includes(r.class) ||
        r.points.length < 2
      )
        return false;
      const mid = r.points[Math.floor(r.points.length / 2)];
      return Math.hypot(mid[0] - center.x, mid[1] - center.z) < 330;
    });
    const material = crowdMaterial();
    const kinds = (["gat", "satgat", "bun"] as const).map((k) => villager(k));
    const perKind = [0, 0, 0];
    for (let i = 0; i < count && lanes.length; i++) {
      const road = lanes[Math.floor(random() * lanes.length)];
      let total = 0;
      const lengths = road.points.map((p, k) =>
        k
          ? (total += Math.hypot(
              p[0] - road.points[k - 1][0],
              p[1] - road.points[k - 1][1],
            ))
          : 0,
      );
      if (total < 12) continue;
      const kind = Math.floor(random() * 3);
      this.walkers.push({
        road,
        lengths,
        total,
        s: random() * total,
        dir: random() < 0.5 ? 1 : -1,
        speed: 0.9 + random() * 0.6,
        pause: random() < 0.3 ? random() * 4 : 0,
        offset: (random() - 0.5) * 1.6,
        kind,
        index: perKind[kind]++,
        color: new THREE.Color(ROBES[Math.floor(random() * ROBES.length)]),
        phase: random() * 6.28,
      });
    }
    kinds.forEach((geometry, k) => {
      const n = Math.max(1, perKind[k]);
      const g = geometry.clone();
      const gait = new THREE.InstancedBufferAttribute(
        new Float32Array(n * 2),
        2,
      );
      g.setAttribute("aGait", gait);
      const mesh = new THREE.InstancedMesh(g, material, n);
      mesh.count = perKind[k];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.gait.push(gait);
      this.group.add(mesh);
    });
    for (const w of this.walkers)
      this.meshes[w.kind].setColorAt(w.index, w.color);
    this.meshes.forEach(
      (m) => m.instanceColor && (m.instanceColor.needsUpdate = true),
    );
    this.update(0);
  }
  /** Current villager positions (used by dev tooling and tests). */
  positions() {
    return this.walkers.map((w) => {
      const p = this.at(w, w.s);
      return { x: p.x, z: p.z };
    });
  }
  private at(w: Walker, s: number) {
    const pts = w.road.points;
    let k = 1;
    while (k < pts.length - 1 && w.lengths[k] < s) k++;
    const a = pts[k - 1],
      b = pts[k],
      seg = w.lengths[k] - w.lengths[k - 1] || 1,
      t = Math.min(1, Math.max(0, (s - w.lengths[k - 1]) / seg));
    const dx = (b[0] - a[0]) / seg,
      dz = (b[1] - a[1]) / seg;
    // Keep to one side of the lane.
    return {
      x: a[0] + (b[0] - a[0]) * t - dz * w.offset,
      z: a[1] + (b[1] - a[1]) * t + dx * w.offset,
      dx,
      dz,
    };
  }
  update(dt: number) {
    for (const w of this.walkers) {
      let moving = 1;
      if (w.pause > 0) {
        w.pause -= dt;
        moving = 0;
      } else {
        w.s += w.dir * w.speed * dt;
        if (w.s <= 0 || w.s >= w.total) {
          w.s = Math.min(Math.max(w.s, 0), w.total);
          w.dir = w.dir > 0 ? -1 : 1;
          w.pause = 1 + Math.random() * 3;
        }
      }
      const p = this.at(w, w.s);
      const heading = Math.atan2(p.dx * w.dir, p.dz * w.dir);
      this.q.setFromAxisAngle(this.up, heading);
      this.p.set(p.x, this.field.heightAt(p.x, p.z), p.z);
      this.m.compose(this.p, this.q, this.one);
      this.meshes[w.kind].setMatrixAt(w.index, this.m);
      this.gait[w.kind].setXY(w.index, w.phase, moving);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    for (const g of this.gait) g.needsUpdate = true;
  }
}
