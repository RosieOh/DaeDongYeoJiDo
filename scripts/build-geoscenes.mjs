import fs from "node:fs/promises";
import { repairDEM } from "./repair-dem.mjs";
import path from "node:path";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PNG } from "pngjs";
import { places } from "../src/data.ts";
const output = path.resolve("public/geo");
await fs.mkdir(output, { recursive: true });
const metadata = await (
  await fetch("https://tiles.openfreemap.org/planet")
).json();
const template = metadata.tiles[0],
  cache = new Map(),
  demCache = new Map();
const R = 6378137,
  scale = 2 ** 14;
const tilePoint = (lng, lat) => [
  ((lng + 180) / 360) * scale,
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale,
];
const world = (lng, lat, center) => [
  (((lng - center[0]) * Math.PI) / 180) *
    R *
    Math.cos((center[1] * Math.PI) / 180),
  ((-(lat - center[1]) * Math.PI) / 180) * R,
];
async function tile(x, y) {
  const key = `${x}/${y}`;
  if (!cache.has(key)) {
    const response = await fetch(
      template.replace("{z}", "14").replace("{x}", x).replace("{y}", y),
    );
    if (!response.ok) throw new Error(`Vector ${key}: ${response.status}`);
    cache.set(
      key,
      new VectorTile(
        new PbfReader(new Uint8Array(await response.arrayBuffer())),
      ),
    );
  }
  return cache.get(key);
}
async function dem(x, y) {
  const key = `${x}/${y}`;
  if (!demCache.has(key)) {
    const response = await fetch(
      `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/${x}/${y}.png`,
    );
    if (!response.ok) throw new Error(`DEM ${key}: ${response.status}`);
    demCache.set(key, PNG.sync.read(Buffer.from(await response.arrayBuffer())));
  }
  return demCache.get(key);
}
const round = (v) => Math.round(v * 100) / 100;
const overlaps = (p, r) =>
  p.length &&
  Math.min(...p.map((v) => v[0])) <= r &&
  Math.max(...p.map((v) => v[0])) >= -r &&
  Math.min(...p.map((v) => v[1])) <= r &&
  Math.max(...p.map((v) => v[1])) >= -r;
const walkable = [
  "path",
  "minor",
  "service",
  "track",
  "tertiary",
  "secondary",
  "primary",
];
for (const place of places) {
  const center = place.coordinates,
    extent = 450,
    terrainExtent = 900;
  const [tx, ty] = tilePoint(...center),
    latPerMeter = 180 / Math.PI / R,
    lngPerMeter = latPerMeter / Math.cos((center[1] * Math.PI) / 180);
  const lower = tilePoint(
      center[0] - extent * lngPerMeter,
      center[1] + extent * latPerMeter,
    ),
    upper = tilePoint(
      center[0] + extent * lngPerMeter,
      center[1] - extent * latPerMeter,
    );
  const buildings = [],
    roads = [],
    water = [],
    cover = [],
    pois = [];
  const seen = new Set();
  for (let x = Math.floor(lower[0]); x <= Math.floor(upper[0]); x++)
    for (let y = Math.floor(lower[1]); y <= Math.floor(upper[1]); y++) {
      const data = await tile(x, y);
      for (const kind of [
        "building",
        "transportation",
        "transportation_name",
        "water",
        "landcover",
        "landuse",
        "park",
        "poi",
        "mountain_peak",
      ]) {
        const layer = data.layers[kind];
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i),
            geo = f.toGeoJSON(x, y, 14),
            props = f.properties;
          const convert = (point) =>
            world(point[0], point[1], center).map(round);
          const flatten = (coords) =>
            typeof coords[0] === "number" ? [coords] : coords.flatMap(flatten);
          const vertices = flatten(geo.geometry.coordinates).map(convert);
          if (!overlaps(vertices, extent + 20)) continue;
          const key = kind + ":" + (f.id ?? "") + JSON.stringify(vertices);
          if (seen.has(key)) continue;
          seen.add(key);
          const name = props["name:ko"] || props.name || "",
            cls = props.class || "";
          if (kind === "building") {
            if (props.hide_3d || Number(props.render_min_height) > 0) continue;
            const polygons =
              geo.geometry.type === "MultiPolygon"
                ? geo.geometry.coordinates
                : [geo.geometry.coordinates];
            for (const polygon of polygons) {
              const rings = polygon.map((r) => r.map(convert));
              if (rings[0].length < 4 || !overlaps(rings[0], extent + 20))
                continue;
              buildings.push({
                id: String(f.id || buildings.length),
                rings,
                height: Number(props.render_height) || 5,
                heightSource: "OpenMapTiles render_height; may be default",
                name,
              });
            }
          } else if (
            kind === "transportation" ||
            kind === "transportation_name"
          ) {
            if (
              !walkable.includes(cls) &&
              props.subclass !== "pedestrian" &&
              props.subclass !== "footway"
            )
              continue;
            if (
              geo.geometry.type !== "LineString" &&
              geo.geometry.type !== "MultiLineString"
            )
              continue;
            const lines =
              geo.geometry.type === "MultiLineString"
                ? geo.geometry.coordinates
                : [geo.geometry.coordinates];
            for (const line of lines) {
              if (!overlaps(line.map(convert), extent + 20)) continue;
              roads.push({
                id: String(f.id || roads.length),
                points: line.map(convert),
                class: cls,
                subclass: props.subclass || "",
                bridge: props.brunnel === "bridge",
                name,
              });
            }
          } else if (["water", "landcover", "landuse", "park"].includes(kind)) {
            if (
              geo.geometry.type !== "Polygon" &&
              geo.geometry.type !== "MultiPolygon"
            )
              continue;
            const polygons =
              geo.geometry.type === "MultiPolygon"
                ? geo.geometry.coordinates
                : [geo.geometry.coordinates];
            for (const polygon of polygons)
              (kind === "water" ? water : cover).push({
                rings: polygon.map((r) => r.map(convert)),
                class: cls,
              });
          } else if (geo.geometry.type === "Point" && name) {
            const p = convert(geo.geometry.coordinates);
            if (Math.abs(p[0]) < extent && Math.abs(p[1]) < extent)
              pois.push({
                id: String(f.id || pois.length),
                name,
                class: cls,
                subclass: props.subclass || "",
                x: p[0],
                z: p[1],
              });
          }
        }
      }
    }
  // Fetch a local height field from actual global DEM tiles, using bilinear sampling.
  const lo = tilePoint(
      center[0] - terrainExtent * lngPerMeter,
      center[1] + terrainExtent * latPerMeter,
    ),
    hi = tilePoint(
      center[0] + terrainExtent * lngPerMeter,
      center[1] - terrainExtent * latPerMeter,
    );
  for (let x = Math.floor(lo[0]); x <= Math.floor(hi[0]) + 1; x++)
    for (let y = Math.floor(lo[1]); y <= Math.floor(hi[1]) + 1; y++)
      await dem(x, y);
  function pixel(gx, gy) {
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      img = demCache.get(`${Math.floor(ix / 256)}/${Math.floor(iy / 256)}`);
    const offset = ((iy % 256) * 256 + (ix % 256)) * 4;
    const value =
      img.data[offset] * 256 +
      img.data[offset + 1] +
      img.data[offset + 2] / 256 -
      32768;
    return img.data[offset + 3] === 0 || value < -12000 ? NaN : value;
  }
  const size = 129,
    heights = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i / (size - 1)) * 2 - 1) * terrainExtent,
        z = ((j / (size - 1)) * 2 - 1) * terrainExtent;
      const [px, py] = tilePoint(
          center[0] + x * lngPerMeter,
          center[1] - z * latPerMeter,
        ),
        gx = px * 256,
        gy = py * 256,
        fx = gx % 1,
        fy = gy % 1;
      const samples = [
        [pixel(gx, gy), (1 - fx) * (1 - fy)],
        [pixel(gx + 1, gy), fx * (1 - fy)],
        [pixel(gx, gy + 1), (1 - fx) * fy],
        [pixel(gx + 1, gy + 1), fx * fy],
      ].filter(([v]) => Number.isFinite(v));
      heights.push(
        round(
          samples.length
            ? samples.reduce((a, [v, w]) => a + v * w, 0) /
                samples.reduce((a, [, w]) => a + w, 0)
            : 0,
        ),
      );
    }
  const result = {
    version: 1,
    id: place.id,
    name: place.name,
    center,
    extent,
    source: {
      vector: template,
      dem: "https://registry.opendata.aws/terrain-tiles/",
      retrievedAt: new Date().toISOString(),
      attribution: "© OpenStreetMap contributors · OpenFreeMap · Terrain Tiles",
      license: "ODbL 1.0 (OSM-derived data); see SOURCES.md",
    },
    buildings,
    roads,
    water,
    cover,
    pois,
    terrain: {
      extent: terrainExtent,
      size,
      heights: repairDEM(heights, size, place.id),
    },
  };
  await fs.writeFile(
    path.join(output, place.id + ".json"),
    JSON.stringify(result),
  );
  console.log(
    place.id,
    JSON.stringify({
      buildings: buildings.length,
      roads: roads.length,
      water: water.length,
      cover: cover.length,
      pois: pois.length,
      altitude: [Math.min(...heights), Math.max(...heights)],
      tile: [tx, ty].map(Math.floor),
    }),
  );
}
