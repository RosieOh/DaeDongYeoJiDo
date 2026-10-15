import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { places } from "../data";
import { decompose } from "./buildings";
import type { GeoSceneData } from "./geo";
import { findSpawn, terrainHeight } from "./geo";
import { unitHeight, upperStorey } from "./hanok";
import { styleFor } from "./placeStyles";
import { HeightField, sampleSmooth } from "./terrain";

const flat = (overrides: Partial<GeoSceneData> = {}): GeoSceneData => ({
  version: 1,
  id: "test",
  name: "test",
  center: [127, 36],
  extent: 450,
  source: {
    vector: "",
    dem: "",
    retrievedAt: "",
    attribution: "",
    license: "",
  },
  buildings: [],
  roads: [],
  water: [],
  cover: [],
  pois: [],
  terrain: {
    extent: 900,
    size: 3,
    heights: [10, 10, 10, 10, 10, 10, 10, 10, 10],
  },
  ...overrides,
});
const load = (id: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../public/geo/${id}.json`, import.meta.url),
      "utf8",
    ),
  ) as GeoSceneData;

describe("정밀 지형", () => {
  it("보간한 높이가 원본 격자점을 그대로 지난다", () => {
    const heights = [0, 5, 9, 3, 7, 2, 8, 1, 6];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++)
        expect(
          sampleSmooth(heights, 3, 100, -100 + i * 100, -100 + j * 100),
        ).toBeCloseTo(heights[j * 3 + i]);
  });
  it("렌더링 표면과 발 높이가 같은 함수를 쓴다", () => {
    const data = load("bulguksa");
    const spawn = findSpawn(data);
    const field = new HeightField(
      data,
      terrainHeight(data, spawn.x, spawn.z),
      128,
      false,
    );
    // Vertices of the mesh are exactly the stored heights.
    const n = field.n;
    expect(
      field.groundAt(-900 + 5 * field.step, -900 + 7 * field.step),
    ).toBeCloseTo(field.heights[7 * n + 5]);
    // The spawn ground stays close to the original DEM.
    expect(Math.abs(field.groundAt(spawn.x, spawn.z))).toBeLessThan(2);
  });
  it("물 아래 지형을 파내고 교량은 수면 위에 둔다", () => {
    const water = {
      rings: [
        [
          [-20, -50],
          [20, -50],
          [20, 50],
          [-20, 50],
          [-20, -50],
        ] as [number, number][],
      ],
    };
    const data = flat({
      water: [water],
      roads: [
        {
          id: "b",
          points: [
            [-40, 0],
            [40, 0],
          ],
          class: "minor",
          subclass: "",
          bridge: true,
          name: "",
        },
      ],
    });
    const field = new HeightField(data, 10, 90, false);
    const level = field.waterLevels[0].level;
    expect(field.groundAt(0, 30)).toBeLessThan(level);
    expect(field.heightAt(0, 0)).toBeGreaterThan(level + 1);
    expect(field.heightAt(0, 30)).toBe(field.groundAt(0, 30));
  });
  it("연출된 산세는 걷는 구역을 그대로 두고 가장자리부터 높인다", () => {
    const data = load("seorak");
    const spawn = findSpawn(data);
    const base = terrainHeight(data, spawn.x, spawn.z);
    const plain = new HeightField(data, base, 96, false, 1);
    const dramatic = new HeightField(data, base, 96, false, 2);
    // Inside the walkable square nothing moves.
    expect(dramatic.groundAt(spawn.x, spawn.z)).toBeCloseTo(
      plain.groundAt(spawn.x, spawn.z),
    );
    expect(dramatic.groundAt(300, -300)).toBeCloseTo(plain.groundAt(300, -300));
    // At the edge, ground above the valley floor doubles.
    const edge = plain.groundAt(-880, 0);
    if (edge > plain.pivot)
      expect(dramatic.groundAt(-880, 0) - dramatic.pivot).toBeCloseTo(
        (edge - plain.pivot) * 2,
        0,
      );
    expect(dramatic.exaggerate(plain.pivot - 5, 900)).toBe(plain.pivot - 5);
  });
  it("12곳 모두 원경 고도를 가진다", () => {
    for (const place of places) {
      const data = load(place.id);
      expect(data.far?.heights.length).toBe((data.far?.size ?? 0) ** 2);
      expect(data.far!.extent).toBeGreaterThan(data.terrain.extent * 10);
    }
  });
});

describe("전통 건축 생성", () => {
  it("직사각형 평면은 하나의 칸으로 남긴다", () => {
    const rects = decompose(
      {
        rings: [
          [
            [0, 0],
            [12, 0],
            [12, 7],
            [0, 7],
            [0, 0],
          ],
        ],
      },
      0,
    );
    expect(rects).toHaveLength(1);
    expect(rects[0].w).toBeCloseTo(12, 0);
    expect(rects[0].d).toBeCloseTo(7, 0);
  });
  it("ㄱ자 평면은 지붕이 겹치는 두 칸으로 나눈다", () => {
    const rects = decompose(
      {
        rings: [
          [
            [0, 0],
            [14, 0],
            [14, 5],
            [5, 5],
            [5, 13],
            [0, 13],
            [0, 0],
          ],
        ],
      },
      0,
    );
    expect(rects).toHaveLength(2);
    const area = rects.reduce((a, r) => a + r.w * r.d, 0);
    expect(area).toBeGreaterThan(14 * 5 + 5 * 8 - 1);
  });
  it("지붕은 기둥보다 높고 큰 전각은 중층으로 올린다", () => {
    const unit = {
      W: 30,
      D: 21,
      rank: "palace" as const,
      roof: "paljak" as const,
      front: 1 as const,
      platform: 1,
      seed: 1,
    };
    expect(unitHeight(unit)).toBeGreaterThan(8);
    expect(upperStorey(unit)).not.toBeNull();
    expect(upperStorey({ ...unit, rank: "house" })).toBeNull();
  });
  it("장소별 양식을 실제 위치로 구분한다", () => {
    const palace = styleFor("palace");
    const data = load("palace");
    const b = { id: "x", name: "", height: 5, rings: [] };
    expect(palace.traditional(b, { x: 0, z: 0, area: 200 }, data)).toBe(
      "palace",
    );
    expect(palace.traditional(b, { x: 600, z: 0, area: 200 }, data)).toBeNull();
    expect(
      styleFor("andong").traditional(
        b,
        { x: 0, z: 0, area: 40 },
        load("andong"),
      ),
    ).toBe("thatched");
  });
});
