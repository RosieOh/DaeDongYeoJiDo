import type { Map as LibreMap, StyleSpecification } from "maplibre-gl";
import { asset } from "../asset";

/**
 * 청록산수 (blue-green landscape) world-map look: aged hanji, ink hillshade,
 * mineral blue-green peaks, ink-wash shores and patterned seas. Every image
 * here is drawn in code for this project.
 */
const PAPER = "#ece2c6";
const SEA = "#d0d8cc";

export const inkMapStyle: StyleSpecification = {
  version: 8,
  sky: {
    "sky-color": "#dfe2d4",
    "horizon-color": "#eee6d0",
    "fog-color": "#ece3cb",
    "fog-ground-blend": 0.35,
    "horizon-fog-blend": 0.75,
    "sky-horizon-blend": 0.9,
    "atmosphere-blend": 0,
  },
  sources: {
    land: {
      type: "geojson",
      // MapLibre fetches from a worker, so the URL must be absolute.
      data: new URL(asset("east-asia.geojson"), window.location.href).href,
      attribution:
        '<a href="https://www.naturalearthdata.com/">Natural Earth</a>',
    },
    openmap: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution:
        '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
    elevation: {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 14,
      attribution:
        '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>',
    },
  },
  layers: [
    {
      id: "sea",
      type: "background",
      paint: {
        "background-pattern": ["step", ["zoom"], "ink-sea", 8, "ink-paper"],
      },
    },
    {
      id: "land",
      type: "fill",
      source: "land",
      maxzoom: 8,
      paint: {
        "fill-color": [
          "case",
          ["==", ["get", "ADMIN"], "South Korea"],
          PAPER,
          "#e3d9bd",
        ],
      },
    },
    {
      // Ink bleeding along the shore, darkest at the waterline.
      id: "shore-wash",
      type: "line",
      source: "land",
      maxzoom: 8,
      paint: {
        "line-color": "#5f807a",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 14, 8, 34],
        "line-blur": ["interpolate", ["linear"], ["zoom"], 5, 14, 8, 34],
        "line-opacity": 0.3,
      },
    },
    {
      id: "forest",
      type: "fill",
      source: "openmap",
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": "#7d9a80", "fill-opacity": 0.2 },
    },
    {
      id: "park",
      type: "fill",
      source: "openmap",
      "source-layer": "park",
      minzoom: 9,
      paint: { "fill-color": "#93ab8f", "fill-opacity": 0.2 },
    },
    {
      id: "rivers",
      type: "line",
      source: "openmap",
      "source-layer": "waterway",
      minzoom: 7,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#4f6d68",
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.6, 13, 2.6],
        "line-opacity": 0.65,
      },
    },
    {
      // Mineral pigments by altitude: jade washes rising to azurite peaks.
      id: "pigment",
      type: "color-relief",
      source: "elevation",
      paint: {
        "color-relief-color": [
          "interpolate",
          ["linear"],
          ["elevation"],
          0,
          "rgba(236, 226, 198, 0)",
          150,
          "rgba(170, 186, 150, 0.12)",
          400,
          "rgba(120, 160, 130, 0.38)",
          800,
          "rgba(72, 138, 126, 0.6)",
          1200,
          "rgba(44, 110, 118, 0.72)",
          1700,
          "rgba(32, 86, 104, 0.8)",
        ],
        "color-relief-opacity": 0.95,
      },
    },
    {
      id: "relief",
      type: "hillshade",
      source: "elevation",
      paint: {
        "hillshade-shadow-color": "#34423c",
        "hillshade-highlight-color": "#fff8e2",
        "hillshade-accent-color": "#4d5d55",
        "hillshade-exaggeration": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          0.22,
          8,
          0.38,
          11,
          0.5,
        ],
        "hillshade-illumination-anchor": "map",
      },
    },
    {
      // Drawn over the relief so sea-floor shading never shows through.
      id: "water",
      type: "fill",
      source: "openmap",
      "source-layer": "water",
      paint: { "fill-pattern": "ink-sea" },
    },
    {
      id: "water-edge",
      type: "line",
      source: "openmap",
      "source-layer": "water",
      minzoom: 8,
      paint: {
        "line-color": "#4d6862",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.6, 14, 1.6],
        "line-opacity": 0.55,
      },
    },
    {
      id: "coast",
      type: "line",
      source: "land",
      maxzoom: 8,
      layout: { "line-join": "round" },
      paint: {
        "line-color": "#34433d",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 8, 1.8],
        "line-opacity": 0.75,
      },
    },
    {
      id: "boundaries",
      type: "line",
      source: "openmap",
      "source-layer": "boundary",
      filter: ["==", ["get", "admin_level"], 4],
      paint: {
        "line-color": "#93533f",
        "line-width": 0.9,
        "line-dasharray": [2, 3],
        "line-opacity": 0.45,
      },
    },
    {
      // Red road lines in the manner of old Korean maps.
      id: "roads",
      type: "line",
      source: "openmap",
      "source-layer": "transportation",
      minzoom: 9,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["motorway", "trunk", "primary", "secondary"]],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#a24a37",
        "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.7, 15, 3],
        "line-opacity": 0.55,
      },
    },
    {
      id: "buildings",
      type: "fill-extrusion",
      source: "openmap",
      "source-layer": "building",
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#cbbd9b",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.75,
      },
    },
  ],
};

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 수파문: tileable rows of brushed wave lines on a pale celadon sea. */
function seaPattern() {
  const w = 96,
    h = 48,
    canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.fillStyle = SEA;
  c.fillRect(0, 0, w, h);
  c.lineCap = "round";
  for (let row = 0; row < 4; row++) {
    const y = row * 12 + 6,
      shift = (row % 2) * 24;
    c.strokeStyle =
      row % 2 ? "rgba(84, 116, 108, 0.32)" : "rgba(84, 116, 108, 0.22)";
    c.lineWidth = 1.1;
    for (let k = -1; k < 3; k++) {
      const x0 = k * 48 + shift;
      c.beginPath();
      // A wave crest that curls at its tip.
      c.moveTo(x0, y + 3);
      c.bezierCurveTo(x0 + 12, y - 5, x0 + 26, y - 5, x0 + 34, y + 1);
      c.quadraticCurveTo(x0 + 38, y + 4, x0 + 35, y + 5);
      c.stroke();
    }
  }
  return c.getImageData(0, 0, w, h);
}

function paperPattern() {
  const w = 128,
    h = 128,
    canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.fillStyle = PAPER;
  c.fillRect(0, 0, w, h);
  const random = seeded(9);
  for (let i = 0; i < 90; i++) {
    c.strokeStyle = `rgba(120, 100, 70, ${0.03 + random() * 0.05})`;
    c.lineWidth = 0.6;
    const x = random() * w,
      y = random() * h,
      a = random() * Math.PI;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(
      x + Math.cos(a) * 9 + (random() - 0.5) * 6,
      y + Math.sin(a) * 9,
      x + Math.cos(a) * 18,
      y + Math.sin(a) * 18,
    );
    c.stroke();
  }
  return c.getImageData(0, 0, w, h);
}

export function addInkImages(map: LibreMap) {
  const images: Record<string, () => ImageData> = {
    "ink-sea": seaPattern,
    "ink-paper": paperPattern,
  };
  for (const [id, draw] of Object.entries(images))
    if (!map.hasImage(id)) map.addImage(id, draw());
  map.on("styleimagemissing", (e) => {
    const draw = images[e.id];
    if (draw && !map.hasImage(e.id)) map.addImage(e.id, draw());
  });
}

/** Soft painted cloud banks used for the drifting 운무 over the map. */
export function cloudImage(seed: number) {
  const w = 640,
    h = 260,
    canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!,
    random = seeded(seed);
  // Billows along a gently rising base line.
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const t = i / 25,
      x = 60 + t * (w - 120) + (random() - 0.5) * 30,
      r = (38 + random() * 52) * Math.sin(Math.PI * (0.15 + t * 0.7)),
      y = h * 0.62 - r * 0.45 + (random() - 0.5) * 18;
    puffs.push([x, y, r]);
  }
  for (const [x, y, r] of puffs) {
    const g = c.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
    g.addColorStop(0, "rgba(255, 253, 246, 0.95)");
    g.addColorStop(0.65, "rgba(250, 247, 236, 0.75)");
    g.addColorStop(1, "rgba(250, 247, 236, 0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  // Cool shadow under the billows and a flat painted base.
  c.globalCompositeOperation = "source-atop";
  const shade = c.createLinearGradient(0, h * 0.35, 0, h * 0.8);
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(120, 140, 140, 0.35)");
  c.fillStyle = shade;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "destination-out";
  const base = c.createLinearGradient(0, h * 0.66, 0, h * 0.8);
  base.addColorStop(0, "rgba(0, 0, 0, 0)");
  base.addColorStop(1, "rgba(0, 0, 0, 1)");
  c.fillStyle = base;
  c.fillRect(0, h * 0.66, w, h);
  return canvas.toDataURL("image/png");
}

/** 운문 (auspicious cloud scroll) drawn as an SVG path of linked spirals. */
export function cloudMotif(width = 220) {
  const spiral = (
    cx: number,
    cy: number,
    r: number,
    turns: number,
    dir: number,
  ) => {
    let d = "";
    for (let i = 0; i <= 40; i++) {
      const t = i / 40,
        a = dir * t * turns * Math.PI * 2,
        rr = r * (1 - t * 0.8);
      d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
    }
    return d;
  };
  const paths = [
    spiral(40, 40, 22, 1.2, 1),
    spiral(80, 30, 16, 1.1, -1),
    spiral(112, 44, 12, 1, 1),
    "M18,46 C30,70 70,66 86,48 C98,64 130,64 140,46 C160,56 190,52 205,40",
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 80" width="${width}"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</g></svg>`;
}
