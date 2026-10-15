import * as THREE from "three";
import { pointInPolygon, roadWidth, segmentDistance } from "./geo";
import type { GeoPolygon, GeoSceneData, Point2 } from "./geo";
import type { PlaceStyle } from "./placeStyles";
import type { QualitySettings } from "./quality";
import type { SurfaceLibrary } from "./textures";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  return (
    p1 +
    0.5 *
      t *
      (p2 -
        p0 +
        t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}
/** Catmull-Rom sampling of a square height grid centred on the origin. */
export function sampleSmooth(
  heights: ArrayLike<number>,
  size: number,
  extent: number,
  x: number,
  z: number,
) {
  const u = clamp(((x / extent + 1) / 2) * (size - 1), 0, size - 1),
    v = clamp(((z / extent + 1) / 2) * (size - 1), 0, size - 1);
  const i = Math.floor(u),
    j = Math.floor(v),
    fx = u - i,
    fy = v - j;
  const h = (a: number, b: number) =>
    heights[clamp(b, 0, size - 1) * size + clamp(a, 0, size - 1)];
  const row = (k: number) =>
    cubic(h(i - 1, j + k), h(i, j + k), h(i + 1, j + k), h(i + 2, j + k), fx);
  return cubic(row(-1), row(0), row(1), row(2), fy);
}

type Bridge = {
  a: Point2;
  b: Point2;
  half: number;
  ya: number;
  yb: number;
  box: [number, number, number, number];
};

/**
 * The single source of truth for ground height. Rendered terrain, roads,
 * feet, grass and buildings all read this field, so nothing floats or sinks.
 */
export class HeightField {
  readonly n: number;
  readonly step: number;
  readonly heights: Float32Array;
  readonly bridges: Bridge[] = [];
  readonly waterLevels: { polygon: GeoPolygon; level: number }[] = [];
  readonly seaLevel: number;
  readonly lowest: number;
  /** Reed beds and marshes stay as mud flats instead of open water. */
  readonly wetlands: GeoPolygon[];
  /** Valley floor that the art-directed relief pivots around. */
  readonly pivot: number;
  constructor(
    readonly data: GeoSceneData,
    readonly base: number,
    segments: number,
    coast: boolean,
    /** Vertical exaggeration beyond the walkable area (1 = surveyed). */
    readonly relief = 1,
  ) {
    const t = data.terrain;
    this.n = segments + 1;
    this.step = (t.extent * 2) / segments;
    this.seaLevel = -base;
    this.heights = new Float32Array(this.n * this.n);
    this.wetlands = data.cover.filter((p) =>
      ["wetland", "marsh", "reedbed", "mud"].includes(p.class || ""),
    );
    const marsh = (x: number, z: number) =>
      this.wetlands.some((p) => pointInPolygon(x, z, p));
    const raw = [...t.heights].sort((a, b) => a - b);
    this.pivot = Math.max(
      this.seaLevel,
      raw[Math.floor(raw.length * 0.1)] - base,
    );
    const lift = (h: number, x: number, z: number) =>
      this.exaggerate(h, Math.max(Math.abs(x), Math.abs(z)));
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const x = -t.extent + i * this.step,
          z = -t.extent + j * this.step;
        let h = lift(
          sampleSmooth(t.heights, t.size, t.extent, x, z) - base,
          x,
          z,
        );
        if (coast && h <= this.seaLevel + 0.3)
          h = marsh(x, z) ? this.seaLevel + 0.35 : this.seaLevel - 2.5;
        this.heights[j * this.n + i] = h;
      }
    // Water surfaces sit at a shoreline level; carve the coarse DEM below it.
    for (const polygon of data.water) {
      const samples = polygon.rings[0]
        .filter(([x, z]) => Math.abs(x) < t.extent && Math.abs(z) < t.extent)
        .map(([x, z]) =>
          lift(sampleSmooth(t.heights, t.size, t.extent, x, z) - base, x, z),
        )
        .sort((a, b) => a - b);
      const level = coast
        ? this.seaLevel
        : (samples[Math.floor(samples.length * 0.2)] ?? 0);
      this.waterLevels.push({ polygon, level });
      const ring = polygon.rings[0];
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      const i0 = Math.max(
          0,
          Math.floor((Math.min(...xs) + t.extent) / this.step),
        ),
        i1 = Math.min(
          this.n - 1,
          Math.ceil((Math.max(...xs) + t.extent) / this.step),
        ),
        j0 = Math.max(0, Math.floor((Math.min(...zs) + t.extent) / this.step)),
        j1 = Math.min(
          this.n - 1,
          Math.ceil((Math.max(...zs) + t.extent) / this.step),
        );
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = -t.extent + i * this.step,
            z = -t.extent + j * this.step;
          if (!pointInPolygon(x, z, polygon) || marsh(x, z)) continue;
          const k = j * this.n + i;
          this.heights[k] = Math.min(this.heights[k], level - 1.6);
        }
    }
    for (const road of data.roads) {
      if (!road.bridge || road.points.length < 2) continue;
      const first = road.points[0],
        last = road.points[road.points.length - 1];
      const ends = [first, last].map(([x, z]) =>
        lift(sampleSmooth(t.heights, t.size, t.extent, x, z) - base, x, z),
      );
      let total = 0;
      const lengths = road.points.map((p, i) =>
        i
          ? (total += Math.hypot(
              p[0] - road.points[i - 1][0],
              p[1] - road.points[i - 1][1],
            ))
          : 0,
      );
      // Walk the deck to find the rivers it spans (ends usually sit on land).
      const along: Point2[] = [];
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i],
          steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
        for (let k = 0; k <= steps; k++)
          along.push([
            ax + ((bx - ax) * k) / steps,
            az + ((bz - az) * k) / steps,
          ]);
      }
      const water = Math.max(
        -Infinity,
        ...this.waterLevels
          .filter((w) =>
            along.some(([x, z]) => pointInPolygon(x, z, w.polygon)),
          )
          .map((w) => w.level + 1.4),
      );
      const deck = (d: number) =>
        Math.max(
          ends[0] + ((ends[1] - ends[0]) * d) / (total || 1) + 0.25,
          water,
        );
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i],
          half = roadWidth(road) / 2 + 0.6;
        this.bridges.push({
          a,
          b,
          half,
          ya: deck(lengths[i - 1]),
          yb: deck(lengths[i]),
          box: [
            Math.min(a[0], b[0]) - half,
            Math.max(a[0], b[0]) + half,
            Math.min(a[1], b[1]) - half,
            Math.max(a[1], b[1]) + half,
          ],
        });
      }
    }
    let lowest = Infinity;
    for (const h of this.heights) lowest = Math.min(lowest, h);
    this.lowest = lowest;
  }
  /**
   * Art-directed relief: unchanged where people walk, rising smoothly to
   * `relief`× around the valley floor at the edge and beyond, so distant
   * ridges tower like a painted landscape.
   */
  exaggerate(h: number, distance: number) {
    if (this.relief === 1 || h <= this.pivot) return h;
    const t = clamp((distance - 500) / 380, 0, 1),
      f = 1 + (this.relief - 1) * t * t * (3 - 2 * t);
    return this.pivot + (h - this.pivot) * f;
  }
  /** Sinks a smoothed DEM blob (e.g. a river islet) below a water level. */
  submerge(x: number, z: number, radius: number, level: number) {
    const e = this.data.terrain.extent;
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const d = Math.hypot(-e + i * this.step - x, -e + j * this.step - z);
        if (d > radius) continue;
        const k = j * this.n + i,
          t = Math.min(1, (radius - d) / (radius * 0.4));
        this.heights[k] = Math.min(
          this.heights[k],
          this.heights[k] * (1 - t) + (level - 2) * t,
        );
      }
  }
  /** Height of the rendered terrain surface (triangulated like the mesh). */
  groundAt(x: number, z: number) {
    const e = this.data.terrain.extent,
      u = clamp((x + e) / this.step, 0, this.n - 1),
      v = clamp((z + e) / this.step, 0, this.n - 1);
    const i = Math.min(Math.floor(u), this.n - 2),
      j = Math.min(Math.floor(v), this.n - 2),
      fx = u - i,
      fy = v - j,
      n = this.n,
      h = this.heights;
    const h00 = h[j * n + i],
      h10 = h[j * n + i + 1],
      h01 = h[(j + 1) * n + i],
      h11 = h[(j + 1) * n + i + 1];
    return fx + fy <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fy
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
  }
  bridgeAt(x: number, z: number) {
    for (const b of this.bridges) {
      if (x < b.box[0] || x > b.box[1] || z < b.box[2] || z > b.box[3])
        continue;
      const s = segmentDistance(x, z, b.a, b.b);
      if (s.distance <= b.half) return b.ya + (b.yb - b.ya) * s.t;
    }
    return null;
  }
  heightAt = (x: number, z: number) =>
    this.bridgeAt(x, z) ?? this.groundAt(x, z);
  normalAt(x: number, z: number, target = new THREE.Vector3()) {
    const d = this.step;
    return target
      .set(
        this.groundAt(x - d, z) - this.groundAt(x + d, z),
        2 * d,
        this.groundAt(x, z - d) - this.groundAt(x, z + d),
      )
      .normalize();
  }
}

export type MaskName =
  | "forest"
  | "grass"
  | "beach"
  | "court"
  | "field"
  | "rock"
  | "wet"
  | "road"
  | "building"
  | "water";

/** Land-cover rasters (1.76 m per pixel) used for splatting and scattering. */
export class GroundMasks {
  readonly size = 1024;
  readonly layers = {} as Record<MaskName, Uint8Array>;
  constructor(
    readonly data: GeoSceneData,
    style: PlaceStyle,
    field: HeightField,
  ) {
    const e = data.terrain.extent,
      s = this.size,
      k = s / (e * 2);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = s;
    const c = canvas.getContext("2d", { willReadFrequently: true })!;
    const path = (polygons: GeoPolygon[]) => {
      const p = new Path2D();
      for (const polygon of polygons)
        for (const ring of polygon.rings) {
          ring.forEach(([x, z], i) =>
            i
              ? p.lineTo((x + e) * k, (z + e) * k)
              : p.moveTo((x + e) * k, (z + e) * k),
          );
          p.closePath();
        }
      return p;
    };
    const raster = (name: MaskName, draw: () => void, blur = 0) => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, s, s);
      c.fillStyle = c.strokeStyle = "#fff";
      draw();
      const pixels = c.getImageData(0, 0, s, s).data,
        out = new Uint8Array(s * s);
      for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4 + 3];
      this.layers[name] = blur ? boxBlur(out, s, blur) : out;
    };
    const cover = (classes: string[]) =>
      data.cover.filter((p) => classes.includes(p.class || ""));
    raster(
      "forest",
      () =>
        c.fill(path(cover(["wood", "forest", "nature_reserve"])), "evenodd"),
      3,
    );
    raster(
      "grass",
      () =>
        c.fill(
          path(
            cover([
              "grass",
              "park",
              "grassland",
              "meadow",
              "pitch",
              "national_park",
            ]),
          ),
          "evenodd",
        ),
      2,
    );
    raster(
      "beach",
      () =>
        style.sandIsBeach && c.fill(path(cover(["sand", "beach"])), "evenodd"),
      3,
    );
    raster(
      "court",
      () => {
        c.fill(
          path(
            cover([
              "residential",
              "commercial",
              "retail",
              "school",
              "library",
              "hospital",
              "military",
              "historic",
            ]),
          ),
          "evenodd",
        );
        if (!style.sandIsBeach) c.fill(path(cover(["sand"])), "evenodd");
        if (style.courtBuffer) {
          // Swept gravel yards and lanes between traditional buildings.
          c.lineJoin = "round";
          c.lineWidth = style.courtBuffer * 2 * k;
          const yards = path(data.buildings);
          c.stroke(yards);
          c.fill(yards, "evenodd");
        }
      },
      2,
    );
    raster(
      "field",
      () =>
        c.fill(
          path(cover(["farmland", "farm", "orchard", "vineyard"])),
          "evenodd",
        ),
      2,
    );
    raster(
      "rock",
      () =>
        c.fill(path(cover(["rock", "bare_rock", "scree", "cliff"])), "evenodd"),
      3,
    );
    raster(
      "wet",
      () => c.fill(path(cover(["wetland", "marsh", "mud"])), "evenodd"),
      3,
    );
    raster("water", () => c.fill(path(data.water), "evenodd"), 0);
    raster("building", () => c.fill(path(data.buildings), "evenodd"), 0);
    raster("road", () => {
      c.lineCap = c.lineJoin = "round";
      for (const road of data.roads) {
        c.lineWidth = (roadWidth(road) + 1.2) * k;
        c.beginPath();
        road.points.forEach(([x, z], i) =>
          i
            ? c.lineTo((x + e) * k, (z + e) * k)
            : c.moveTo((x + e) * k, (z + e) * k),
        );
        c.stroke();
      }
    });
    // Korean hills are wooded; infer forest on slopes where land cover is silent.
    if (style.inferForest) {
      const forest = this.layers.forest,
        n = new THREE.Vector3();
      for (let y = 0; y < s; y += 1)
        for (let x = 0; x < s; x += 1) {
          const i = y * s + x;
          const wx = (x + 0.5) / k - e,
            wz = (y + 0.5) / k - e;
          const blocked =
            this.layers.court[i] +
            this.layers.field[i] +
            this.layers.water[i] +
            this.layers.road[i] +
            this.layers.building[i] +
            this.layers.beach[i];
          if (blocked > 40) continue;
          field.normalAt(wx, wz, n);
          const slope = 1 - n.y;
          const rise = field.groundAt(wx, wz) - field.lowest;
          const v =
            clamp((slope - 0.006) * 34, 0, 1) * clamp((rise - 4) / 18, 0, 1);
          forest[i] = Math.max(forest[i], Math.round(v * 255));
        }
      this.layers.forest = boxBlur(forest, s, 2);
    }
  }
  /** Bilinear sample in 0..1. */
  sample(name: MaskName, x: number, z: number) {
    const e = this.data.terrain.extent,
      s = this.size,
      u = clamp(((x + e) / (2 * e)) * s - 0.5, 0, s - 1.001),
      v = clamp(((z + e) / (2 * e)) * s - 0.5, 0, s - 1.001),
      i = Math.floor(u),
      j = Math.floor(v),
      fx = u - i,
      fy = v - j,
      m = this.layers[name];
    return (
      (m[j * s + i] * (1 - fx) * (1 - fy) +
        m[j * s + i + 1] * fx * (1 - fy) +
        m[(j + 1) * s + i] * (1 - fx) * fy +
        m[(j + 1) * s + i + 1] * fx * fy) /
      255
    );
  }
  /** A density texture for GPU grass: 0 on roads, buildings, water and sand. */
  grassTexture(field: HeightField) {
    const s = this.size,
      data = new Uint8Array(s * s),
      e = this.data.terrain.extent,
      n = new THREE.Vector3();
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const wx = ((x + 0.5) / s) * 2 * e - e,
          wz = ((y + 0.5) / s) * 2 * e - e;
        const L = this.layers;
        let v = 0.95 - L.court[i] / 210 - L.field[i] / 600 - L.rock[i] / 300;
        v -=
          (L.beach[i] + L.water[i] * 2 + L.road[i] * 2 + L.building[i] * 2) /
          255;
        v += L.grass[i] / 600 - L.forest[i] / 380 - L.wet[i] / 170;
        field.normalAt(wx, wz, n);
        v -= clamp((0.82 - n.y) * 6, 0, 1);
        data[i] = Math.round(clamp(v, 0, 1) * 255);
      }
    const texture = new THREE.DataTexture(
      boxBlur(data, s, 1),
      s,
      s,
      THREE.RedFormat,
    );
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }
}

function boxBlur(src: Uint8Array, s: number, r: number) {
  const tmp = new Float32Array(s * s),
    out = new Uint8Array(s * s),
    w = r * 2 + 1;
  for (let y = 0; y < s; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * s + clamp(x, 0, s - 1)];
    for (let x = 0; x < s; x++) {
      tmp[y * s + x] = acc / w;
      acc +=
        src[y * s + clamp(x + r + 1, 0, s - 1)] -
        src[y * s + clamp(x - r, 0, s - 1)];
    }
  }
  for (let x = 0; x < s; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, s - 1) * s + x];
    for (let y = 0; y < s; y++) {
      out[y * s + x] = Math.round(acc / w);
      acc +=
        tmp[clamp(y + r + 1, 0, s - 1) * s + x] -
        tmp[clamp(y - r, 0, s - 1) * s + x];
    }
  }
  return out;
}

/** GLSL value noise shared by terrain, grass and foliage shaders. */
export const noiseGLSL = /* glsl */ `
float vhash(vec2 p) { p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vfbm(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.1 + 5.3) * 0.3 + vnoise(p * 4.3 + 1.7) * 0.2; }
`;

function terrainMaterial(
  surfaces: SurfaceLibrary,
  style: PlaceStyle,
  hq: boolean,
) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const uniforms = {
    uLayers: { value: surfaces.terrainColor },
    uNormals: { value: surfaces.terrainNormal },
    uTint: { value: new THREE.Color(style.grassTint) },
    // Distant canopy takes on autumn reds and blossom pinks in drifts.
    uSeason: {
      value: new THREE.Vector3(
        style.trees.maple ?? 0,
        style.trees.blossom ?? 0,
        style.trees.ginkgo ?? 0,
      ),
    },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (hq) shader.defines = { ...shader.defines, TERRAIN_HQ: "" };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec4 aSplat;
attribute vec4 aSplat2;
varying vec4 vSplat;
varying vec4 vSplat2;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vSplat = aSplat;
vSplat2 = aSplat2;
vTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vTerrainNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform highp sampler2DArray uLayers;
uniform highp sampler2DArray uNormals;
uniform vec3 uTint;
uniform vec3 uSeason;
varying vec4 vSplat;
varying vec4 vSplat2;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
${noiseGLSL}
const float TILE[6] = float[6](3.2, 3.6, 6.0, 3.2, 3.0, 2.1);
const float ROUGH[6] = float[6](0.92, 0.95, 0.82, 0.9, 0.96, 0.9);
vec4 sampleLayer(int i, vec2 p) {
  vec2 uv = p / TILE[i];
  vec4 a = texture(uLayers, vec3(uv, float(i)));
  #ifdef TERRAIN_HQ
    vec4 b = texture(uLayers, vec3(uv * 0.29 + vec2(0.37, 0.71), float(i)));
    a = mix(a, b, 0.42);
  #endif
  return a;
}`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 wp = vec2(vTerrainPos.x, -vTerrainPos.z);
vec3 tn = normalize(vTerrainNormal);
float macro = vfbm(wp * 0.011);
float detail = vfbm(wp * 0.09);
float w[6];
w[1] = vSplat.x;
w[3] = vSplat.y;
w[4] = vSplat.z;
w[5] = vSplat.w;
w[2] = max(vSplat2.x, smoothstep(0.8, 0.6, tn.y));
for (int i = 1; i < 6; i++) w[i] = clamp(w[i] * (0.65 + detail * 0.7), 0.0, 1.0);
w[0] = max(0.0, 1.0 - (w[1] + w[2] + w[3] + w[4] + w[5]));
vec3 albedo = vec3(0.0);
vec3 nts = vec3(0.0);
float rough = 0.0, total = 0.0;
for (int i = 0; i < 6; i++) {
  if (w[i] < 0.02) continue;
  vec4 c = sampleLayer(i, wp);
  // Height-aware blending keeps edges organic rather than smeared.
  float wi = w[i] * pow(dot(c.rgb, vec3(0.33)) + 0.55, 3.0);
  // Leaf litter reads as muted needles and moss rather than bare red soil.
  if (i == 4) c.rgb = mix(vec3(dot(c.rgb, vec3(0.33))), c.rgb, 0.55) * vec3(0.92, 0.95, 0.82);
  albedo += c.rgb * wi;
  nts += (texture(uNormals, vec3(wp / TILE[i], float(i))).xyz * 2.0 - 1.0) * wi;
  rough += ROUGH[i] * wi;
  total += wi;
}
albedo /= max(total, 1e-4);
nts /= max(total, 1e-4);
float grassy = w[0] / max(total, 1e-4) * total;
// Large patches of sun-bleached and lush grass, like painted landscape.
albedo *= mix(vec3(1.0), mix(vec3(1.12, 1.06, 0.82), vec3(0.82, 0.95, 0.86), macro), clamp(w[0] * 1.4, 0.0, 1.0) * 0.55);
albedo *= mix(vec3(1.0), uTint, w[0]);
albedo *= 0.9 + vSplat2.y * -0.25 + detail * 0.2;
// Past the detailed trees, forested ground reads as a continuous canopy.
float canopyFar = smoothstep(140.0, 420.0, distance(vTerrainPos, cameraPosition));
vec3 canopy = mix(vec3(0.045, 0.085, 0.05), vec3(0.085, 0.13, 0.06), macro) * (0.75 + detail * 0.5);
float openGround = clamp((vSplat.x + vSplat.y + vSplat.w + vSplat2.x) * 2.0, 0.0, 1.0);
float canopyW = clamp(vSplat.z * 1.6 + (1.0 - openGround) * 0.6, 0.0, 1.0);
float patchA = smoothstep(0.55, 0.8, vfbm(wp * 0.006 + 3.7)),
  patchB = smoothstep(0.6, 0.82, vfbm(wp * 0.007 - 5.1)),
  patchC = smoothstep(0.58, 0.8, vfbm(wp * 0.0065 + 9.3));
canopy = mix(canopy, vec3(0.38, 0.06, 0.02) * (0.7 + detail * 0.6), patchA * min(1.0, uSeason.x * 2.4));
canopy = mix(canopy, vec3(0.62, 0.32, 0.38) * (0.75 + detail * 0.5), patchB * min(1.0, uSeason.y * 2.4));
canopy = mix(canopy, vec3(0.55, 0.36, 0.04) * (0.75 + detail * 0.5), patchC * min(1.0, uSeason.z * 2.4));
albedo = mix(albedo, canopy, canopyW * canopyFar);
diffuseColor.rgb *= albedo;
float terrainRough = rough / max(total, 1e-4);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = terrainRough;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `vec3 terrainN = normalize(tn + vec3(nts.x, 0.0, -nts.y) * 0.9);
normal = normalize((viewMatrix * vec4(terrainN, 0.0)).xyz);`,
      );
  };
  material.customProgramCacheKey = () => `terrain-${hq}`;
  return material;
}

export function buildNearTerrain(
  field: HeightField,
  masks: GroundMasks,
  style: PlaceStyle,
  surfaces: SurfaceLibrary,
  quality: QualitySettings,
) {
  const n = field.n,
    e = field.data.terrain.extent,
    s = field.step;
  const count = n * n + n * 4;
  const position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    splat = new Float32Array(count * 4),
    splat2 = new Float32Array(count * 4),
    v = new THREE.Vector3();
  const set = (k: number, x: number, y: number, z: number) => {
    position.set([x, y, z], k * 3);
    field.normalAt(x, z, v);
    normal.set([v.x, v.y, v.z], k * 3);
    const forest = masks.sample("forest", x, z),
      court = masks.sample("court", x, z),
      fieldMask = masks.sample("field", x, z),
      wet = masks.sample("wet", x, z),
      water = masks.sample("water", x, z),
      beach = masks.sample("beach", x, z);
    const shore = clamp(water * 2.2, 0, 1) * (1 - water);
    splat.set(
      [
        clamp(fieldMask * 0.55 + wet * 0.4 + shore * 0.6, 0, 1),
        clamp(
          beach * 0.95 + (style.sandIsBeach ? shore * 0.8 : court * 0.5),
          0,
          1,
        ),
        clamp(forest * 0.78, 0, 1),
        clamp(court * (style.sandIsBeach ? 0.85 : 0.45), 0, 1),
      ],
      k * 4,
    );
    splat2.set([masks.sample("rock", x, z), wet, 0, 0], k * 4);
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -e + i * s,
        z = -e + j * s;
      set(j * n + i, x, field.heights[j * n + i], z);
    }
  // Skirt vertices hide hairline cracks against the coarse far terrain.
  const edge: number[] = [];
  for (let i = 0; i < n; i++) edge.push(i);
  for (let j = 1; j < n; j++) edge.push(j * n + n - 1);
  for (let i = n - 2; i >= 0; i--) edge.push((n - 1) * n + i);
  for (let j = n - 2; j > 0; j--) edge.push(j * n);
  edge.forEach((k, idx) => {
    const x = position[k * 3],
      z = position[k * 3 + 2];
    set(n * n + idx, x, position[k * 3 + 1] - 40, z);
  });
  const index: number[] = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i,
        b = (j + 1) * n + i,
        c = (j + 1) * n + i + 1,
        d = j * n + i + 1;
      index.push(a, b, d, b, c, d);
    }
  for (let idx = 0; idx < edge.length; idx++) {
    const a = edge[idx],
      b = edge[(idx + 1) % edge.length],
      a2 = n * n + idx,
      b2 = n * n + ((idx + 1) % edge.length);
    index.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute("aSplat2", new THREE.BufferAttribute(splat2, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(
    geometry,
    terrainMaterial(surfaces, style, quality.level === "high"),
  );
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

/** The real surrounding ridges and coasts (150 m spacing) out to ~14 km. */
export function buildFarTerrain(field: HeightField) {
  const far = field.data.far;
  if (!far) return null;
  const { size, extent, heights } = far,
    step = (extent * 2) / (size - 1),
    near = field.data.terrain.extent;
  const position: number[] = [],
    color: number[] = [],
    index: number[] = [];
  const h = (i: number, j: number) => {
    const x = -extent + clamp(i, 0, size - 1) * step,
      z = -extent + clamp(j, 0, size - 1) * step;
    return field.exaggerate(
      heights[clamp(j, 0, size - 1) * size + clamp(i, 0, size - 1)] -
        field.base,
      Math.max(Math.abs(x), Math.abs(z)),
    );
  };
  let lowLand = Infinity;
  for (const v of heights) if (v > 0) lowLand = Math.min(lowLand, v);
  const c = new THREE.Color(),
    forest = new THREE.Color("#405c3c"),
    forestDark = new THREE.Color("#33493a"),
    paddy = new THREE.Color("#8e9f5c"),
    paddy2 = new THREE.Color("#a7a56c"),
    rock = new THREE.Color("#8b8a82"),
    sand = new THREE.Color("#c9b994"),
    town = new THREE.Color("#a49c8d");
  const noise = (x: number, z: number) =>
    (Math.sin(x * 0.0021 + Math.sin(z * 0.0017) * 2) +
      Math.sin(z * 0.0029 + Math.sin(x * 0.0013) * 2)) *
      0.25 +
    0.5;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = -extent + i * step,
        z = -extent + j * step;
      const onEdge = Math.abs(x) <= near + 1 && Math.abs(z) <= near + 1;
      const y = onEdge ? field.groundAt(x, z) : h(i, j);
      position.push(x, y, z);
      const slope =
        Math.hypot(h(i + 1, j) - h(i - 1, j), h(i, j + 1) - h(i, j - 1)) /
        (2 * step);
      const abs = y + field.base,
        rise = abs - lowLand,
        n = noise(x, z);
      if (abs <= 0.5) c.copy(sand);
      else if (slope < 0.035 && rise < 60)
        c.copy(n > 0.55 ? paddy2 : paddy).lerp(town, n > 0.72 ? 0.6 : 0);
      else c.copy(n > 0.5 ? forest : forestDark);
      if (slope > 0.55 || abs > 1450)
        c.lerp(rock, clamp((slope - 0.45) * 2, 0.2, 0.75));
      color.push(c.r, c.g, c.b);
    }
  const inner = (i: number) => {
    const x = -extent + i * step;
    return x > -near - 1 && x < near + 1;
  };
  for (let j = 0; j < size - 1; j++)
    for (let i = 0; i < size - 1; i++) {
      // Skip cells covered by the detailed local terrain.
      if (inner(i) && inner(i + 1) && inner(j) && inner(j + 1)) continue;
      const a = j * size + i,
        b = (j + 1) * size + i,
        cc = (j + 1) * size + i + 1,
        d = j * size + i + 1;
      index.push(a, b, d, b, cc, d);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(position, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  );
  mesh.receiveShadow = false;
  mesh.name = "far-terrain";
  return mesh;
}
