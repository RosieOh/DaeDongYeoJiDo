import * as THREE from "three";
import { shared } from "./quality";
import type { QualitySettings } from "./quality";
import type { GroundMasks, HeightField } from "./terrain";
import { noiseGLSL } from "./terrain";
import type { PlaceStyle } from "./placeStyles";
import type { SurfaceLibrary } from "./textures";
import { canvasTexture, rng } from "./textures";

type Rand = () => number;
type Species =
  | "pine"
  | "broad"
  | "tall"
  | "shrub"
  | "bamboo"
  | "blossom"
  | "maple"
  | "ginkgo";
type LeafKind =
  "needle" | "broad" | "frond" | "bamboo" | "blossom" | "maple" | "ginkgo";
/** Painted crowns: peach blossom, autumn maple and ginkgo. */
const BLOOMS: Record<string, string[]> = {
  blossom: ["#f6c5d0", "#f2a9bb", "#fbe0e6", "#e88aa2", "#fff1f3", "#f7b6c6"],
  maple: ["#d8432a", "#e9612f", "#b8301f", "#f08a3a", "#c94a26", "#f4a640"],
  ginkgo: ["#f0c43a", "#e8b028", "#f7d75a", "#d99a1e", "#fbe27a"],
};
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/* ----------------------------- foliage textures ----------------------------- */

function leafTexture(kind: LeafKind) {
  return canvasTexture(256, 256, (c, w, h) => {
    const random = rng(
      kind === "needle"
        ? 11
        : kind === "broad"
          ? 23
          : kind === "frond"
            ? 37
            : kind === "bamboo"
              ? 53
              : kind === "blossom"
                ? 61
                : kind === "maple"
                  ? 67
                  : 71,
    );
    c.clearRect(0, 0, w, h);
    if (kind === "bamboo") {
      // Fans of slender lance-shaped leaves from each twig.
      const greens = ["#4f7a35", "#5c8a3c", "#6d9a45", "#7fa84f", "#466e30"];
      for (let t = 0; t < 22; t++) {
        const cx = 30 + random() * 196,
          cy = 30 + random() * 196,
          base = random() * Math.PI * 2;
        for (let k = 0; k < 5; k++) {
          const a = base + (k - 2) * 0.32,
            l = 26 + random() * 16;
          c.save();
          c.translate(cx, cy);
          c.rotate(a);
          c.fillStyle = greens[(t + k) % greens.length];
          c.beginPath();
          c.moveTo(0, 0);
          c.quadraticCurveTo(l * 0.4, -3.6, l, 0);
          c.quadraticCurveTo(l * 0.4, 3.6, 0, 0);
          c.fill();
          c.restore();
        }
      }
      return;
    }
    const greens =
      kind === "needle"
        ? ["#2c4428", "#35512e", "#41603a", "#4c6c3c", "#5d7b45"]
        : kind === "broad"
          ? ["#3c5a2c", "#4b6c33", "#5a7d3a", "#6e8f45", "#83a050", "#9db35f"]
          : (BLOOMS[kind] ?? ["#4f6d36", "#5e7d3d", "#6f8d45", "#86a052"]);
    if (kind === "needle") {
      // Tufts of needles radiating from twig tips, layered like ink brushwork.
      for (let t = 0; t < 26; t++) {
        const cx = 40 + random() * 176,
          cy = 40 + random() * 176,
          r = 22 + random() * 26;
        for (let i = 0; i < 70; i++) {
          const a = random() * Math.PI * 2,
            l = r * (0.5 + random() * 0.5);
          c.strokeStyle = greens[Math.floor(random() * greens.length)];
          c.lineWidth = 1.2 + random();
          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l * 0.8);
          c.stroke();
        }
      }
    } else if (kind === "broad" || BLOOMS[kind]) {
      for (let i = 0; i < (BLOOMS[kind] ? 300 : 230); i++) {
        const x = 20 + random() * 216,
          y = 20 + random() * 216,
          s = 7 + random() * 9,
          a = random() * Math.PI * 2;
        if (Math.hypot(x - 128, y - 128) > 118) continue;
        c.save();
        c.translate(x, y);
        c.rotate(a);
        c.fillStyle = greens[Math.floor(random() * greens.length)];
        c.beginPath();
        c.ellipse(0, 0, s, s * 0.52, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "rgba(30,45,20,0.35)";
        c.lineWidth = 0.8;
        c.beginPath();
        c.moveTo(-s, 0);
        c.lineTo(s, 0);
        c.stroke();
        c.restore();
      }
    } else {
      // Feathery metasequoia sprays: opposite leaflets along a stem.
      for (let f = 0; f < 14; f++) {
        const x0 = 30 + random() * 196,
          y0 = 30 + random() * 196,
          a = random() * Math.PI * 2,
          len = 50 + random() * 40;
        for (let i = 0; i < 22; i++) {
          const t = i / 22,
            px = x0 + Math.cos(a) * len * t,
            py = y0 + Math.sin(a) * len * t,
            l = 9 * (1 - t * 0.6);
          c.strokeStyle = greens[(i + f) % greens.length];
          c.lineWidth = 2;
          for (const side of [-1, 1]) {
            c.beginPath();
            c.moveTo(px, py);
            c.lineTo(
              px + Math.cos(a + side * 1.2) * l,
              py + Math.sin(a + side * 1.2) * l,
            );
            c.stroke();
          }
        }
      }
    }
  });
}

/* ----------------------------- tree geometry ----------------------------- */

type Seg = { a: THREE.Vector3; b: THREE.Vector3; r0: number; r1: number };
type Card = {
  c: THREE.Vector3;
  n: THREE.Vector3;
  size: number;
  spin: number;
  center: THREE.Vector3;
};

function tubes(segs: Seg[], sides: number, height: number) {
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    wind: number[] = [];
  const q = new THREE.Quaternion(),
    d = V(),
    p = V(),
    n = V();
  for (const seg of segs) {
    // Overlap neighbouring segments so bends never open a gap.
    const dir0 = seg.b.clone().sub(seg.a).normalize();
    const s = {
      ...seg,
      a: seg.a.clone().addScaledVector(dir0, -seg.r0 * 0.6),
      b: seg.b.clone().addScaledVector(dir0, seg.r1 * 0.6),
    };
    d.subVectors(s.b, s.a);
    const length = d.length();
    q.setFromUnitVectors(UP, d.normalize());
    const ring = (center: THREE.Vector3, r: number, v: number, k: number) => {
      const out: number[][] = [];
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        n.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(q);
        p.copy(n).multiplyScalar(r).add(center);
        out.push([p.x, p.y, p.z, n.x, n.y, n.z, i / sides, v, k]);
      }
      return out;
    };
    const A = ring(s.a, s.r0, 0, s.a.y / height),
      B = ring(s.b, s.r1, length / 2.2, s.b.y / height);
    for (let i = 0; i < sides; i++)
      for (const r of [A[i], B[i], A[i + 1], A[i + 1], B[i], B[i + 1]]) {
        pos.push(r[0], r[1], r[2]);
        nor.push(r[3], r[4], r[5]);
        uv.push(r[6] * 2, r[7]);
        wind.push(r[8]);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aWind", new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

function quads(cards: Card[], height: number, roundness = 0.72) {
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    wind: number[] = [];
  const u = V(),
    w = V(),
    p = V(),
    n = V();
  for (const k of cards) {
    u.crossVectors(k.n, Math.abs(k.n.y) > 0.9 ? V(1, 0, 0) : UP).normalize();
    w.crossVectors(k.n, u).normalize();
    u.applyAxisAngle(k.n, k.spin);
    w.applyAxisAngle(k.n, k.spin);
    const corners = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, -1, 0, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    for (const [a, b, s, t] of corners) {
      p.copy(k.c)
        .addScaledVector(u, (a * k.size) / 2)
        .addScaledVector(w, (b * k.size) / 2);
      pos.push(p.x, p.y, p.z);
      // Normals bend outward from the crown centre for soft, volumetric light.
      n.subVectors(p, k.center)
        .normalize()
        .lerp(k.n, 1 - roundness)
        .normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(s, t);
      wind.push(Math.max(0.15, p.y / height));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aWind", new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

function randomDir(random: Rand) {
  const t = random() * Math.PI * 2,
    z = random() * 2 - 1,
    r = Math.sqrt(1 - z * z);
  return V(r * Math.cos(t), z, r * Math.sin(t));
}

/** Korean red pine: a leaning, kinked trunk and flat layered needle pads. */
function pineTree(random: Rand, lod: number) {
  const H = 9 + random() * 4,
    segs: Seg[] = [],
    cards: Card[] = [],
    trunk: THREE.Vector3[] = [V()];
  const lean = V(random() - 0.5, 0, random() - 0.5).multiplyScalar(0.6);
  let dir = V(lean.x, 1, lean.z).normalize();
  const steps = lod ? 3 : 6;
  for (let i = 0; i < steps; i++) {
    dir = dir
      .clone()
      .add(V((random() - 0.5) * 0.5, 0.25, (random() - 0.5) * 0.5))
      .normalize();
    trunk.push(trunk[i].clone().addScaledVector(dir, H / steps));
  }
  for (let i = 1; i < trunk.length; i++)
    segs.push({
      a: trunk[i - 1],
      b: trunk[i],
      r0: 0.3 * (1 - (i - 1) / steps) + 0.06,
      r1: 0.3 * (1 - i / steps) + 0.06,
    });
  const at = (t: number) => {
    const f = t * steps,
      i = Math.min(steps - 1, Math.floor(f));
    return trunk[i].clone().lerp(trunk[i + 1], f - i);
  };
  const top = trunk[steps];
  const crown = top.clone().add(V(0, -1.8, 0));
  const branches = lod ? 5 : 9;
  for (let k = 0; k < branches; k++) {
    const t = 0.48 + (k / branches) * 0.48 + random() * 0.04,
      start = at(t),
      yaw = k * 2.39996 + random() * 0.6,
      pitch = 0.08 + random() * 0.4,
      len = (1.15 - t) * H * 0.42 + 1.2 + random();
    const out = V(
      Math.cos(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(yaw) * Math.cos(pitch),
    );
    const mid = start
      .clone()
      .addScaledVector(out, len * 0.55)
      .add(V(0, -0.25, 0));
    const end = start
      .clone()
      .addScaledVector(out, len)
      .add(V(0, 0.35, 0));
    segs.push(
      { a: start, b: mid, r0: 0.09, r1: 0.06 },
      { a: mid, b: end, r0: 0.06, r1: 0.025 },
    );
    // Flat needle pads, the signature silhouette of 소나무 in ink paintings.
    for (const [p, s] of [
      [end, 2.3 + random() * 0.9],
      [mid, 1.6 + random() * 0.6],
    ] as [THREE.Vector3, number][]) {
      const pads = lod ? 2 : 4;
      for (let i = 0; i < pads; i++)
        cards.push({
          c: p
            .clone()
            .add(
              V(
                (random() - 0.5) * 0.8,
                0.15 + random() * 0.35,
                (random() - 0.5) * 0.8,
              ),
            ),
          n: V((random() - 0.5) * 0.7, 1, (random() - 0.5) * 0.7).normalize(),
          size: s * (lod ? 1.35 : 1),
          spin: random() * 6.28,
          center: crown,
        });
      if (!lod)
        cards.push({
          c: p.clone().add(V(0, 0.2, 0)),
          n: V(Math.cos(yaw + 1.57), 0.2, Math.sin(yaw + 1.57)).normalize(),
          size: s * 0.8,
          spin: random() * 6.28,
          center: crown,
        });
    }
  }
  for (let i = 0; i < (lod ? 2 : 4); i++)
    cards.push({
      c: top
        .clone()
        .add(V((random() - 0.5) * 0.6, 0.3, (random() - 0.5) * 0.6)),
      n: V((random() - 0.5) * 0.6, 1, (random() - 0.5) * 0.6).normalize(),
      size: 2.4,
      spin: random() * 6.28,
      center: crown,
    });
  return { segs, cards, height: H + 1, roundness: 0.55 };
}

/** Deciduous broadleaf (oak, zelkova): forked limbs under a rounded crown. */
function broadTree(random: Rand, lod: number) {
  const fork = 2.4 + random() * 1.4,
    segs: Seg[] = [{ a: V(), b: V(0, fork, 0), r0: 0.32, r1: 0.24 }],
    cards: Card[] = [];
  const R = 3.3 + random() * 1.4,
    center = V((random() - 0.5) * 0.8, fork + R * 0.95, (random() - 0.5) * 0.8);
  const limbs = 3 + Math.floor(random() * 2);
  for (let i = 0; i < limbs; i++) {
    const yaw = (i / limbs) * Math.PI * 2 + random() * 0.8,
      end = center
        .clone()
        .add(
          V(
            Math.cos(yaw) * R * 0.6,
            (random() - 0.2) * R * 0.5,
            Math.sin(yaw) * R * 0.6,
          ),
        );
    const mid = V(0, fork, 0)
      .lerp(end, 0.5)
      .add(V(0, 0.4, 0));
    segs.push(
      { a: V(0, fork, 0), b: mid, r0: 0.19, r1: 0.13 },
      { a: mid, b: end, r0: 0.13, r1: 0.05 },
    );
    if (!lod)
      for (let j = 0; j < 2; j++) {
        const twig = end
          .clone()
          .add(
            V((random() - 0.5) * 2.4, random() * 1.6, (random() - 0.5) * 2.4),
          );
        segs.push({
          a: mid.clone().lerp(end, 0.6),
          b: twig,
          r0: 0.06,
          r1: 0.02,
        });
      }
  }
  const count = lod ? 16 : 58;
  for (let i = 0; i < count; i++) {
    const d = randomDir(random),
      r = Math.pow(random(), 0.35);
    const c = center
      .clone()
      .add(V(d.x * R * r, d.y * R * 0.82 * r, d.z * R * r));
    cards.push({
      c,
      n: randomDir(random),
      size: (lod ? 3.4 : 2.1) + random() * 0.7,
      spin: random() * 6.28,
      center,
    });
  }
  return { segs, cards, height: center.y + R, roundness: 0.8 };
}

/** Metasequoia: a straight trunk and a narrow cone of feathery sprays. */
function tallTree(random: Rand, lod: number) {
  const H = 17 + random() * 7,
    segs: Seg[] = [{ a: V(), b: V(0, H, 0), r0: 0.42, r1: 0.04 }],
    cards: Card[] = [];
  const base = 2.2,
    count = lod ? 16 : 54;
  for (let i = 0; i < count; i++) {
    const t = Math.pow(random(), 0.8),
      y = base + t * (H - base),
      radius = (1 - t) * 3.1 + 0.35,
      yaw = random() * Math.PI * 2,
      c = V(Math.cos(yaw) * radius * 0.8, y, Math.sin(yaw) * radius * 0.8);
    cards.push({
      c,
      n: V(Math.cos(yaw) * 0.6, 0.8, Math.sin(yaw) * 0.6).normalize(),
      size: (lod ? 2.8 : 1.9) + random() * 0.5,
      spin: random() * 6.28,
      center: V(0, y, 0),
    });
    if (!lod && i % 2 === 0)
      segs.push({ a: V(0, y - 0.2, 0), b: c.clone(), r0: 0.05, r1: 0.02 });
  }
  return { segs, cards, height: H, roundness: 0.65 };
}

function shrub(random: Rand, lod: number) {
  const R = 0.7 + random() * 0.5,
    center = V(0, R * 0.7, 0),
    cards: Card[] = [];
  for (let i = 0; i < (lod ? 5 : 11); i++) {
    const d = randomDir(random);
    cards.push({
      c: center
        .clone()
        .add(V(d.x * R * 0.7, Math.abs(d.y) * R * 0.5, d.z * R * 0.7)),
      n: randomDir(random),
      size: 1 + random() * 0.4,
      spin: random() * 6.28,
      center,
    });
  }
  return { segs: [] as Seg[], cards, height: R * 1.6, roundness: 0.85 };
}

/** 대나무 clump: slender jointed culms leaning outward, leafy in the upper half. */
function bambooClump(random: Rand, lod: number) {
  const segs: Seg[] = [],
    cards: Card[] = [];
  const culms = lod ? 8 : 15;
  let top = 0;
  for (let i = 0; i < culms; i++) {
    const a = random() * Math.PI * 2,
      r0 = random() * 1.3,
      H = 8 + random() * 5,
      lean = 0.04 + random() * 0.08;
    const root = V(Math.cos(a) * r0, 0, Math.sin(a) * r0);
    const dir = V(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
    const joints = lod ? 3 : 6;
    let prev = root;
    for (let j = 1; j <= joints; j++) {
      // Culms bow a little more toward the tip.
      const t = j / joints,
        p = root
          .clone()
          .addScaledVector(dir, H * t)
          .add(V(Math.cos(a), 0, Math.sin(a)).multiplyScalar(t * t * H * 0.08));
      segs.push({
        a: prev,
        b: p,
        r0: 0.065 * (1 - t * 0.4),
        r1: 0.065 * (1 - t * 0.45),
      });
      prev = p;
    }
    top = Math.max(top, H);
    const leafy = lod ? 4 : 9;
    for (let k = 0; k < leafy; k++) {
      const t = 0.45 + (k / leafy) * 0.55,
        p = root.clone().addScaledVector(dir, H * t);
      const out = V(
        Math.cos(a + (random() - 0.5) * 2),
        0.3,
        Math.sin(a + (random() - 0.5) * 2),
      ).normalize();
      cards.push({
        c: p.addScaledVector(out, 0.6),
        n: V(random() - 0.5, 0.6, random() - 0.5).normalize(),
        size: (lod ? 2.3 : 1.5) + random() * 0.5,
        spin: random() * 6.28,
        center: V(0, H * 0.7, 0),
      });
    }
  }
  return { segs, cards, height: top, roundness: 0.55 };
}

const builders = {
  pine: pineTree,
  broad: broadTree,
  tall: tallTree,
  shrub,
  bamboo: bambooClump,
  blossom: broadTree,
  maple: broadTree,
  ginkgo: broadTree,
};

/* ------------------------------- materials ------------------------------- */

/** Applies wind sway after instancing so every tree bends the same way. */
function windify(
  material: THREE.Material,
  leaves: boolean,
  translucent = false,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    shader.uniforms.uSunDir = shared.sunDir;
    shader.uniforms.uPlayer = shared.player;
    shader.uniforms.uSunColor = shared.sunColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aWind;
uniform float uTime;
uniform vec2 uWind;
varying vec3 vLeafPos;
varying vec3 vFadePos;
varying float vCamFade;
${noiseGLSL}`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  vec2 root = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  vec2 root = vec2(0.0);
#endif
float phase = root.x * 0.11 + root.y * 0.13;
float gust = vnoise(root * 0.015 + uTime * 0.12);
float sway = sin(uTime * 1.05 + phase) * 0.65 + sin(uTime * 2.2 + phase * 1.9) * 0.25;
float bend = aWind * aWind * (0.18 + gust * 0.45);
mvPosition.xz += uWind * sway * bend;
${leaves ? "mvPosition.xyz += vec3(sin(uTime * 5.0 + mvPosition.y * 2.0 + phase), cos(uTime * 4.0 + mvPosition.x * 1.7), sin(uTime * 4.6 + mvPosition.z * 2.1)) * 0.045 * aWind;" : ""}
vLeafPos = mvPosition.xyz;
vCamFade = smoothstep(1.2, 3.4, distance(mvPosition.xyz, cameraPosition));
vFadePos = mvPosition.xyz;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
    // Dither away foliage right in front of the camera instead of filling the screen.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vCamFade;\nvarying vec3 vFadePos;\nuniform vec3 uPlayer;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
float bayer = fract(dot(floor(gl_FragCoord.xy), vec2(0.5, 0.25)) + fract(gl_FragCoord.y * 0.5) * 0.5);
// Also clear a soft tunnel between the camera and the traveller.
vec3 target = uPlayer + vec3(0.0, 1.1, 0.0);
vec3 ray = target - cameraPosition;
float along = clamp(dot(vFadePos - cameraPosition, ray) / dot(ray, ray), 0.0, 1.0);
float tunnel = smoothstep(0.9, 1.9, distance(vFadePos, cameraPosition + ray * along)) + step(0.96, along);
if (min(vCamFade, tunnel) < bayer) discard;`,
      );
    if (translucent)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;\nvarying vec3 vLeafPos;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
float backlit = pow(max(dot(normalize(vLeafPos - cameraPosition), uSunDir), 0.0), 4.0);
totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (backlit * 0.9 + 0.06);`,
        );
  };
  material.customProgramCacheKey = () => `wind-${leaves}-${translucent}`;
  return material;
}

/* ------------------------------ tree field ------------------------------- */

type TreeInstance = {
  x: number;
  y: number;
  z: number;
  s: number;
  r: number;
  species: Species;
  variant: number;
  color: THREE.Color;
};
type Bucket = {
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh[];
  items: TreeInstance[];
};

export class TreeField {
  readonly group = new THREE.Group();
  private buckets = new Map<string, Bucket>();
  private last = new THREE.Vector2(Infinity, Infinity);
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private pos = new THREE.Vector3();
  constructor(
    instances: TreeInstance[],
    surfaces: SurfaceLibrary,
    private nearRadius: number,
  ) {
    const bark = (color: string) =>
      windify(
        new THREE.MeshStandardMaterial({
          color,
          map: surfaces.maps.bark.map,
          normalMap: surfaces.maps.bark.normal,
          roughness: 0.95,
        }),
        false,
      );
    const foliage = (kind: LeafKind) => {
      const map = leafTexture(kind);
      const material = windify(
        new THREE.MeshStandardMaterial({
          map,
          alphaTest: 0.42,
          side: THREE.DoubleSide,
          roughness: 0.82,
          alphaToCoverage: true,
        }),
        true,
        true,
      );
      const depth = windify(
        new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          map,
          alphaTest: 0.42,
        }),
        true,
      );
      return { material, depth };
    };
    const leaves = {
      pine: foliage("needle"),
      broad: foliage("broad"),
      tall: foliage("frond"),
      shrub: foliage("broad"),
      bamboo: foliage("bamboo"),
      blossom: foliage("blossom"),
      maple: foliage("maple"),
      ginkgo: foliage("ginkgo"),
    };
    const trunks = {
      pine: bark("#c58b6a"),
      broad: bark("#9a8f84"),
      tall: bark("#a97e62"),
      shrub: bark("#6b5a4a"),
      bamboo: windify(
        new THREE.MeshStandardMaterial({ color: "#86a259", roughness: 0.45 }),
        false,
      ),
      blossom: bark("#6e5446"),
      maple: bark("#5d4a3e"),
      ginkgo: bark("#8a7a68"),
    };
    (Object.keys(builders) as Species[]).forEach((species, speciesIndex) => {
      for (let variant = 0; variant < 3; variant++) {
        const items = instances.filter(
          (t) => t.species === species && t.variant === variant,
        );
        if (!items.length) continue;
        const bucket: Bucket = { near: [], far: [], items };
        for (const lod of [0, 1]) {
          // Same seed for both detail levels so the silhouette does not jump.
          const tree = builders[species](
            rng(1000 + variant * 17 + speciesIndex * 101),
            lod,
          );
          const parts: [
            THREE.BufferGeometry,
            THREE.Material,
            THREE.Material?,
          ][] = [];
          if (tree.segs.length)
            parts.push([
              tubes(tree.segs, lod ? 4 : 7, tree.height),
              trunks[species],
            ]);
          parts.push([
            quads(tree.cards, tree.height, tree.roundness),
            leaves[species].material,
            leaves[species].depth,
          ]);
          for (const [geometry, material, depth] of parts) {
            const mesh = new THREE.InstancedMesh(
              geometry,
              material,
              items.length,
            );
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.castShadow = lod === 0;
            mesh.receiveShadow = true;
            if (depth) mesh.customDepthMaterial = depth;
            mesh.instanceColor = new THREE.InstancedBufferAttribute(
              new Float32Array(items.length * 3),
              3,
            );
            (lod ? bucket.far : bucket.near).push(mesh);
            this.group.add(mesh);
          }
        }
        this.buckets.set(`${species}-${variant}`, bucket);
      }
    });
  }
  get count() {
    let n = 0;
    for (const b of this.buckets.values()) n += b.items.length;
    return n;
  }
  /** Re-sorts trees into detailed and simplified sets around the traveller. */
  update(x: number, z: number, force = false) {
    if (!force && Math.hypot(x - this.last.x, z - this.last.y) < 10) return;
    this.last.set(x, z);
    const r2 = this.nearRadius * this.nearRadius;
    for (const bucket of this.buckets.values()) {
      let n = 0,
        f = 0;
      for (const t of bucket.items) {
        const near = (t.x - x) ** 2 + (t.z - z) ** 2 < r2;
        this.quat.setFromAxisAngle(UP, t.r);
        this.scale.setScalar(t.s);
        this.matrix.compose(this.pos.set(t.x, t.y, t.z), this.quat, this.scale);
        const meshes = near ? bucket.near : bucket.far,
          i = near ? n++ : f++;
        for (const mesh of meshes) {
          mesh.setMatrixAt(i, this.matrix);
          mesh.setColorAt(i, t.color);
        }
      }
      for (const mesh of bucket.near) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      for (const mesh of bucket.far) {
        mesh.count = f;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

/** Scatters trees from land cover, with density falling off toward the horizon. */
export function scatterTrees(
  field: HeightField,
  masks: GroundMasks,
  style: PlaceStyle,
  quality: QualitySettings,
  extraBlocked: (x: number, z: number) => boolean,
) {
  const random = rng(7352),
    e = field.data.terrain.extent,
    list: TreeInstance[] = [];
  // Bamboo grows in groves, so it follows a patch pattern rather than odds.
  const grove = (x: number, z: number) =>
    Math.sin(x * 0.031 + Math.sin(z * 0.023) * 2) *
    Math.sin(z * 0.027 + Math.sin(x * 0.019) * 2);
  // Flowering and autumn trees gather in drifts, as in painted landscapes.
  const drift = (x: number, z: number, k: number) =>
    Math.sin(x * 0.021 + k + Math.sin(z * 0.017 + k) * 2) *
      Math.sin(z * 0.019 - k + Math.sin(x * 0.023) * 2) *
      0.5 +
    0.5;
  const pick = (x: number, z: number): Species => {
    if (style.trees.bamboo && grove(x, z) > 0.62 - style.trees.bamboo)
      return "bamboo";
    for (const [k, species] of [
      [1.3, "blossom"],
      [2.9, "maple"],
      [4.7, "ginkgo"],
    ] as const) {
      const w = style.trees[species] ?? 0;
      if (w && drift(x, z, k) > 1 - w * 1.6 && random() < 0.85) return species;
    }
    const r =
      random() * (style.trees.pine + style.trees.broad + style.trees.tall);
    return r < style.trees.pine
      ? "pine"
      : r < style.trees.pine + style.trees.broad
        ? "broad"
        : "tall";
  };
  const tint = new THREE.Color();
  const add = (x: number, z: number, species: Species, s: number) => {
    const variant = Math.floor(random() * 3);
    if (species in BLOOMS) {
      // Painted crowns keep their colour; only a slight shade variation.
      const v = 0.88 + random() * 0.2;
      list.push({
        x,
        z,
        y: field.groundAt(x, z) - 0.15,
        s,
        r: random() * Math.PI * 2,
        species,
        variant,
        color: new THREE.Color(v, v, v),
      });
      return;
    }
    tint.setHSL(
      species === "pine" ? 0.27 + random() * 0.04 : 0.2 + random() * 0.09,
      0.25 + random() * 0.2,
      0.42 + random() * 0.16,
    );
    list.push({
      x,
      z,
      y: field.groundAt(x, z) - 0.15,
      s,
      r: random() * Math.PI * 2,
      species,
      variant,
      color: new THREE.Color(1, 1, 1).lerp(
        tint.clone().multiplyScalar(2.1),
        0.35,
      ),
    });
  };
  const free = (x: number, z: number, margin: number) =>
    masks.sample("road", x, z) < 0.05 &&
    masks.sample("building", x, z) < 0.02 &&
    masks.sample("water", x, z) < 0.05 &&
    masks.sample("road", x + margin, z) < 0.2 &&
    masks.sample("road", x - margin, z) < 0.2 &&
    masks.sample("building", x + margin, z + margin) < 0.05 &&
    masks.sample("building", x - margin, z - margin) < 0.05 &&
    !extraBlocked(x, z);
  // Rings with growing spacing; outer trees are larger to read as canopy.
  const rings = [
    { from: 0, to: 280, spacing: 6.5, scale: 1 },
    { from: 280, to: 560, spacing: 10, scale: 1.25 },
    { from: 560, to: e * 1.42, spacing: 15, scale: 1.6 },
  ];
  for (const ring of rings) {
    const spacing = ring.spacing / Math.sqrt(style.forestDensity);
    for (let gz = -e; gz < e; gz += spacing)
      for (let gx = -e; gx < e; gx += spacing) {
        const x = gx + random() * spacing,
          z = gz + random() * spacing,
          d = Math.hypot(x, z);
        if (
          d < ring.from ||
          d >= ring.to ||
          Math.abs(x) > e - 4 ||
          Math.abs(z) > e - 4
        )
          continue;
        const forest = masks.sample("forest", x, z),
          open =
            masks.sample("grass", x, z) * 0.1 +
            masks.sample("court", x, z) * 0.05;
        if (random() > forest * 0.95 + open) continue;
        if (!free(x, z, 2.5)) continue;
        const species =
          forest > 0.3 ? pick(x, z) : random() < 0.5 ? "pine" : "broad";
        add(x, z, species, ring.scale * (0.75 + random() * 0.55));
        // Understorey shrubs close to the paths.
        if (d < 200 && random() < 0.25 * forest) {
          const sx = x + (random() - 0.5) * 5,
            sz = z + (random() - 0.5) * 5;
          if (free(sx, sz, 1)) add(sx, sz, "shrub", 0.8 + random() * 0.6);
        }
      }
  }
  // Street trees in towns line the larger roads.
  if (!style.rural)
    for (const road of field.data.roads) {
      if (!["tertiary", "secondary", "primary", "minor"].includes(road.class))
        continue;
      const half =
        (road.class === "minor" ? 2.5 : road.class === "tertiary" ? 4 : 6) +
        1.6;
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i],
          len = Math.hypot(bx - ax, bz - az);
        if (!len) continue;
        const nx = -(bz - az) / len,
          nz = (bx - ax) / len;
        for (let t = 4; t < len; t += 11)
          for (const side of [-1, 1]) {
            const x = ax + ((bx - ax) * t) / len + nx * half * side,
              z = az + ((bz - az) * t) / len + nz * half * side;
            if (Math.abs(x) > e - 4 || Math.abs(z) > e - 4 || random() < 0.35)
              continue;
            if (
              masks.sample("building", x, z) > 0.02 ||
              masks.sample("water", x, z) > 0.05 ||
              extraBlocked(x, z)
            )
              continue;
            const avenue: Species =
              (style.trees.ginkgo ?? 0) > 0.15
                ? "ginkgo"
                : (style.trees.blossom ?? 0) > 0.1
                  ? "blossom"
                  : "broad";
            add(x, z, avenue, 0.62 + random() * 0.2);
          }
      }
    }
  // Keep the budget, dropping distant trees first.
  if (list.length > quality.treeBudget) {
    list.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const keep = list.slice(0, Math.floor(quality.treeBudget * 0.6));
    const rest = list.slice(keep.length);
    const ratio = (quality.treeBudget - keep.length) / rest.length;
    for (const t of rest) if (random() < ratio) keep.push(t);
    return keep;
  }
  return list;
}

/* --------------------------------- grass --------------------------------- */

/** GPU grass that follows the traveller; blades are stable in world space. */
export function createGrass(
  field: HeightField,
  density: THREE.DataTexture,
  style: PlaceStyle,
  quality: QualitySettings,
) {
  const blade = new THREE.BufferGeometry();
  const pos: number[] = [],
    idx: number[] = [];
  // Three blades per clump, each a tapered 3-segment strip.
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI + 0.3,
      ox = Math.cos(a * 2.3 + b) * 0.07,
      oz = Math.sin(a * 2.3 + b) * 0.07,
      start = pos.length / 3;
    const levels = [0, 0.35, 0.7];
    for (const t of levels) {
      const w = 0.024 * (1 - t * 0.75);
      pos.push(
        ox - Math.cos(a) * w,
        t,
        oz - Math.sin(a) * w,
        ox + Math.cos(a) * w,
        t,
        oz + Math.sin(a) * w,
      );
    }
    pos.push(ox, 1, oz);
    for (let l = 0; l < 2; l++) {
      const i = start + l * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    idx.push(start + 4, start + 5, start + 6);
  }
  blade.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  blade.setIndex(idx);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = blade.index;
  geometry.attributes.position = blade.attributes.position;
  const count = quality.grassCount,
    R = quality.grassRadius,
    S = R * 2;
  const offsets = new Float32Array(count * 4),
    random = rng(99);
  for (let i = 0; i < count; i++)
    offsets.set([random() * S, random() * S, random(), random()], i * 4);
  geometry.setAttribute(
    "aOffset",
    new THREE.InstancedBufferAttribute(offsets, 4),
  );
  geometry.instanceCount = count;
  const heights = new THREE.DataTexture(
    field.heights,
    field.n,
    field.n,
    THREE.RedFormat,
    THREE.FloatType,
  );
  heights.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    roughness: 0.78,
    color: new THREE.Color(style.grassTint),
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: shared.time,
      uWind: shared.wind,
      uPlayer: shared.player,
      uSunDir: shared.sunDir,
      uSunColor: shared.sunColor,
      uHeights: { value: heights },
      uDensity: { value: density },
      uGrid: {
        value: new THREE.Vector3(
          field.n,
          field.step,
          field.data.terrain.extent,
        ),
      },
      uRange: { value: R },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aOffset;
uniform float uTime, uRange;
uniform vec2 uWind;
uniform vec3 uPlayer, uGrid;
uniform highp sampler2D uHeights;
uniform sampler2D uDensity;
varying float vBlade;
varying float vTip;
varying vec3 vGrassPos;
${noiseGLSL}
float groundAt(vec2 p) {
  float n = uGrid.x;
  vec2 g = clamp((p + uGrid.z) / uGrid.y, vec2(0.0), vec2(n - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = texelFetch(uHeights, i, 0).r;
  float h10 = texelFetch(uHeights, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uHeights, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uHeights, i + ivec2(1, 1), 0).r;
  return f.x + f.y <= 1.0
    ? h00 + (h10 - h00) * f.x + (h01 - h00) * f.y
    : h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `float S = uRange * 2.0;
vec2 home = aOffset.xy + S * floor((uPlayer.xz - aOffset.xy) / S + 0.5);
vec2 dens = (home + uGrid.z) / (2.0 * uGrid.z);
float keep = texture2D(uDensity, vec2(dens.x, dens.y)).r;
float dist = length(home - uPlayer.xz);
float size = step(aOffset.z, keep) * smoothstep(uRange, uRange * 0.72, dist);
size *= step(abs(home.x), uGrid.z - 2.0) * step(abs(home.y), uGrid.z - 2.0);
float tall = (0.16 + aOffset.w * 0.3) * (0.55 + keep * 0.55);
float rot = aOffset.z * 40.0;
mat2 spin = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
vec3 transformed = position;
transformed.xz = spin * transformed.xz * (0.8 + aOffset.w * 0.5);
float t = position.y;
transformed.y = t * tall;
// A resting lean so blades arch instead of standing like spikes.
vec2 lean = vec2(cos(rot * 1.7), sin(rot * 1.7));
transformed.xz += lean * t * t * tall * 0.45;
float gust = vnoise(home * 0.04 + uTime * vec2(0.35, 0.18));
float sway = sin(uTime * 1.9 + home.x * 0.17 + home.y * 0.11) * 0.35 + gust * 0.9;
transformed.xz += uWind * sway * t * t * tall * 0.55;
vec2 away = home - uPlayer.xz;
float push = (1.0 - smoothstep(0.2, 1.1, length(away))) * t * 0.5;
transformed.xz += normalize(away + 1e-4) * push;
transformed.y -= push * 0.25;
transformed *= size;
transformed.xz += home;
transformed.y += groundAt(home);
vBlade = aOffset.w;
vTip = t;
vGrassPos = transformed;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        "vec3 objectNormal = vec3(0.0, 1.0, 0.0);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uSunDir, uSunColor;
varying float vBlade;
varying float vTip;
varying vec3 vGrassPos;
${noiseGLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
float patchy = vfbm(vGrassPos.xz * 0.03);
vec3 rootC = vec3(0.07, 0.11, 0.04);
vec3 tipC = mix(vec3(0.24, 0.36, 0.09), vec3(0.42, 0.44, 0.15), patchy);
tipC = mix(tipC, vec3(0.3, 0.4, 0.12), step(0.5, fract(vBlade * 13.0)) * 0.5);
vec3 grass = mix(rootC, tipC, smoothstep(0.0, 1.0, vTip)) * (0.75 + vBlade * 0.45);
if (vBlade > 0.975 && vTip > 0.8) grass = vBlade > 0.99 ? vec3(0.9, 0.85, 0.75) : vec3(0.85, 0.7, 0.25);
diffuseColor.rgb *= grass;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float back = pow(max(dot(normalize(vGrassPos - cameraPosition), uSunDir), 0.0), 3.0);
totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * vTip * 0.7;`,
      );
  };
  material.customProgramCacheKey = () => "grass";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = "grass";
  return mesh;
}

/* ------------------------------ rocks & tea ------------------------------ */

export function scatterRocks(
  field: HeightField,
  masks: GroundMasks,
  surfaces: SurfaceLibrary,
  rocky: number,
) {
  const random = rng(17),
    e = field.data.terrain.extent;
  const shapes: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      const n =
        1 +
        Math.sin(v.x * 3.1 + k) * 0.12 +
        Math.sin(v.y * 4.3 + k * 2) * 0.1 +
        (random() - 0.5) * 0.1;
      v.multiplyScalar(n);
      v.y *= 0.62;
      if (v.y < -0.15) v.y = -0.15 - (v.y + 0.15) * 0.2;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++)
      uv.setXY(i, p.getX(i) * 0.6 + p.getZ(i) * 0.3, p.getY(i) * 0.6);
    shapes.push(g);
  }
  const material = new THREE.MeshStandardMaterial({
    map: surfaces.maps.rock.map,
    normalMap: surfaces.maps.rock.normal,
    color: "#b9b4aa",
    roughness: 0.9,
  });
  const group = new THREE.Group(),
    n = new THREE.Vector3(),
    m = new THREE.Matrix4(),
    q = new THREE.Quaternion();
  const per: THREE.Matrix4[][] = shapes.map(() => []);
  for (let i = 0; i < 2600 && per.flat().length < 420 * rocky + 60; i++) {
    const x = (random() * 2 - 1) * (e - 10),
      z = (random() * 2 - 1) * (e - 10);
    if (Math.hypot(x, z) > 520) continue;
    field.normalAt(x, z, n);
    const chance =
      masks.sample("rock", x, z) * 0.8 +
      (1 - n.y) * 2.5 * rocky +
      masks.sample("forest", x, z) * 0.04;
    if (random() > chance) continue;
    if (
      masks.sample("road", x, z) > 0.05 ||
      masks.sample("building", x, z) > 0.02 ||
      masks.sample("water", x, z) > 0.3
    )
      continue;
    const s = (0.35 + Math.pow(random(), 3) * 2.6) * (0.8 + rocky * 0.6);
    q.setFromUnitVectors(UP, n.clone().lerp(UP, 0.5).normalize()).multiply(
      new THREE.Quaternion().setFromAxisAngle(UP, random() * 6.28),
    );
    m.compose(
      V(x, field.groundAt(x, z) - s * 0.15, z),
      q,
      V(s, s * (0.7 + random() * 0.6), s * (0.8 + random() * 0.4)),
    );
    per[Math.floor(random() * shapes.length)].push(m.clone());
  }
  shapes.forEach((g, k) => {
    if (!per[k].length) return;
    const mesh = new THREE.InstancedMesh(g, material, per[k].length);
    per[k].forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

/** Boseong's tea terraces: clipped hedgerows that follow the contour lines. */
export function teaRows(field: HeightField, masks: GroundMasks, limit: number) {
  const base = new THREE.CapsuleGeometry(0.62, 1.1, 3, 8);
  base.rotateZ(Math.PI / 2);
  base.scale(1, 0.8, 1);
  const material = new THREE.MeshStandardMaterial({
    color: "#5f8a34",
    roughness: 0.85,
  });
  const shade = leafTexture("broad");
  material.map = shade;
  const matrices: THREE.Matrix4[] = [];
  const n = new THREE.Vector3(),
    random = rng(5);
  for (let z = -520; z < 520 && matrices.length < limit; z += 1.25)
    for (let x = -520; x < 520 && matrices.length < limit; x += 1.85) {
      if (
        masks.sample("field", x, z) < 0.55 ||
        masks.sample("road", x, z) > 0.05
      )
        continue;
      field.normalAt(x, z, n);
      const h = field.groundAt(x, z);
      // Rows follow contour lines on slopes and run east-west on the flat.
      const level = n.y > 0.995 ? z / 1.8 : h / 0.9;
      if (level - Math.floor(level) > 0.45) continue;
      const along = Math.atan2(n.x, n.z);
      matrices.push(
        new THREE.Matrix4().compose(
          V(x, h + 0.25, z),
          new THREE.Quaternion().setFromAxisAngle(
            UP,
            along + (random() - 0.5) * 0.1,
          ),
          V(1, 0.85 + random() * 0.2, 1),
        ),
      );
    }
  const mesh = new THREE.InstancedMesh(
    base,
    material,
    Math.max(1, matrices.length),
  );
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = "tea";
  return mesh;
}

/* --------------------------- wildflowers & reeds -------------------------- */

function flowerTexture() {
  return canvasTexture(128, 128, (c, w, h) => {
    const random = rng(61);
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      const x = 12 + random() * 104,
        top = 18 + random() * 46;
      c.strokeStyle = "#4f6b34";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + (random() - 0.5) * 10, h);
      c.quadraticCurveTo(x + (random() - 0.5) * 16, (h + top) / 2, x, top);
      c.stroke();
      const r = 6 + random() * 4;
      for (let p = 0; p < 7; p++) {
        const a = (p / 7) * Math.PI * 2;
        c.fillStyle = "#ffffff";
        c.beginPath();
        c.ellipse(
          x + Math.cos(a) * r * 0.75,
          top + Math.sin(a) * r * 0.6,
          r * 0.6,
          r * 0.32,
          a,
          0,
          7,
        );
        c.fill();
      }
      c.fillStyle = "#f2c94c";
      c.beginPath();
      c.arc(x, top, r * 0.32, 0, 7);
      c.fill();
    }
  });
}

function reedTexture() {
  return canvasTexture(128, 256, (c, w, h) => {
    const random = rng(83);
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const x = 4 + random() * 120,
        top = 10 + random() * 70,
        lean = (random() - 0.5) * 22;
      c.strokeStyle = ["#8f8456", "#a59a68", "#b7a676", "#7d7a52"][i % 4];
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(x, h);
      c.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top);
      c.stroke();
      // Feathery plume.
      for (let k = 0; k < 26; k++) {
        const t = random(),
          px = x + lean + (random() - 0.5) * 9,
          py = top + t * 34;
        c.fillStyle = `rgba(${190 + random() * 30},${160 + random() * 25},${112 + random() * 25},0.8)`;
        c.beginPath();
        c.ellipse(px, py, 1.1, 2.6, (random() - 0.5) * 0.8 + lean * 0.02, 0, 7);
        c.fill();
      }
    }
  });
}

function crossedCards(width: number, height: number, cards: number) {
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    wind: number[] = [];
  for (let k = 0; k < cards; k++) {
    const a = (k / cards) * Math.PI,
      dx = Math.cos(a) * width * 0.5,
      dz = Math.sin(a) * width * 0.5;
    const quad = [
      [-dx, 0, -dz, 0, 0],
      [dx, 0, dz, 1, 0],
      [dx, height, dz, 1, 1],
      [-dx, 0, -dz, 0, 0],
      [dx, height, dz, 1, 1],
      [-dx, height, -dz, 0, 1],
    ];
    for (const [x, y, z, u, v] of quad) {
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      uv.push(u, v);
      wind.push(v * 0.7);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aWind", new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

/** Patches of wildflowers in open grass and golden reed beds on wetlands. */
export function scatterMeadow(
  field: HeightField,
  masks: GroundMasks,
  quality: QualitySettings,
  reedBeds: boolean,
) {
  const group = new THREE.Group(),
    random = rng(2024),
    e = field.data.terrain.extent;
  const patch = (x: number, z: number) =>
    Math.sin(x * 0.045 + Math.sin(z * 0.03) * 2.1) *
    Math.sin(z * 0.052 + Math.sin(x * 0.037) * 1.7);
  const free = (x: number, z: number) =>
    masks.sample("road", x, z) < 0.05 &&
    masks.sample("building", x, z) < 0.02 &&
    masks.sample("water", x, z) < 0.05;
  const make = (
    geometry: THREE.BufferGeometry,
    map: THREE.Texture,
    items: { x: number; z: number; s: number; color: THREE.Color }[],
  ) => {
    if (!items.length) return;
    const material = windify(
      new THREE.MeshStandardMaterial({
        map,
        alphaTest: 0.45,
        side: THREE.DoubleSide,
        roughness: 0.85,
        alphaToCoverage: true,
      }),
      true,
      true,
    );
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromAxisAngle(UP, random() * Math.PI);
      m.compose(
        V(it.x, field.groundAt(it.x, it.z) - 0.03, it.z),
        q,
        V(it.s, it.s * (0.85 + random() * 0.3), it.s),
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  };
  const palette = [
    "#ffffff",
    "#f6e27a",
    "#c9a7e8",
    "#f4b8c8",
    "#ffffff",
    "#9fc2f0",
  ].map((c) => new THREE.Color(c));
  const flowers: { x: number; z: number; s: number; color: THREE.Color }[] = [];
  const limit = quality.level === "high" ? 7000 : 1800;
  for (let i = 0; i < limit * 6 && flowers.length < limit; i++) {
    const x = (random() * 2 - 1) * Math.min(e - 5, 360),
      z = (random() * 2 - 1) * Math.min(e - 5, 360);
    const open =
      1 -
      masks.sample("court", x, z) -
      masks.sample("forest", x, z) * 0.8 -
      masks.sample("field", x, z) -
      masks.sample("beach", x, z) -
      masks.sample("wet", x, z);
    if (open < 0.5 || patch(x, z) < 0.35 || !free(x, z)) continue;
    const color =
      palette[
        Math.floor((patch(x * 0.3, z * 0.3) * 0.5 + 0.5) * palette.length) %
          palette.length
      ];
    flowers.push({ x, z, s: 0.7 + random() * 0.5, color });
  }
  make(crossedCards(0.55, 0.5, 2), flowerTexture(), flowers);
  if (reedBeds) {
    const reeds: typeof flowers = [];
    const max = quality.level === "high" ? 26000 : 6000;
    for (let i = 0; i < max * 10 && reeds.length < max; i++) {
      const x = (random() * 2 - 1) * Math.min(e - 10, 620),
        z = (random() * 2 - 1) * Math.min(e - 10, 620);
      const wet = masks.sample("wet", x, z);
      if (wet < 0.4 || random() > wet) continue;
      if (
        masks.sample("road", x, z) > 0.05 ||
        masks.sample("building", x, z) > 0.02
      )
        continue;
      if (field.groundAt(x, z) < field.seaLevel + 0.1) continue;
      reeds.push({
        x,
        z,
        s: 0.85 + random() * 0.45,
        color: new THREE.Color(1, 1, 1),
      });
    }
    make(crossedCards(1.1, 2.1, 3), reedTexture(), reeds);
  }
  return group;
}
