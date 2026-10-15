import type { GeoBuilding, GeoSceneData } from "./geo";

/** Architectural rank decides proportions, colour scheme and ornament. */
export type HanokRank = "palace" | "temple" | "house" | "thatched";
export type TreeMix = {
  pine: number;
  broad: number;
  tall: number;
  bamboo?: number;
  /** Share of peach blossom, red maple and ginkgo (0–0.4). */
  blossom?: number;
  maple?: number;
  ginkgo?: number;
};
export type PlaceStyle = {
  /** Classifies one footprint; null keeps a contemporary building. */
  traditional: (
    b: GeoBuilding,
    c: { x: number; z: number; area: number },
    data: GeoSceneData,
  ) => HanokRank | null;
  trees: TreeMix;
  /** Korean hills are mostly wooded even where land cover is missing. */
  inferForest: boolean;
  forestDensity: number;
  /** OSM "sand" means beaches on the coast but gravel courtyards in palaces. */
  sandIsBeach: boolean;
  drift: "petals" | "maple" | "ginkgo" | "seeds";
  grassTint: string;
  rural: boolean;
  lanterns: "street" | "temple" | "none";
  /** Gravel (마사토) yards around traditional buildings, in metres. */
  courtBuffer: number;
  /** 돌담 along village lanes. */
  walls?: "tile" | "earth";
  /** Render every nearby footprint as a traditional building (연출). */
  ancient: boolean;
  /** Vertical exaggeration of the scenery beyond the walkable area. */
  relief: number;
  /** Granite or limestone pinnacles placed on the distant ridges. */
  pinnacles: number;
  /** A waterfall set piece on the nearest steep slope. */
  waterfall: boolean;
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const near = (
  data: GeoSceneData,
  c: { x: number; z: number },
  test: (p: GeoSceneData["pois"][number]) => boolean,
  radius: number,
) =>
  data.pois.some((p) => test(p) && Math.hypot(p.x - c.x, p.z - c.z) < radius);

const base: PlaceStyle = {
  traditional: () => null,
  trees: { pine: 0.45, broad: 0.55, tall: 0 },
  inferForest: true,
  forestDensity: 1,
  sandIsBeach: false,
  drift: "seeds",
  grassTint: "#ffffff",
  rural: true,
  lanterns: "none",
  courtBuffer: 0,
  ancient: true,
  relief: 1.8,
  pinnacles: 0,
  waterfall: false,
};

export const placeStyles: Record<string, Partial<PlaceStyle>> = {
  // Gyeongbokgung occupies the block around the centre; the city wraps it.
  palace: {
    traditional: (b, c) =>
      c.x > -250 && c.x < 270 && c.z > -620 && c.z < 430 && b.height <= 12
        ? "palace"
        : null,
    trees: { pine: 0.7, broad: 0.3, tall: 0, blossom: 0.18, maple: 0.1 },
    drift: "petals",
    rural: false,
    lanterns: "street",
    courtBuffer: 18,
  },
  jeonju: {
    traditional: (b, c) =>
      Math.hypot(c.x + 40, c.z) < 470 && b.height <= 8 && c.area < 900
        ? Math.hypot(c.x + 289, c.z + 72) < 70
          ? "palace"
          : "house"
        : null,
    trees: {
      pine: 0.35,
      broad: 0.65,
      tall: 0,
      bamboo: 0.15,
      ginkgo: 0.2,
      blossom: 0.1,
    },
    drift: "ginkgo",
    rural: false,
    lanterns: "street",
    courtBuffer: 5,
    walls: "tile",
  },
  andong: {
    traditional: (b, c) =>
      c.area < 62 || (c.area < 95 && hash(b.id) < 0.45) ? "thatched" : "house",
    trees: {
      pine: 0.6,
      broad: 0.4,
      tall: 0,
      bamboo: 0.18,
      maple: 0.18,
      ginkgo: 0.08,
    },
    drift: "maple",
    lanterns: "none",
    courtBuffer: 4,
    walls: "earth",
  },
  bulguksa: {
    traditional: (_b, c, data) =>
      near(
        data,
        c,
        (p) => p.name === "불국사" && p.subclass !== "bus_stop",
        260,
      )
        ? "temple"
        : null,
    trees: {
      pine: 0.55,
      broad: 0.45,
      tall: 0,
      bamboo: 0.1,
      maple: 0.3,
      blossom: 0.06,
    },
    forestDensity: 1.25,
    drift: "maple",
    lanterns: "temple",
    relief: 2,
    pinnacles: 8,
    waterfall: true,
    courtBuffer: 12,
  },
  busan: {
    traditional: (_b, c, data) =>
      near(data, c, (p) => p.name === "해동용궁사", 150) ? "temple" : null,
    trees: { pine: 0.8, broad: 0.2, tall: 0, bamboo: 0.12, blossom: 0.16 },
    sandIsBeach: true,
    drift: "petals",
    lanterns: "temple",
    courtBuffer: 8,
  },
  suwon: {
    traditional: (_b, c, data) =>
      near(
        data,
        c,
        (p) =>
          p.class === "castle" ||
          (/문|루|돈|대$/.test(p.name) && p.subclass !== "bus_stop"),
        28,
      )
        ? "palace"
        : null,
    trees: { pine: 0.5, broad: 0.5, tall: 0, blossom: 0.2, maple: 0.06 },
    drift: "petals",
    rural: false,
    lanterns: "street",
  },
  seorak: {
    traditional: () => "temple",
    relief: 1.5,
    pinnacles: 22,
    waterfall: true,
    trees: { pine: 0.55, broad: 0.45, tall: 0, maple: 0.34, ginkgo: 0.06 },
    forestDensity: 1.4,
    drift: "maple",
  },
  seongsan: {
    trees: { pine: 0.9, broad: 0.1, tall: 0, blossom: 0.06 },
    inferForest: false,
    forestDensity: 0.5,
    sandIsBeach: true,
    grassTint: "#f4ffe8",
  },
  suncheon: {
    trees: { pine: 0.6, broad: 0.4, tall: 0, maple: 0.08 },
    sandIsBeach: true,
    grassTint: "#fff2d6",
  },
  boseong: {
    trees: { pine: 0.3, broad: 0.2, tall: 0.5, blossom: 0.08 },
    forestDensity: 1.2,
  },
  nami: {
    trees: { pine: 0.15, broad: 0.4, tall: 0.45, ginkgo: 0.32, maple: 0.12 },
    drift: "ginkgo",
  },
  danyang: {
    trees: {
      pine: 0.6,
      broad: 0.4,
      tall: 0,
      bamboo: 0.12,
      maple: 0.2,
      blossom: 0.08,
    },
    relief: 2.2,
    pinnacles: 16,
    waterfall: true,
    forestDensity: 1.2,
    drift: "maple",
  },
};

export function styleFor(id: string): PlaceStyle {
  return { ...base, ...placeStyles[id] };
}
