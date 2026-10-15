import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { places } from "../data";
import {
  findSpawn,
  geoBlocked,
  moveInGeoWorld,
  pointInPolygon,
  terrainHeight,
  toCoordinates,
  validateGeoScene,
} from "./geo";
import type { GeoSceneData, GeoPolygon } from "./geo";
import { nearestStop } from "./world";
const square: GeoPolygon = {
  rings: [
    [
      [1, -4],
      [3, -4],
      [3, 4],
      [1, 4],
      [1, -4],
    ],
  ],
};
const data: GeoSceneData = {
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
  buildings: [{ ...square, id: "wall", height: 5, name: "" }],
  roads: [],
  water: [],
  cover: [],
  pois: [],
  terrain: { extent: 900, size: 2, heights: [0, 0, 0, 0] },
};
describe("GIS 공간의 이동과 좌표", () => {
  it("빠른 이동도 실제 건물 윤곽을 관통하지 않는다", () => {
    const p = moveInGeoWorld(data, 0, 0, 40, 2);
    expect(p.x).toBeLessThan(0.61);
    expect(p.z).toBeCloseTo(2);
  });
  it("건물 중정과 다각형 구멍은 막지 않는다", () => {
    const p = {
      rings: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    } as GeoPolygon;
    expect(pointInPolygon(5, 5, p)).toBe(false);
    expect(pointInPolygon(1, 1, p)).toBe(true);
  });
  it("수면과 영역 경계를 막고 지도에 있는 교량은 허용한다", () => {
    const d = { ...data, buildings: [], water: [square] };
    expect(geoBlocked(d, 2, 0)).toBe(true);
    expect(
      geoBlocked(
        {
          ...d,
          roads: [
            {
              id: "bridge",
              points: [
                [-5, 0],
                [5, 0],
              ],
              class: "path",
              subclass: "footway",
              bridge: true,
              name: "",
            },
          ],
        },
        2,
        0,
      ),
    ).toBe(false);
    expect(geoBlocked(d, 450, 0)).toBe(true);
  });
  it("지형을 보간하고 실제 경위도로 변환한다", () => {
    expect(
      terrainHeight(
        {
          ...data,
          terrain: { extent: 100, size: 2, heights: [0, 10, 20, 30] },
        },
        0,
        0,
      ),
    ).toBe(15);
    expect(toCoordinates(data, 0, 0)).toEqual([127, 36]);
    expect(toCoordinates(data, 100, 0)[0]).toBeGreaterThan(127);
  });
  it("명소 근처에서만 기록한다", () => {
    const stop = {
      id: "origin",
      name: "시작",
      subtitle: "",
      x: 0,
      z: 0,
      description: "",
    };
    expect(nearestStop(20, 0, [stop])).toBeNull();
    expect(nearestStop(2, 0, [stop])).toBe(stop);
  });
  for (const place of places)
    it(`${place.name}: 데이터·출발점·이동 검증`, () => {
      const scene = JSON.parse(
        readFileSync(
          new URL(`../../public/geo/${place.id}.json`, import.meta.url),
          "utf8",
        ),
      ) as GeoSceneData;
      expect(validateGeoScene(scene)).toBe(true);
      expect(scene.center).toEqual(place.coordinates);
      expect(scene.terrain.heights.every((h) => h >= 0 && h < 2200)).toBe(true);
      expect(scene.roads.length).toBeGreaterThan(0);
      const spawn = findSpawn(scene);
      expect(geoBlocked(scene, spawn.x, spawn.z)).toBe(false);
      const next = moveInGeoWorld(
        scene,
        spawn.x,
        spawn.z,
        -Math.sin(spawn.heading) * 3,
        -Math.cos(spawn.heading) * 3,
      );
      expect(Math.hypot(next.x - spawn.x, next.z - spawn.z)).toBeGreaterThan(1);
    });
});
