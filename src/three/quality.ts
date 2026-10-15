import * as THREE from "three";

export type QualityLevel = "low" | "high";
export type QualitySettings = {
  level: QualityLevel;
  pixelRatio: number;
  msaa: number;
  ao: boolean;
  bloom: boolean;
  shadowMapSize: number;
  shadowRange: number;
  terrainSegments: number;
  grassCount: number;
  grassRadius: number;
  treeBudget: number;
  detailRadius: number;
};

const presets: Record<QualityLevel, QualitySettings> = {
  high: {
    level: "high",
    pixelRatio: 1.5,
    msaa: 4,
    ao: true,
    bloom: true,
    shadowMapSize: 4096,
    shadowRange: 75,
    terrainSegments: 448,
    grassCount: 110000,
    grassRadius: 46,
    treeBudget: 5200,
    detailRadius: 190,
  },
  low: {
    level: "low",
    pixelRatio: 1,
    msaa: 0,
    ao: false,
    bloom: false,
    shadowMapSize: 2048,
    shadowRange: 42,
    terrainSegments: 224,
    grassCount: 22000,
    grassRadius: 24,
    treeBudget: 1500,
    detailRadius: 110,
  },
};

/** Picks a render tier once per journey. `?quality=low|high` overrides the guess. */
export function detectQuality(): QualitySettings {
  try {
    const forced = new URLSearchParams(window.location.search).get("quality");
    if (forced === "low" || forced === "high") return presets[forced];
  } catch {
    // Fall through to the device heuristic.
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const small = Math.min(window.screen.width, window.screen.height) < 760;
  const weak =
    (nav.deviceMemory ?? 8) < 4 || (navigator.hardwareConcurrency ?? 8) < 4;
  return presets[(coarse && small) || weak ? "low" : "high"];
}

/** Uniforms shared by every animated material in the journey scene. */
export const shared = {
  time: { value: 0 },
  wind: { value: new THREE.Vector2(0.8, 0.35) },
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color("#ffffff") },
  night: { value: 0 },
  player: { value: new THREE.Vector3() },
};
