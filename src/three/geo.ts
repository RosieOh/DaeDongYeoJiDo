export type Point2 = [number, number];
export type GeoPolygon = { rings: Point2[][]; class?: string };
export type GeoBuilding = GeoPolygon & {
  id: string;
  height: number;
  name: string;
};
export type GeoRoad = {
  id: string;
  points: Point2[];
  class: string;
  subclass: string;
  bridge: boolean;
  name: string;
};
export type GeoPOI = {
  id: string;
  name: string;
  class: string;
  subclass: string;
  x: number;
  z: number;
};
export type GeoSceneData = {
  version: number;
  id: string;
  name: string;
  center: Point2;
  extent: number;
  source: {
    vector: string;
    dem: string;
    retrievedAt: string;
    attribution: string;
    license: string;
    far?: string;
  };
  buildings: GeoBuilding[];
  roads: GeoRoad[];
  water: GeoPolygon[];
  cover: GeoPolygon[];
  pois: GeoPOI[];
  terrain: { extent: number; size: number; heights: number[] };
  /** Coarse surrounding relief (absolute metres) for distant ridges and coasts. */
  far?: { extent: number; size: number; heights: number[] };
};
export function pointInRing(x: number, z: number, ring: Point2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i],
      [bx, bz] = ring[j];
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax)
      inside = !inside;
  }
  return inside;
}
const boundsCache = new WeakMap<
  GeoPolygon,
  { minX: number; maxX: number; minZ: number; maxZ: number }
>();
function bounds(polygon: GeoPolygon) {
  let result = boundsCache.get(polygon);
  if (!result) {
    const ring = polygon.rings[0];
    result = {
      minX: Infinity,
      maxX: -Infinity,
      minZ: Infinity,
      maxZ: -Infinity,
    };
    for (const [x, z] of ring) {
      result.minX = Math.min(result.minX, x);
      result.maxX = Math.max(result.maxX, x);
      result.minZ = Math.min(result.minZ, z);
      result.maxZ = Math.max(result.maxZ, z);
    }
    boundsCache.set(polygon, result);
  }
  return result;
}
export function pointInPolygon(x: number, z: number, polygon: GeoPolygon) {
  const b = bounds(polygon);
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  return (
    pointInRing(x, z, polygon.rings[0]) &&
    !polygon.rings.slice(1).some((r) => pointInRing(x, z, r))
  );
}
export function segmentDistance(x: number, z: number, a: Point2, b: Point2) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = dx * dx + dz * dz;
  const t = length
    ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / length))
    : 0;
  return {
    x: a[0] + t * dx,
    z: a[1] + t * dz,
    distance: Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz),
    t,
  };
}
export function terrainHeight(data: GeoSceneData, x: number, z: number) {
  const { size, extent, heights } = data.terrain;
  const u = Math.max(
      0,
      Math.min(size - 1, ((x / extent + 1) / 2) * (size - 1)),
    ),
    v = Math.max(0, Math.min(size - 1, ((z / extent + 1) / 2) * (size - 1)));
  const i = Math.floor(u),
    j = Math.floor(v),
    a = Math.min(i + 1, size - 1),
    b = Math.min(j + 1, size - 1),
    fx = u - i,
    fy = v - j; // Match PlaneGeometry's diagonal so paths and feet stay on the rendered surface.
  const h00 = heights[j * size + i],
    h10 = heights[j * size + a],
    h01 = heights[b * size + i],
    h11 = heights[b * size + a];
  return fx + fy <= 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fy
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fy);
}
export function toCoordinates(
  data: GeoSceneData,
  x: number,
  z: number,
): Point2 {
  const degrees = 180 / Math.PI / 6378137;
  return [
    data.center[0] + (x * degrees) / Math.cos((data.center[1] * Math.PI) / 180),
    data.center[1] - z * degrees,
  ];
}
export function roadWidth(road: GeoRoad) {
  if (road.subclass === "pedestrian") return 5;
  if (road.class === "path") return road.subclass === "steps" ? 1.8 : 2.5;
  return (
    (
      {
        minor: 5,
        service: 3.5,
        track: 3,
        tertiary: 8,
        secondary: 12,
        primary: 16,
      } as Record<string, number>
    )[road.class] || 3
  );
}
export function closestRoadPoint(data: GeoSceneData, x: number, z: number) {
  let best: {
    x: number;
    z: number;
    distance: number;
    heading: number;
    road: GeoRoad;
  } | null = null;
  for (const road of data.roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        p = segmentDistance(x, z, a, b);
      if (Math.abs(p.x) > data.extent - 15 || Math.abs(p.z) > data.extent - 15)
        continue;
      if (!best || p.distance < best.distance)
        best = {
          ...p,
          heading: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])),
          road,
        };
    }
  return best;
}
export function geoBlocked(
  data: GeoSceneData,
  x: number,
  z: number,
  radius = 0.4,
) {
  if (Math.abs(x) > data.extent - 5 || Math.abs(z) > data.extent - 5)
    return true;
  for (const building of data.buildings) {
    const { minX, maxX, minZ, maxZ } = bounds(building);
    if (
      x < minX - radius ||
      x > maxX + radius ||
      z < minZ - radius ||
      z > maxZ + radius
    )
      continue;
    if (pointInPolygon(x, z, building)) return true;
    if (
      building.rings.some((r) =>
        r.some(
          (a, i) =>
            i > 0 && segmentDistance(x, z, r[i - 1], a).distance < radius,
        ),
      )
    )
      return true;
  }
  if (data.water.some((p) => pointInPolygon(x, z, p))) {
    const road = closestRoadPoint(data, x, z);
    if (!road || road.distance > roadWidth(road.road) / 2 + 0.3) return true;
  }
  return false;
}
export function moveInGeoWorld(
  data: GeoSceneData,
  x: number,
  z: number,
  dx: number,
  dz: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35));
  for (let i = 0; i < steps; i++) {
    const can = (nx: number, nz: number) =>
      !geoBlocked(data, nx, nz) &&
      Math.abs(terrainHeight(data, nx, nz) - terrainHeight(data, x, z)) < 1.5;
    if (can(x + dx / steps, z)) x += dx / steps;
    if (can(x, z + dz / steps)) z += dz / steps;
  }
  return { x, z };
}
export function validateGeoScene(value: unknown): value is GeoSceneData {
  if (!value || typeof value !== "object") return false;
  const d = value as GeoSceneData;
  return (
    d.version === 1 &&
    Array.isArray(d.center) &&
    d.center.length === 2 &&
    d.center.every(Number.isFinite) &&
    Number.isFinite(d.extent) &&
    d.extent > 0 &&
    Array.isArray(d.buildings) &&
    Array.isArray(d.roads) &&
    Array.isArray(d.water) &&
    Array.isArray(d.cover) &&
    Array.isArray(d.pois) &&
    !!d.terrain &&
    d.terrain.size > 1 &&
    d.terrain.heights.length === d.terrain.size ** 2 &&
    d.terrain.heights.every(Number.isFinite) &&
    (d.far === undefined ||
      (d.far.size > 1 &&
        d.far.extent > d.terrain.extent &&
        d.far.heights.length === d.far.size ** 2 &&
        d.far.heights.every(Number.isFinite)))
  );
}
export function findSpawn(data: GeoSceneData) {
  const candidates: { x: number; z: number; heading: number; score: number }[] =
    [];
  for (const road of data.roads)
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1],
        b = road.points[i],
        p = segmentDistance(0, 0, a, b);
      for (const t of [p.t, 0.25, 0.5, 0.75]) {
        const x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t;
        if (Math.abs(x) > data.extent - 20 || Math.abs(z) > data.extent - 20)
          continue;
        candidates.push({
          x,
          z,
          heading: Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])),
          score: Math.hypot(x, z) + (road.class === "path" ? 0 : 20),
        });
      }
    }
  candidates.sort((a, b) => a.score - b.score);
  const result = candidates.find((p) => !geoBlocked(data, p.x, p.z, 0.65));
  if (!result) throw new Error("No walkable starting point in GIS snapshot");
  return result;
}
