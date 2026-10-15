import * as THREE from "three";
import { pointInPolygon, roadWidth } from "./geo";
import type { GeoBuilding, GeoPolygon, GeoSceneData, Point2 } from "./geo";
import {
  Builder,
  buildHanokUnit,
  eaveHeight,
  hanokMaterials,
  roofSurface,
  unitHeight,
  upperBase,
  upperStorey,
} from "./hanok";
import type { HanokMaterials, HanokUnit, RoofType } from "./hanok";
import type { HanokRank, PlaceStyle } from "./placeStyles";
import { shared } from "./quality";
import type { QualitySettings } from "./quality";
import type { HeightField } from "./terrain";
import type { SurfaceLibrary } from "./textures";
import { canvasTexture, rng } from "./textures";

type Placed = { unit: HanokUnit; frame: THREE.Matrix4; x: number; z: number };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function areaOf(ring: Point2[]) {
  let a = 0;
  for (let i = 1; i < ring.length; i++)
    a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(a / 2);
}

function principalAngle(ring: Point2[]) {
  let longest = 0,
    angle = 0;
  for (let i = 1; i < ring.length; i++) {
    const [ax, az] = ring[i - 1],
      [bx, bz] = ring[i],
      l = Math.hypot(bx - ax, bz - az);
    if (l > longest) {
      longest = l;
      angle = Math.atan2(bz - az, bx - ax);
    }
  }
  return angle;
}

/**
 * Splits a footprint into overlapping rectangles (ㄱ, ㄷ, ㅁ plans and
 * cloisters) by repeatedly taking the maximal rectangle that covers the most
 * still-unclaimed area. Each rectangle gets its own roof, like real hanok.
 */
export function decompose(b: GeoPolygon, angle: number) {
  const ca = Math.cos(angle),
    sa = Math.sin(angle);
  const rings = b.rings.map((r) =>
    r.map(([x, z]) => [x * ca + z * sa, -x * sa + z * ca] as Point2),
  );
  const local: GeoPolygon = { rings };
  const xs = rings[0].map((p) => p[0]),
    zs = rings[0].map((p) => p[1]);
  const minX = Math.min(...xs),
    minZ = Math.min(...zs),
    w = Math.max(...xs) - minX,
    d = Math.max(...zs) - minZ;
  const cell = Math.max(0.45, Math.sqrt(w * d) / 42);
  const nx = Math.max(1, Math.round(w / cell)),
    nz = Math.max(1, Math.round(d / cell));
  const cw = w / nx,
    cd = d / nz;
  const filled = new Uint8Array(nx * nz),
    claimed = new Uint8Array(nx * nz);
  let total = 0;
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      if (pointInPolygon(minX + (i + 0.5) * cw, minZ + (j + 0.5) * cd, local)) {
        filled[j * nx + i] = 1;
        total++;
      }
  const rects: { cx: number; cz: number; w: number; d: number }[] = [];
  const heights = new Int32Array(nx),
    prefix = new Int32Array((nx + 1) * (nz + 1));
  const minSide = 2.4;
  while (rects.length < 6 && total) {
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++)
        prefix[(j + 1) * (nx + 1) + i + 1] =
          (filled[j * nx + i] && !claimed[j * nx + i] ? 1 : 0) +
          prefix[j * (nx + 1) + i + 1] +
          prefix[(j + 1) * (nx + 1) + i] -
          prefix[j * (nx + 1) + i];
    const open = (i0: number, j0: number, i1: number, j1: number) =>
      prefix[(j1 + 1) * (nx + 1) + i1 + 1] -
      prefix[j0 * (nx + 1) + i1 + 1] -
      prefix[(j1 + 1) * (nx + 1) + i0] +
      prefix[j0 * (nx + 1) + i0];
    heights.fill(0);
    let best: {
      i0: number;
      j0: number;
      i1: number;
      j1: number;
      score: number;
      area: number;
    } | null = null;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++)
        heights[i] = filled[j * nx + i] ? heights[i] + 1 : 0;
      for (let i = 0; i < nx; i++) {
        const h = heights[i];
        if (!h) continue;
        let l = i,
          r = i;
        while (l > 0 && heights[l - 1] >= h) l--;
        while (r < nx - 1 && heights[r + 1] >= h) r++;
        if ((r - l + 1) * cw < minSide || h * cd < minSide) continue;
        const score = open(l, j - h + 1, r, j),
          area = (r - l + 1) * h;
        if (
          !best ||
          score > best.score ||
          (score === best.score && area > best.area)
        )
          best = { i0: l, j0: j - h + 1, i1: r, j1: j, score, area };
      }
    }
    if (!best || best.score < Math.max(8, total * 0.1)) break;
    for (let j = best.j0; j <= best.j1; j++)
      for (let i = best.i0; i <= best.i1; i++) claimed[j * nx + i] = 1;
    const lx = minX + ((best.i0 + best.i1 + 1) / 2) * cw,
      lz = minZ + ((best.j0 + best.j1 + 1) / 2) * cd;
    rects.push({
      cx: lx * ca - lz * sa,
      cz: lx * sa + lz * ca,
      w: (best.i1 - best.i0 + 1) * cw,
      d: (best.j1 - best.j0 + 1) * cd,
    });
  }
  if (!rects.length) {
    const lx = minX + w / 2,
      lz = minZ + d / 2;
    rects.push({ cx: lx * ca - lz * sa, cz: lx * sa + lz * ca, w, d });
  }
  return rects;
}

function chooseRoof(
  rank: HanokRank,
  W: number,
  D: number,
  seed: number,
): RoofType {
  if (rank === "thatched") return "thatch";
  const aspect = W / D,
    area = W * D;
  if (aspect > 2.9 && !(rank === "palace" && area > 320)) return "matbae";
  if (aspect < 1.25 && area < 45 && rank !== "house") return "ujingak";
  if (rank === "house")
    return area > 42 || seed % 3 === 0 ? "paljak" : "matbae";
  return "paljak";
}

/* ----------------------------- modern blocks ----------------------------- */

function facadeMaps() {
  const random = rng(77);
  const map = canvasTexture(256, 256, (c) => {
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = "#e3e0da";
    c.fillRect(0, 226, 256, 30);
    for (const x of [24, 140]) {
      c.fillStyle = "#3d4a52";
      c.fillRect(x, 60, 92, 130);
      c.fillStyle = "#56656d";
      c.fillRect(x + 4, 64, 40, 122);
      c.fillStyle = "#cfcac0";
      c.fillRect(x + 44, 60, 4, 130);
      c.fillRect(x - 4, 190, 100, 8);
    }
  });
  const lit = canvasTexture(256, 256, (c) => {
    c.fillStyle = "#000";
    c.fillRect(0, 0, 256, 256);
    for (const x of [24, 140])
      if (random() < 0.6) {
        c.fillStyle = random() < 0.5 ? "#ffd59a" : "#fff0d0";
        c.fillRect(x, 60, 92, 130);
      }
  });
  return { map, lit };
}

function modernMaterial(color: string, maps: ReturnType<typeof facadeMaps>) {
  const m = new THREE.MeshStandardMaterial({
    color,
    map: maps.map,
    emissiveMap: maps.lit,
    emissive: "#ffcf8a",
    roughness: 0.82,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.night;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * 1.6;",
      );
  };
  m.customProgramCacheKey = () => "modern-facade";
  return m;
}

function modernBlock(
  b: Builder,
  building: GeoBuilding,
  wall: THREE.Material,
  roofMat: THREE.Material,
  metal: THREE.Material | null,
  y0: number,
  h: number,
) {
  const outer = building.rings[0];
  // Walls, with facade UVs in floors (3.1 m) and window bays (4 m).
  for (const ring of building.rings) {
    let along = 0;
    for (let i = 1; i < ring.length; i++) {
      const [ax, az] = ring[i - 1],
        [bx, bz] = ring[i],
        l = Math.hypot(bx - ax, bz - az);
      if (l < 0.05) continue;
      const u0 = along / 4,
        u1 = (along += l) / 4;
      b.quad(
        wall,
        new THREE.Vector3(ax, y0, az),
        new THREE.Vector3(bx, y0, bz),
        new THREE.Vector3(bx, y0 + h, bz),
        new THREE.Vector3(ax, y0 + h, az),
        [
          [u0, 0],
          [u1, 0],
          [u1, h / 3.1],
          [u0, h / 3.1],
        ],
      );
    }
  }
  if (metal) {
    // Small rural houses: a shallow gable in coloured sheet metal.
    const angle = principalAngle(outer),
      ca = Math.cos(angle),
      sa = Math.sin(angle);
    const loc = outer.map(([x, z]) => [x * ca + z * sa, -x * sa + z * ca]);
    const lx = loc.map((p) => p[0]),
      lz = loc.map((p) => p[1]);
    const x0 = Math.min(...lx) - 0.5,
      x1 = Math.max(...lx) + 0.5,
      z0 = Math.min(...lz) - 0.6,
      z1 = Math.max(...lz) + 0.6,
      zm = (z0 + z1) / 2,
      rise = (z1 - z0) * 0.22;
    const W = (x: number, y: number, z: number) =>
      new THREE.Vector3(x * ca - z * sa, y, x * sa + z * ca);
    const top = y0 + h;
    b.quad(
      metal,
      W(x0, top - 0.25, z1),
      W(x1, top - 0.25, z1),
      W(x1, top + rise, zm),
      W(x0, top + rise, zm),
      [
        [0, 0],
        [x1 - x0, 0],
        [x1 - x0, 3],
        [0, 3],
      ],
    );
    b.quad(
      metal,
      W(x1, top - 0.25, z0),
      W(x0, top - 0.25, z0),
      W(x0, top + rise, zm),
      W(x1, top + rise, zm),
      [
        [0, 0],
        [x1 - x0, 0],
        [x1 - x0, 3],
        [0, 3],
      ],
    );
    for (const x of [x0 + 0.5, x1 - 0.5])
      b.tri(
        wall,
        W(x, top, z0 + 0.6),
        W(x, top, z1 - 0.6),
        W(x, top + rise * 0.9, zm),
        [0, 0],
        [1, 0],
        [0.5, 0.4],
      );
    return top + rise;
  }
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z)));
  const holes = building.rings
    .slice(1)
    .map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
  const pts = [...shape.getPoints(), ...holes.flat()];
  for (const [a, c, d] of THREE.ShapeUtils.triangulateShape(
    shape.getPoints(),
    holes,
  )) {
    const P = (k: number) => new THREE.Vector3(pts[k].x, y0 + h, pts[k].y);
    const A = P(a),
      B = P(c),
      C = P(d);
    const n = B.clone().sub(A).cross(C.clone().sub(A));
    if (n.y < 0)
      b.tri(
        roofMat,
        A,
        C,
        B,
        [A.x / 4, A.z / 4],
        [C.x / 4, C.z / 4],
        [B.x / 4, B.z / 4],
      );
    else
      b.tri(
        roofMat,
        A,
        B,
        C,
        [A.x / 4, A.z / 4],
        [B.x / 4, B.z / 4],
        [C.x / 4, C.z / 4],
      );
  }
  return y0 + h;
}

/* ------------------------------- townscape ------------------------------- */

type Surface = (x: number, z: number) => number | null;
const _local = new THREE.Vector3();
/** World-space roof height of a placed unit, or null outside its eaves. */
function placedRoof(unit: HanokUnit, frame: THREE.Matrix4): Surface {
  const inverse = frame.clone().invert(),
    roof = roofSurface(unit),
    base = frame.elements[13];
  return (x, z) => {
    _local.set(x, 0, z).applyMatrix4(inverse);
    const h = roof(_local.x, _local.z);
    return h === null ? null : base + h;
  };
}

export class Townscape {
  readonly group = new THREE.Group();
  /** Streamed close-up carpentry (skipped in the water mirror). */
  readonly detailGroup = new THREE.Group();
  readonly tops = new Map<GeoBuilding, number>();
  /** Walkable tops: a flat height, or roof surfaces plus an eave fallback. */
  readonly surfaces = new Map<
    GeoBuilding,
    number | { roofs: Surface[]; eave: number }
  >();
  readonly hanokCount: number;
  private detail = new Map<string, THREE.Group>();
  private cells = new Map<string, { x: number; z: number; units: Placed[] }>();
  private materials: HanokMaterials;
  constructor(
    data: GeoSceneData,
    field: HeightField,
    style: PlaceStyle,
    surfaces: SurfaceLibrary,
    private quality: QualitySettings,
  ) {
    this.materials = hanokMaterials(surfaces);
    const M = this.materials,
      maps = facadeMaps();
    // One builder per 150 m cell keeps frustum and shadow culling effective.
    const shells = new Map<string, Builder>();
    const shellAt = (x: number, z: number) => {
      const key = `${Math.floor(x / 150)},${Math.floor(z / 150)}`;
      let b = shells.get(key);
      if (!b) shells.set(key, (b = new Builder()));
      return b;
    };
    const walls = [
      "#f1ede4",
      "#e6dccb",
      "#d9d6cf",
      "#e8d6c0",
      "#c9b9a6",
      "#efe6d6",
    ].map((c) => modernMaterial(c, maps));
    const roofs = new THREE.MeshStandardMaterial({
      color: "#8e8f8a",
      map: surfaces.maps.asphalt.map,
      roughness: 0.95,
    });
    const metals = ["#4f6f8f", "#6d8a6a", "#9a5a48", "#c07a45", "#5f7f86"].map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          roughness: 0.5,
          metalness: 0.3,
          map: surfaces.maps.asphalt.normal,
        }),
    );
    let hanok = 0;
    const identity = new THREE.Matrix4();
    for (const building of data.buildings) {
      const ring = building.rings[0];
      if (ring.length < 4) continue;
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
        cz = (Math.min(...zs) + Math.max(...zs)) / 2,
        area = areaOf(ring),
        shell = shellAt(cx, cz);
      // 연출: every footprint becomes a traditional building; the outline,
      // and so the street layout, stays real.
      const fallback =
        style.ancient && area > 6
          ? area > 900
            ? "palace"
            : area < 45 && style.rural
              ? "thatched"
              : "house"
          : null;
      const rank =
        area > 6 && area < 2600
          ? (style.traditional(building, { x: cx, z: cz, area }, data) ??
            fallback)
          : fallback;
      const ground = ring.map(([x, z]) => field.groundAt(x, z));
      const gMin = Math.min(...ground),
        gMax = Math.max(...ground);
      if (rank) {
        hanok++;
        const seed = hash(building.id);
        const angle = principalAngle(ring);
        let top = 0,
          index = 0;
        const roofs: Surface[] = [];
        let eave = -Infinity;
        for (const rect of decompose(building, angle)) {
          const along = rect.w >= rect.d;
          const a = along ? angle : angle + Math.PI / 2;
          const W = Math.max(rect.w, rect.d),
            D = Math.min(rect.w, rect.d);
          if (D < 2.2) continue;
          const roof = chooseRoof(rank, W, D, seed);
          const platform =
            (rank === "palace"
              ? W * D > 420
                ? 1.2
                : 0.6
              : rank === "temple"
                ? 0.65
                : rank === "house"
                  ? 0.4
                  : 0.3) +
            (Math.max(...ground) - Math.min(...ground));
          const frontZ = Math.cos(a),
            front: 1 | -1 =
              frontZ > 0.2 || (Math.abs(frontZ) <= 0.2 && -Math.sin(a) > 0)
                ? 1
                : -1;
          const unit: HanokUnit = {
            W,
            D,
            rank,
            roof,
            front,
            platform: platform + 0.25,
            seed: seed + index++ * 7,
            lanterns: style.lanterns,
          };
          const y = gMax + (platform - (gMax - gMin));
          const frame = new THREE.Matrix4()
            .makeTranslation(rect.cx, y, rect.cz)
            .multiply(new THREE.Matrix4().makeRotationY(-a));
          const upper = upperStorey(unit);
          const lower = upper ? { ...unit, storey: "lower" as const } : unit;
          buildHanokUnit(shell, M, lower, "simple", frame);
          this.addDetail(lower, frame, rect.cx, rect.cz);
          top = Math.max(top, y + unitHeight(lower) - gMin);
          roofs.push(placedRoof(lower, frame));
          eave = Math.max(eave, y + eaveHeight(lower));
          if (upper) {
            const lift = new THREE.Matrix4().makeTranslation(
              0,
              upperBase(lower, upper),
              0,
            );
            const upperFrame = frame.clone().multiply(lift);
            buildHanokUnit(shell, M, upper, "simple", upperFrame);
            this.addDetail(upper, upperFrame, rect.cx, rect.cz);
            roofs.push(placedRoof(upper, upperFrame));
            top = Math.max(
              top,
              y + upperBase(lower, upper) + unitHeight(upper) - gMin,
            );
          }
        }
        this.tops.set(building, top);
        this.surfaces.set(building, {
          roofs,
          eave: Number.isFinite(eave) ? eave : gMin + top * 0.6,
        });
      } else {
        shell.setFrame(identity);
        const h = Math.max(3, Math.min(building.height, 90));
        const seed = hash(building.id);
        const metal =
          style.rural && area < 240 && h <= 8
            ? metals[seed % metals.length]
            : null;
        const top = modernBlock(
          shell,
          building,
          walls[seed % walls.length],
          roofs,
          metal,
          gMin - 0.3,
          h + (gMax - gMin) + 0.3,
        );
        this.tops.set(building, top - gMin);
        this.surfaces.set(building, top);
      }
    }
    this.hanokCount = hanok;
    for (const b of shells.values()) this.group.add(b.build());
    this.group.add(this.detailGroup);
  }
  /** Height a traveller could stand on at (x, z) inside the footprint. */
  surfaceAt(b: GeoBuilding, x: number, z: number) {
    const s = this.surfaces.get(b);
    if (s === undefined) return Infinity;
    if (typeof s === "number") return s;
    let best = -Infinity;
    for (const roof of s.roofs) {
      const h = roof(x, z);
      if (h !== null && h > best) best = h;
    }
    return best > -Infinity ? best : s.eave;
  }
  private addDetail(
    unit: HanokUnit,
    frame: THREE.Matrix4,
    x: number,
    z: number,
  ) {
    const key = `${Math.floor(x / 70)},${Math.floor(z / 70)}`;
    let cell = this.cells.get(key);
    if (!cell)
      this.cells.set(
        key,
        (cell = {
          x: (Math.floor(x / 70) + 0.5) * 70,
          z: (Math.floor(z / 70) + 0.5) * 70,
          units: [],
        }),
      );
    cell.units.push({ unit, frame, x, z });
  }
  /** Streams carpentry detail (columns, brackets, lanterns) near the traveller. */
  update(x: number, z: number, budget = 2) {
    const r = this.quality.detailRadius;
    for (const [key, cell] of this.cells) {
      const d = Math.hypot(cell.x - x, cell.z - z);
      const group = this.detail.get(key);
      if (d < r && !group && budget > 0) {
        budget--;
        const b = new Builder();
        for (const p of cell.units)
          buildHanokUnit(b, this.materials, p.unit, "detail", p.frame);
        const g = b.build(true);
        this.detail.set(key, g);
        this.detailGroup.add(g);
      } else if (d > r + 60 && group) {
        this.detailGroup.remove(group);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) o.geometry.dispose();
        });
        this.detail.delete(key);
      }
    }
  }
  dispose() {
    for (const g of this.detail.values())
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    this.detail.clear();
  }
}

/* ------------------------------ village walls ----------------------------- */

/**
 * 돌담길: fieldstone walls with a tiled coping along village lanes. Gaps are
 * left at junctions and at random gates. Returns thin footprints so the
 * traveller collides with the walls like with buildings.
 */
export function villageWalls(
  data: GeoSceneData,
  field: HeightField,
  sample: (name: "road" | "building" | "water", x: number, z: number) => number,
  surfaces: SurfaceLibrary,
  kind: "tile" | "earth",
) {
  const random = rng(404),
    b = new Builder(),
    footprints: (GeoBuilding & { top: number })[] = [];
  b.setFrame(new THREE.Matrix4());
  const M = hanokMaterials(surfaces);
  const stone = new THREE.MeshStandardMaterial({
    color: kind === "tile" ? "#d6cfc0" : "#cbbfa9",
    map: surfaces.maps.rock.map,
    normalMap: surfaces.maps.rock.normal,
    roughness: 0.95,
  });
  const upper = kind === "tile" ? M.plaster : M.mud;
  const step = 2.4,
    e = data.terrain.extent;
  for (const road of data.roads) {
    if (
      !["minor", "service", "path"].includes(road.class) ||
      road.subclass === "steps" ||
      road.bridge
    )
      continue;
    const offset = roadWidth(road) / 2 + 1.5;
    for (const side of [-1, 1]) {
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i],
          len = Math.hypot(bx - ax, bz - az);
        if (len < step) continue;
        const dx = (bx - ax) / len,
          dz = (bz - az) / len,
          nx = -dz * side,
          nz = dx * side;
        for (let t = 0.6; t + step <= len - 0.6; t += step) {
          const x0 = ax + dx * t + nx * offset,
            z0 = az + dz * t + nz * offset,
            x1 = x0 + dx * step,
            z1 = z0 + dz * step,
            mx = (x0 + x1) / 2,
            mz = (z0 + z1) / 2;
          if (
            Math.hypot(mx, mz) > 400 ||
            Math.abs(mx) > e - 6 ||
            Math.abs(mz) > e - 6
          )
            continue;
          if (random() < 0.07) continue;
          const clear =
            [
              [x0, z0],
              [mx, mz],
              [x1, z1],
            ].every(
              ([x, z]) =>
                sample("road", x, z) < 0.45 && sample("water", x, z) < 0.05,
            ) &&
            [
              [x0, z0],
              [mx, mz],
              [x1, z1],
              [mx + nx * 0.8, mz + nz * 0.8],
            ].every(([x, z]) => sample("building", x, z) < 0.05);
          if (!clear) continue;
          const g0 = field.groundAt(x0, z0),
            g1 = field.groundAt(x1, z1),
            y = Math.min(g0, g1) - 0.25,
            rot = Math.atan2(dx, dz);
          const lower = kind === "tile" ? 1.0 : 1.2,
            top = Math.max(g0, g1) + lower + 0.45;
          b.box(
            stone,
            mx,
            (y + Math.max(g0, g1) + lower) / 2,
            mz,
            0.5,
            Math.max(g0, g1) + lower - y,
            step + 0.02,
            rot,
            1.2,
          );
          b.box(
            upper,
            mx,
            Math.max(g0, g1) + lower + 0.2,
            mz,
            0.42,
            0.4,
            step + 0.02,
            rot,
            1.2,
          );
          // 기와 coping: a small two-sided roof along the wall.
          const ax2 = Math.cos(rot) * 0.38,
            az2 = -Math.sin(rot) * 0.38;
          const P = (sx: number, along: number, h: number) =>
            new THREE.Vector3(
              mx + dx * along + ax2 * sx,
              top + h,
              mz + dz * along + az2 * sx,
            );
          const h = step / 2 + 0.02;
          for (const sx of [-1, 1]) {
            const quad = [
              P(0, -h, 0.22),
              P(0, h, 0.22),
              P(sx, h, -0.02),
              P(sx, -h, -0.02),
            ];
            if (sx > 0)
              b.quad(M.tile, quad[0], quad[3], quad[2], quad[1], [
                [0, 0],
                [0, 0.4],
                [step / 1.2, 0.4],
                [step / 1.2, 0],
              ]);
            else
              b.quad(M.tile, quad[0], quad[1], quad[2], quad[3], [
                [0, 0],
                [step / 1.2, 0],
                [step / 1.2, 0.4],
                [0, 0.4],
              ]);
          }
          b.box(M.ridge, mx, top + 0.25, mz, 0.16, 0.1, step + 0.02, rot, 1);
          const hx = nx * 0.26,
            hz = nz * 0.26;
          footprints.push({
            id: `wall-${footprints.length}`,
            name: "",
            top: top + 0.28,
            height: top - field.groundAt(mx, mz) + 0.3,
            rings: [
              [
                [x0 - hx, z0 - hz],
                [x1 - hx, z1 - hz],
                [x1 + hx, z1 + hz],
                [x0 + hx, z0 + hz],
                [x0 - hx, z0 - hz],
              ],
            ],
          });
        }
      }
    }
  }
  return { group: b.build(), footprints };
}
