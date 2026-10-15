import * as THREE from "three";
import type { Place } from "../data";
import { Ambient } from "./ambient";
import { Townscape, villageWalls } from "./buildings";
import {
  closestRoadPoint,
  findSpawn,
  geoBlocked,
  pointInPolygon,
  roadWidth,
  segmentDistance,
  terrainHeight,
} from "./geo";
import type { GeoBuilding, GeoPolygon, GeoRoad, GeoSceneData } from "./geo";
import { Builder } from "./hanok";
import { styleFor } from "./placeStyles";
import { prepareTerrain, signature } from "./signature";
import { cloudSea } from "./clouds";
import {
  RiverLanterns,
  lotusPonds,
  pavilions,
  stonePeaks,
  waterfall,
} from "./scenery";
import { Cranes } from "./cranes";
import { Crowd } from "./npcs";
import { townProps } from "./props";
import type { QualitySettings } from "./quality";
import {
  GroundMasks,
  HeightField,
  buildFarTerrain,
  buildNearTerrain,
} from "./terrain";
import type { SurfaceLibrary } from "./textures";
import { canvasTexture } from "./textures";
import {
  TreeField,
  createGrass,
  scatterMeadow,
  scatterRocks,
  scatterTrees,
  teaRows,
} from "./vegetation";
import { PlanarReflection, buildOcean, createWaterMaterial } from "./water";
import type { Stop } from "./world";

const coastal = ["seongsan", "busan", "suncheon"];
const rockiness: Record<string, number> = {
  seorak: 1,
  danyang: 0.8,
  seongsan: 0.55,
  bulguksa: 0.3,
  busan: 0.6,
};

function flatPolygon(polygon: GeoPolygon, y: number, material: THREE.Material) {
  const shape = new THREE.Shape(
    polygon.rings[0].map(([x, z]) => new THREE.Vector2(x, -z)),
  );
  for (const ring of polygon.rings.slice(1))
    shape.holes.push(
      new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))),
    );
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, y, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** Road ribbons that hug the terrain, plus stone or concrete bridges. */
function buildRoads(
  field: HeightField,
  data: GeoSceneData,
  surfaces: SurfaceLibrary,
  traditional: boolean,
  earthen: boolean,
) {
  const group = new THREE.Group();
  const layer = (
    map: { map: THREE.Texture; normal: THREE.Texture },
    color: string,
  ) =>
    new THREE.MeshStandardMaterial({
      color,
      map: map.map,
      normalMap: map.normal,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  const asphalt = layer(surfaces.maps.asphalt, "#b9bbb6"),
    paving = layer(surfaces.maps.paving, traditional ? "#e2dacb" : "#d7d3ca"),
    path = layer(surfaces.maps.path, "#e6dcc8");
  const materialFor = (road: GeoRoad) =>
    earthen && road.class !== "tertiary" && road.class !== "secondary"
      ? path
      : road.subclass === "pedestrian" ||
          road.subclass === "steps" ||
          (traditional && ["minor", "service"].includes(road.class))
        ? paving
        : road.class === "path" || road.class === "track"
          ? road.subclass === "footway" && !traditional
            ? paving
            : path
          : asphalt;
  const buckets = new Map<THREE.Material, { p: number[]; u: number[] }>();
  const e = data.terrain.extent;
  for (const road of data.roads) {
    const half = roadWidth(road) / 2,
      list = buckets.get(materialFor(road)) ?? { p: [], u: [] };
    buckets.set(materialFor(road), list);
    let distance = 0;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const nx = (-(b[1] - a[1]) / length) * half,
        nz = ((b[0] - a[0]) / length) * half,
        steps = Math.ceil(length / 1.5);
      for (let j = 0; j < steps; j++) {
        const t = j / steps,
          u = (j + 1) / steps;
        const ax = a[0] + (b[0] - a[0]) * t,
          az = a[1] + (b[1] - a[1]) * t,
          bx = a[0] + (b[0] - a[0]) * u,
          bz = a[1] + (b[1] - a[1]) * u;
        if (Math.abs(ax) > e - 2 || Math.abs(az) > e - 2) continue;
        // Three vertices across so the ribbon follows cross-slopes too.
        const row = (x: number, z: number, d: number) =>
          [-1, 0, 1].map((s) => {
            const px = x + nx * s,
              pz = z + nz * s;
            return [
              px,
              field.heightAt(px, pz) + 0.07,
              pz,
              ((s + 1) * half) / 3,
              d / 3,
            ];
          });
        const A = row(ax, az, distance + t * length),
          B = row(bx, bz, distance + u * length);
        for (let k = 0; k < 2; k++)
          for (const v of [A[k], A[k + 1], B[k], A[k + 1], B[k + 1], B[k]]) {
            list.p.push(v[0], v[1], v[2]);
            list.u.push(v[3], v[4]);
          }
      }
      distance += length;
    }
  }
  for (const [material, list] of buckets) {
    if (!list.p.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(list.p, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(list.u, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // Bridges: deck, parapets and piers down to the riverbed.
  const builder = new Builder();
  builder.setFrame(new THREE.Matrix4());
  const stone = new THREE.MeshStandardMaterial({
    color: traditional ? "#cfc6b5" : "#bdbab3",
    map: surfaces.maps.paving.map,
    normalMap: surfaces.maps.paving.normal,
    roughness: 0.9,
  });
  for (const b of field.bridges) {
    const dx = b.b[0] - b.a[0],
      dz = b.b[1] - b.a[1],
      length = Math.hypot(dx, dz);
    if (length < 0.5) continue;
    const rot = Math.atan2(dx, dz),
      cx = (b.a[0] + b.b[0]) / 2,
      cz = (b.a[1] + b.b[1]) / 2,
      cy = (b.ya + b.yb) / 2;
    builder.box(
      stone,
      cx,
      cy - 0.32,
      cz,
      b.half * 2,
      0.6,
      length + 0.2,
      rot,
      2,
    );
    for (const s of [-1, 1]) {
      const ox = Math.cos(rot) * s * (b.half - 0.15),
        oz = -Math.sin(rot) * s * (b.half - 0.15);
      builder.box(
        stone,
        cx + ox,
        cy + 0.45,
        cz + oz,
        0.25,
        0.9,
        length + 0.2,
        rot,
        2,
      );
    }
    const ground = Math.min(field.groundAt(cx, cz), cy - 2);
    if (length > 6 && cy - ground > 1.5)
      builder.box(
        stone,
        cx,
        (cy - 0.6 + ground) / 2,
        cz,
        b.half * 1.4,
        cy - 0.6 - ground,
        1.4,
        rot,
        2,
      );
  }
  group.add(builder.build());
  return group;
}

/** Soft golden markers: a ground halo and a light pillar, like quest beacons. */
function markers(stops: Stop[], heightAt: (x: number, z: number) => number) {
  const rings = new THREE.Group();
  const glow = canvasTexture(64, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  const halo = canvasTexture(128, 128, (c, w) => {
    const g = c.createRadialGradient(
      w / 2,
      w / 2,
      w * 0.28,
      w / 2,
      w / 2,
      w / 2,
    );
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.55, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
  });
  const pillarMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffc86e").multiplyScalar(0.28),
    alphaMap: glow,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#ffd27a").multiplyScalar(0.32),
    alphaMap: halo,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const gem = new THREE.MeshStandardMaterial({
    color: "#f4cf7d",
    emissive: "#ffb347",
    emissiveIntensity: 1.2,
    metalness: 0.4,
    roughness: 0.3,
  });
  for (const stop of stops) {
    const y = heightAt(stop.x, stop.z);
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2, 12, 12),
      haloMat,
    );
    ring.geometry.rotateX(-Math.PI / 2);
    const p = ring.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + stop.x,
        z = p.getZ(i) + stop.z;
      p.setXYZ(i, x, heightAt(x, z) + 0.12, z);
    }
    ring.renderOrder = 2;
    rings.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 9, 20, 1, true),
      pillarMat,
    );
    pillar.name = "pillar";
    pillar.position.set(stop.x, y + 4.5, stop.z);
    pillar.renderOrder = 3;
    rings.add(pillar);
    const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.17), gem);
    mark.name = "beacon";
    mark.position.set(stop.x, y + 2.3, stop.z);
    mark.userData.baseY = y + 2.3;
    rings.add(mark);
  }
  return rings;
}

export function buildGeoWorld(
  place: Place,
  data: GeoSceneData,
  surfaces: SurfaceLibrary,
  quality: QualitySettings,
) {
  const style = styleFor(place.id);
  const spawn = findSpawn(data),
    base = terrainHeight(data, spawn.x, spawn.z);
  const coast = coastal.includes(place.id);
  const field = new HeightField(
    data,
    base,
    quality.terrainSegments,
    coast,
    style.relief,
  );
  const heightAt = field.heightAt;
  prepareTerrain(place.id, data, field);
  const masks = new GroundMasks(data, style, field);
  const group = new THREE.Group();
  group.add(buildNearTerrain(field, masks, style, surfaces, quality));
  const far = buildFarTerrain(field);
  if (far) group.add(far);
  const hasSea = coast || !!data.far?.heights.some((h) => h < 0);
  // A live mirror of the scene on rivers, lakes and the sea (desktop tier).
  const reflection =
    quality.level === "high" && (hasSea || data.water.length)
      ? new PlanarReflection()
      : null;
  const water = createWaterMaterial(
    coast ? "#24505c" : "#2f5a58",
    reflection ?? undefined,
    !coast,
  );
  if (reflection) water.envMapIntensity = 0.45;
  const waterMeshes: THREE.Object3D[] = [];
  if (hasSea) {
    const ocean = buildOcean(field.seaLevel, data.far?.extent ?? 2000, water);
    waterMeshes.push(ocean);
    group.add(ocean);
  }
  for (const { polygon, level } of field.waterLevels)
    if (!coast) {
      const mesh = flatPolygon(polygon, level, water);
      waterMeshes.push(mesh);
      group.add(mesh);
    }
  let reflectClock = 0;
  const traditional = [
    "palace",
    "jeonju",
    "bulguksa",
    "suwon",
    "busan",
  ].includes(place.id);
  group.add(
    buildRoads(field, data, surfaces, traditional, place.id === "andong"),
  );
  const town = new Townscape(data, field, style, surfaces, quality);
  group.add(town.group);
  if (style.walls) {
    const walls = villageWalls(
      data,
      field,
      (n, x, z) => masks.sample(n, x, z),
      surfaces,
      style.walls,
    );
    group.add(walls.group);
    // Walls collide like buildings and show on the minimap.
    for (const f of walls.footprints) {
      data.buildings.push(f);
      town.tops.set(f, f.height);
      town.surfaces.set(f, f.top);
    }
  }
  // 연출: pavilions at viewpoints and a waterfall on the steepest nearby slope.
  const halls = pavilions(field, masks, spawn, surfaces);
  group.add(halls.group);
  const falls = style.waterfall
    ? waterfall(field, masks, spawn, surfaces, water)
    : null;
  if (falls) group.add(falls.group);
  for (const f of [
    ...halls.footprints,
    ...(falls?.footprint ? [falls.footprint] : []),
  ]) {
    data.buildings.push(f);
    town.tops.set(f, f.height);
    town.surfaces.set(f, f.top);
  }
  // Clearings are capsules: around each set piece and along the sightline
  // from the path to the waterfall.
  const clearings = [
    ...halls.spots.map((p) => ({ a: p, b: p, r: 9 })),
    ...(falls?.at && falls.view
      ? [
          { a: falls.at, b: falls.at, r: 30 },
          { a: falls.at, b: falls.view, r: 14 },
        ]
      : []),
  ];
  const trees = new TreeField(
    // Keep the opening view and the set pieces clear of trunks.
    scatterTrees(
      field,
      masks,
      style,
      quality,
      (x, z) =>
        Math.hypot(x - spawn.x, z - spawn.z) < 7 ||
        clearings.some(
          (c) =>
            segmentDistance(x, z, [c.a.x, c.a.z], [c.b.x, c.b.z]).distance <
            c.r,
        ),
    ),
    surfaces,
    quality.level === "high" ? 150 : 90,
  );
  group.add(trees.group);
  const grass = createGrass(field, masks.grassTexture(field), style, quality);
  group.add(grass);
  group.add(scatterMeadow(field, masks, quality, place.id === "suncheon"));
  const clouds = cloudSea(field);
  if (clouds) group.add(clouds);
  const cranes = new Cranes();
  // 연출: villagers on the lanes and street props (lanterns, banners, boats).
  const crowd = new Crowd(
    field,
    data.roads,
    spawn,
    quality.level === "high" ? 40 : 14,
  );
  group.add(crowd.group);
  const props = townProps(
    field,
    masks,
    data.roads,
    style,
    spawn,
    quality.level,
  );
  group.add(props.group);
  group.add(cranes.group);
  group.add(scatterRocks(field, masks, surfaces, rockiness[place.id] ?? 0.15));
  if (place.id === "boseong")
    group.add(teaRows(field, masks, quality.level === "high" ? 26000 : 9000));
  group.add(signature(place.id, data, field, surfaces));
  group.add(stonePeaks(field, style, surfaces));
  if (!coast) group.add(lotusPonds(field, masks, spawn));
  const riverLanterns = new RiverLanterns(field, spawn);
  group.add(riverLanterns.group);
  const ambient = new Ambient(style);
  group.add(ambient.group);

  const stops: Stop[] = [
    {
      id: "origin",
      name: `${place.name} 여행의 시작`,
      subtitle: "실제 길 위에서 출발",
      x: spawn.x,
      z: spawn.z,
      description: `${place.description} 이 탐험 공간은 실제 위치와 지도에 등록된 도로·건물 윤곽을 바탕으로 구성했습니다. 먼 산세, 기암, 폭포, 정자, 건물 외관과 식생은 풍경을 위해 연출한 표현입니다.`,
    },
  ];
  const names = new Set<string>();
  for (const poi of [...data.pois].sort(
    (a, b) =>
      Math.hypot(a.x - spawn.x, a.z - spawn.z) -
      Math.hypot(b.x - spawn.x, b.z - spawn.z),
  )) {
    if (stops.length >= 4) break;
    if (
      names.has(poi.name) ||
      (![
        "attraction",
        "museum",
        "monument",
        "castle",
        "viewpoint",
        "peak",
        "place_of_worship",
      ].includes(poi.subclass) &&
        !["attraction", "mountain_peak"].includes(poi.class))
    )
      continue;
    const p = closestRoadPoint(data, poi.x, poi.z);
    if (
      !p ||
      p.distance > 65 ||
      geoBlocked(data, p.x, p.z) ||
      stops.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 12)
    )
      continue;
    names.add(poi.name);
    stops.push({
      id: `poi-${poi.id}`,
      name: poi.name,
      subtitle: "지도에 기록된 장소",
      x: p.x,
      z: p.z,
      description: `${poi.name} 주변입니다. OpenStreetMap에 등록된 장소의 위치를 사용하며, 접근 가능한 인근 길에 발견 표식을 두었습니다. 외관과 길의 폭은 실제와 다를 수 있습니다.`,
    });
  }
  for (const [i, dx, dz] of [
    [1, 70, 0],
    [2, 0, -100],
    [3, -130, 50],
  ]) {
    if (stops.length >= 4) break;
    const p = closestRoadPoint(data, spawn.x + dx, spawn.z + dz);
    if (
      !p ||
      geoBlocked(data, p.x, p.z) ||
      stops.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 15)
    )
      continue;
    stops.push({
      id: `walk-${i}`,
      name: p.road.name || ["", "동쪽 탐방길", "북쪽 탐방길", "서쪽 탐방길"][i],
      subtitle: "주변 길을 따라 걷기",
      x: p.x,
      z: p.z,
      description:
        "실제 지도에 등록된 길을 따라 만나는 산책 지점입니다. 관광시설의 공식 명칭이나 현장 통행 가능 여부를 뜻하지 않습니다.",
    });
  }
  const rings = markers(stops, heightAt);
  trees.update(spawn.x, spawn.z, true);
  town.update(spawn.x, spawn.z, Infinity);
  return {
    group,
    rings,
    stops,
    spawn,
    data,
    heightAt,
    // Haze thins with altitude above the sea; mist pools in the local valleys.
    hazeBase: Math.min(field.lowest, field.seaLevel * 0.5),
    mistBase: Math.max(field.lowest, -30),
    trees: trees.count,
    hanok: town.hanokCount,
    buildingTop: (b: GeoBuilding) => town.tops.get(b) ?? b.height,
    surfaceAt: (b: GeoBuilding, x: number, z: number) =>
      town.surfaceAt(b, x, z),
    /** Water surface level for 경공 water-skimming; null on land and bridges. */
    waterAt(x: number, z: number) {
      if (field.bridgeAt(x, z) !== null) return null;
      if (field.wetlands.some((p) => pointInPolygon(x, z, p))) return null;
      for (const w of field.waterLevels)
        if (pointInPolygon(x, z, w.polygon)) {
          const road = closestRoadPoint(data, x, z);
          if (road && road.distance <= roadWidth(road.road) / 2 + 0.3)
            return null;
          return w.level;
        }
      if (coast && field.groundAt(x, z) < field.seaLevel - 0.3)
        return field.seaLevel;
      return null;
    },
    /** Locations of the art-directed set pieces (also used by dev tooling). */
    setPieces: {
      waterfall: falls?.at ?? null,
      waterfallView: falls?.view ?? null,
      villagers: () => crowd.positions(),
      pavilions: halls.spots,
    },
    reflection,
    reflectionHidden: [...waterMeshes, grass, ambient.group, town.detailGroup],
    update(
      x: number,
      z: number,
      dt: number,
      time: number,
      player: THREE.Vector3,
      reduced: boolean,
    ) {
      trees.update(x, z);
      town.update(x, z);
      ambient.update(dt, time, player, reduced);
      cranes.update(dt, time, player);
      crowd.update(dt);
      props.update(time);
      riverLanterns.update(time);
      if (reflection && (reflectClock -= dt) <= 0) {
        // Mirror whichever water body is nearest to the traveller.
        reflectClock = 0.5;
        let best = coast ? 0 : Infinity,
          level = field.seaLevel;
        for (const w of field.waterLevels) {
          const ring = w.polygon.rings[0];
          let d = pointInPolygon(x, z, w.polygon) ? 0 : Infinity;
          for (let i = 0; i < ring.length && d > 0; i += 2)
            d = Math.min(d, Math.hypot(ring[i][0] - x, ring[i][1] - z));
          if (d < best) {
            best = d;
            level = w.level;
          }
        }
        reflection.level = level;
        // Mirror only when water is close enough to fill part of the view.
        reflection.enabled = best < 160;
      }
    },
    dispose() {
      town.dispose();
      reflection?.dispose();
    },
  };
}
