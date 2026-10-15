// Adds a coarse surrounding height field (about 29 × 29 km) to each local GIS
// snapshot so the journey can show the real distant ridges, valleys and coasts.
// The OSM snapshot inside each file is left untouched.
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { places } from "../src/data.ts";
const output = path.resolve("public/geo");
const R = 6378137,
  zoom = 12,
  scale = 2 ** zoom,
  extent = 14400,
  size = 193; // 150 m spacing, aligned with the 900 m local terrain edge.
const cache = new Map();
const tilePoint = (lng, lat) => [
  ((lng + 180) / 360) * scale,
  ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * scale,
];
async function dem(x, y) {
  const key = `${x}/${y}`;
  for (let attempt = 0; !cache.has(key); attempt++) {
    try {
      const response = await fetch(
        `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`,
      );
      if (!response.ok) throw new Error(`DEM ${key}: ${response.status}`);
      cache.set(key, PNG.sync.read(Buffer.from(await response.arrayBuffer())));
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  return cache.get(key);
}
function pixel(gx, gy) {
  const ix = Math.floor(gx),
    iy = Math.floor(gy),
    img = cache.get(`${Math.floor(ix / 256)}/${Math.floor(iy / 256)}`),
    offset = ((iy % 256) * 256 + (ix % 256)) * 4;
  return (
    img.data[offset] * 256 +
    img.data[offset + 1] +
    img.data[offset + 2] / 256 -
    32768
  );
}
for (const place of places) {
  const file = path.join(output, `${place.id}.json`);
  const scene = JSON.parse(await fs.readFile(file, "utf8"));
  const center = place.coordinates,
    latPerMeter = 180 / Math.PI / R,
    lngPerMeter = latPerMeter / Math.cos((center[1] * Math.PI) / 180);
  const lo = tilePoint(
      center[0] - extent * lngPerMeter,
      center[1] + extent * latPerMeter,
    ),
    hi = tilePoint(
      center[0] + extent * lngPerMeter,
      center[1] - extent * latPerMeter,
    );
  for (let x = Math.floor(lo[0]); x <= Math.floor(hi[0]) + 1; x++)
    for (let y = Math.floor(lo[1]); y <= Math.floor(hi[1]) + 1; y++)
      await dem(x, y);
  const heights = [];
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = ((i / (size - 1)) * 2 - 1) * extent,
        z = ((j / (size - 1)) * 2 - 1) * extent;
      const [px, py] = tilePoint(
        center[0] + x * lngPerMeter,
        center[1] - z * latPerMeter,
      );
      const gx = px * 256,
        gy = py * 256,
        fx = gx % 1,
        fy = gy % 1;
      const h =
        pixel(gx, gy) * (1 - fx) * (1 - fy) +
        pixel(gx + 1, gy) * fx * (1 - fy) +
        pixel(gx, gy + 1) * (1 - fx) * fy +
        pixel(gx + 1, gy + 1) * fx * fy;
      // Sea pixels drop well below the rendered sea surface so the distant
      // shoreline stays stable despite the coarse depth precision far away.
      heights.push(h <= 0 ? -60 : Math.round(h));
    }
  scene.far = { extent, size, heights };
  scene.source.far = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/ (AWS Terrain Tiles, retrieved ${new Date().toISOString()})`;
  await fs.writeFile(file, JSON.stringify(scene));
  console.log(
    place.id,
    "far terrain",
    Math.min(...heights),
    Math.max(...heights),
  );
}
