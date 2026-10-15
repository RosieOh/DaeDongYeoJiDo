import { describe, expect, it } from "vitest";
import type { GeoBuilding, GeoSceneData } from "./geo";
import { pointInPolygon } from "./geo";
import { MAX_QI, Motion } from "./motion";

const square = (x0: number, z0: number, x1: number, z1: number) => [
  [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
    [x0, z0],
  ] as [number, number][],
];
const wall: GeoBuilding = {
  id: "wall",
  name: "",
  height: 2,
  rings: square(4, -10, 10, 10),
};
const house: GeoBuilding = {
  id: "house",
  name: "",
  height: 6,
  rings: square(-20, -5, -10, 5),
};
const pond = { rings: square(14, -10, 34, 10) };
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
  buildings: [wall, house],
  roads: [],
  water: [pond],
  cover: [],
  pois: [],
  terrain: { extent: 900, size: 2, heights: [0, 0, 0, 0] },
};
const world = (x = 0, z = 0) =>
  new Motion(
    {
      data,
      // Terrain is carved below the water surface, as in HeightField.
      heightAt: (px, pz) => (pointInPolygon(px, pz, pond) ? -2 : 0),
      // A gabled roof: 6 m at the ridge, falling to 4 m at the eaves.
      surfaceAt: (b, px) => (b === wall ? 2 : 6 - Math.abs(px + 15) * 0.4),
      waterAt: (px, pz) => (pointInPolygon(px, pz, pond) ? -0.2 : null),
    },
    x,
    z,
  );
const step = (m: Motion, seconds: number, dx = 0, dz = 0, sprint = false) => {
  const l = Math.hypot(dx, dz) || 1;
  for (let t = 0; t < seconds; t += 1 / 60)
    m.update(1 / 60, {
      dx: dx / 60,
      dz: dz / 60,
      fx: dx / l || 1,
      fz: dz / l,
      sprint,
    });
};

describe("경공 이동", () => {
  it("석축은 걸어서 오르지 못하지만 뛰어올라 그 위에 선다", () => {
    const walker = world(2, 0);
    step(walker, 1, 4);
    expect(walker.x).toBeLessThan(4);
    const jumper = world(2, 0);
    jumper.jump();
    step(jumper, 0.6, 6);
    jumper.release();
    step(jumper, 1.2);
    expect(jumper.grounded).toBe(true);
    expect(jumper.y).toBeCloseTo(2);
    expect(jumper.x).toBeGreaterThan(4);
  });
  it("세 번까지만 연달아 뛰고 착지하면 다시 뛸 수 있다", () => {
    const m = world();
    for (let i = 0; i < 5; i++) {
      m.jump();
      m.release();
      step(m, 0.1);
    }
    expect(m.jumps).toBe(3);
    expect(m.flips).toBe(2);
    step(m, 3);
    expect(m.grounded).toBe(true);
    expect(m.jumps).toBe(0);
  });
  it("활공하면 천천히 내려온다", () => {
    const glide = world(),
      fall = world();
    for (const m of [glide, fall]) {
      m.jump();
      step(m, 0.6);
    }
    fall.release();
    step(glide, 0.6);
    step(fall, 0.6);
    expect(glide.gliding).toBe(true);
    expect(glide.vy).toBeGreaterThanOrEqual(-1.6);
    expect(glide.y).toBeGreaterThan(fall.y);
  });
  it("지붕 비탈에 내려앉아 기와를 따라 걷는다", () => {
    const m = world(-15, 0);
    m.y = 8;
    m.grounded = false;
    step(m, 1);
    expect(m.grounded).toBe(true);
    expect(m.y).toBeCloseTo(6, 1);
    step(m, 0.5, 4);
    expect(m.y).toBeLessThan(6);
    expect(m.y).toBeGreaterThan(3.9);
  });
  it("물에 걸어 들어가지 못하지만 뛰어서 수면 위를 달린다", () => {
    const walker = world(12, 0);
    step(walker, 1, 6);
    expect(walker.x).toBeLessThan(14);
    const skimmer = world(12, 0);
    skimmer.jump();
    skimmer.release();
    step(skimmer, 1.2, 6);
    expect(skimmer.grounded).toBe(true);
    expect(skimmer.onWater).toBe(true);
    expect(skimmer.y).toBeCloseTo(-0.2);
    step(skimmer, 1, 6);
    expect(skimmer.x).toBeGreaterThan(20);
  });
  it("비연은 바라보는 방향으로 순식간에 몸을 날린다", () => {
    const m = world(-40, 30);
    const start = m.x;
    expect(m.dash(1, 0)).toBe(true);
    step(m, 0.32);
    expect(m.x - start).toBeGreaterThan(5);
    expect(m.qi).toBeLessThan(MAX_QI);
    // Cooling down: a second dash right away fails.
    expect(m.dash(1, 0)).toBe(false);
    step(m, 2);
    expect(m.grounded).toBe(true);
  });
  it("제운종으로 높이 솟구친 뒤 바람을 타고 내려온다", () => {
    const m = world(-40, 30);
    expect(m.soar(1, 0)).toBe(true);
    step(m, 0.9);
    expect(m.y).toBeGreaterThan(12);
    step(m, 0.6);
    expect(m.gliding).toBe(true);
    expect(m.vy).toBeGreaterThanOrEqual(-1.6);
  });
  it("천근추는 곧장 내리꽂히고 떨어진 높이를 알린다", () => {
    const m = world(-40, 30);
    m.soar(1, 0);
    step(m, 0.9);
    const height = m.y;
    expect(m.plunge()).toBe(true);
    let plunged = 0;
    for (let t = 0; t < 2 && !plunged; t += 1 / 60) {
      m.update(1 / 60, { dx: 0, dz: 0, fx: 1, fz: 0, sprint: false });
      plunged = m.consume().plunged;
    }
    expect(plunged).toBeGreaterThan(height * 0.8);
    expect(m.grounded).toBe(true);
  });
  it("벽호공으로 벽을 달려 올라 지붕 위에 선다", () => {
    const m = world(-22, 0);
    m.jump();
    m.release();
    step(m, 1.5, 6);
    expect(m.grounded).toBe(true);
    expect(m.x).toBeGreaterThan(-20);
    expect(m.y).toBeGreaterThan(3.5);
  });
  it("기력이 모자라면 경공을 펼치지 못하고 땅에서 회복한다", () => {
    const m = world(-40, 30);
    m.qi = 10;
    expect(m.soar(1, 0)).toBe(false);
    expect(m.consume().failed).toBe("qi");
    step(m, 2);
    expect(m.qi).toBeGreaterThan(50);
  });
  it("달리면 물 위로 곧장 달려 나간다", () => {
    const m = world(12, 0);
    step(m, 1, 6, 0, true);
    expect(m.x).toBeGreaterThan(15);
    expect(m.onWater).toBe(true);
    expect(m.y).toBeCloseTo(-0.2);
  });
});
