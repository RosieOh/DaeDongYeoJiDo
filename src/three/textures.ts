import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { asset } from "../asset";

/** CC0 surfaces from ambientCG, resized to 512 px (see public/textures/CREDITS.json). */
export const terrainLayers = [
  "grass",
  "dirt",
  "rock",
  "sand",
  "leaves",
  "path",
] as const;
const singles = [
  "plaster",
  "wood",
  "paving",
  "asphalt",
  "bark",
  "rock",
  "path",
  "sand",
] as const;
export type SurfaceName = (typeof singles)[number];
const fallback: Record<string, string> = {
  grass: "#6f8a4d",
  dirt: "#80684c",
  rock: "#7d7b76",
  sand: "#cdbb93",
  leaves: "#6c5a3a",
  path: "#b19f80",
  plaster: "#e9e3d6",
  wood: "#8c6a4a",
  paving: "#a9a69c",
  asphalt: "#6f716d",
  bark: "#6b4a37",
};
const SIZE = 512;

function loadPixels(name: string, normal: boolean) {
  return new Promise<HTMLCanvasElement>((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const c = canvas.getContext("2d", { willReadFrequently: true })!;
    const paintFallback = () => {
      c.fillStyle = normal ? "#8080ff" : fallback[name] || "#888";
      c.fillRect(0, 0, SIZE, SIZE);
      resolve(canvas);
    };
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // Flip once here so canvas rows match GL texture rows for both
      // CanvasTextures (flipY off) and DataArrayTextures (which cannot flip).
      c.translate(0, SIZE);
      c.scale(1, -1);
      c.drawImage(image, 0, 0, SIZE, SIZE);
      resolve(canvas);
    };
    image.onerror = paintFallback;
    image.src = asset(`textures/${name}${normal ? "_n" : ""}.jpg`);
  });
}

function arrayTexture(canvases: HTMLCanvasElement[], srgb: boolean) {
  const data = new Uint8Array(SIZE * SIZE * 4 * canvases.length);
  canvases.forEach((canvas, i) =>
    data.set(
      canvas.getContext("2d")!.getImageData(0, 0, SIZE, SIZE).data,
      i * SIZE * SIZE * 4,
    ),
  );
  const texture = new THREE.DataArrayTexture(data, SIZE, SIZE, canvases.length);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function single(canvas: HTMLCanvasElement, srgb: boolean) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A photoscanned rock: unit horizontal radius, resting on y = 0. */
export type RockShape = {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};
export type SurfaceLibrary = {
  terrainColor: THREE.DataArrayTexture;
  terrainNormal: THREE.DataArrayTexture;
  maps: Record<SurfaceName, { map: THREE.Texture; normal: THREE.Texture }>;
  /** CC0 Poly Haven rocks; empty when they could not be loaded. */
  rocks: RockShape[];
};

/** CC0 Poly Haven scans, simplified to 1.5–3k triangles with gltfpack. */
const ROCKS = ["rock_09", "rock_07", "boulder_01", "rock_face_01"];
async function loadRocks(): Promise<RockShape[]> {
  const loader = new GLTFLoader();
  const loaded = await Promise.all(
    ROCKS.map((name) =>
      loader
        .loadAsync(asset(`models/rocks/${name}.glb`))
        .then((gltf) => {
          let mesh: THREE.Mesh | undefined;
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => {
            if (!mesh && o instanceof THREE.Mesh) mesh = o;
          });
          if (!mesh) return null;
          // Dequantize, bake the node transform, then normalise the size.
          const geometry = new THREE.BufferGeometry();
          for (const [key, a] of Object.entries(mesh.geometry.attributes)) {
            // Scan vertex colours only darken the photographed albedo.
            if (key === "color") continue;
            const data = new Float32Array(a.count * a.itemSize);
            for (let i = 0; i < a.count; i++)
              for (let c = 0; c < a.itemSize; c++)
                data[i * a.itemSize + c] = a.getComponent(i, c);
            geometry.setAttribute(
              key,
              new THREE.BufferAttribute(data, a.itemSize),
            );
          }
          geometry.setIndex(mesh.geometry.index);
          geometry.applyMatrix4(mesh.matrixWorld);
          geometry.computeBoundingBox();
          const box = geometry.boundingBox!;
          const radius =
            Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
          geometry.translate(
            -(box.min.x + box.max.x) / 2,
            -box.min.y,
            -(box.min.z + box.max.z) / 2,
          );
          geometry.scale(1 / radius, 1 / radius, 1 / radius);
          geometry.computeBoundingSphere();
          const material = mesh.material as THREE.MeshStandardMaterial;
          // The packed ARM map's red channel is occlusion; scans read as
          // wet stone with their own roughness, so keep the rock matte.
          material.aoMap = material.roughnessMap;
          material.roughnessMap = material.metalnessMap = null;
          material.roughness = 0.9;
          material.metalness = 0;
          material.vertexColors = false;
          return { name, geometry, material };
        })
        .catch(() => null),
    ),
  );
  return loaded.filter((r): r is RockShape => !!r);
}
let library: Promise<SurfaceLibrary> | null = null;
/** Loads once per page; textures survive renderer disposal and re-upload on demand. */
export function loadSurfaces() {
  library ??= (async () => {
    const names = [...new Set([...terrainLayers, ...singles])];
    const rocks = loadRocks();
    const color = await Promise.all(names.map((n) => loadPixels(n, false)));
    const normal = await Promise.all(names.map((n) => loadPixels(n, true)));
    const pick = (list: HTMLCanvasElement[], n: string) =>
      list[names.indexOf(n as (typeof names)[number])];
    const maps = {} as SurfaceLibrary["maps"];
    for (const n of singles)
      maps[n] = {
        map: single(pick(color, n), true),
        normal: single(pick(normal, n), false),
      };
    return {
      terrainColor: arrayTexture(
        terrainLayers.map((n) => pick(color, n)),
        true,
      ),
      terrainNormal: arrayTexture(
        terrainLayers.map((n) => pick(normal, n)),
        false,
      ),
      maps,
      rocks: await rocks,
    };
  })();
  return library;
}

/** A seeded generator so procedural textures and placement are stable between visits. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function canvasTexture(
  width: number,
  height: number,
  draw: (c: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Builds a tangent-space normal map from a height function sampled per pixel. */
export function normalTexture(
  width: number,
  height: number,
  heightAt: (x: number, y: number) => number,
  strength = 2,
) {
  const h = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) h[y * width + x] = heightAt(x, y);
  return canvasTexture(
    width,
    height,
    (c) => {
      const image = c.createImageData(width, height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const l = h[y * width + ((x - 1 + width) % width)],
            r = h[y * width + ((x + 1) % width)],
            u = h[((y - 1 + height) % height) * width + x],
            d = h[((y + 1) % height) * width + x];
          // Canvas rows run downwards, so +v is "up" (u - d).
          const nx = (l - r) * strength,
            ny = (d - u) * strength,
            len = Math.hypot(nx, ny, 1),
            i = (y * width + x) * 4;
          image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
          image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
          image.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
          image.data[i + 3] = 255;
        }
      c.putImageData(image, 0, 0);
    },
    false,
  );
}
