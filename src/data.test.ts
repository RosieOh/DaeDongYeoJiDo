import { describe, expect, it } from "vitest";
import { filterPlaces, places } from "./data";
describe("여행지 탐색", () => {
  it("지역, 테마, 검색어를 함께 적용한다", () => {
    const results = filterPlaces(
      places,
      "고궁",
      "서울·경기",
      "역사와 문화",
      false,
      [],
    );
    expect(results.map((p) => p.id)).toEqual(["palace"]);
  });
  it("공백을 제거하고 태그로 검색한다", () => {
    expect(
      filterPlaces(places, "  세계유산  ", "전국", "전체", false, []).map(
        (p) => p.id,
      ),
    ).toEqual(["bulguksa", "suwon", "andong"]);
  });
  it("저장한 장소에만 필터를 적용한다", () => {
    expect(
      filterPlaces(places, "", "전국", "전체", true, ["seorak", "palace"]).map(
        (p) => p.id,
      ),
    ).toEqual(["seorak", "palace"]);
    expect(filterPlaces(places, "", "강원", "전체", true, ["palace"])).toEqual(
      [],
    );
  });
  it("검색 결과가 없으면 빈 목록을 반환한다", () => {
    expect(
      filterPlaces(places, "없는여행지", "전국", "전체", false, []),
    ).toEqual([]);
  });
  it("지도 데이터의 식별자가 고유하고 좌표가 대한민국 범위 안에 있다", () => {
    expect(new Set(places.map((p) => p.id)).size).toBe(places.length);
    for (const p of places) {
      expect(p.coordinates[0]).toBeGreaterThan(124);
      expect(p.coordinates[0]).toBeLessThan(132);
      expect(p.coordinates[1]).toBeGreaterThan(33);
      expect(p.coordinates[1]).toBeLessThan(39);
    }
  });
});
