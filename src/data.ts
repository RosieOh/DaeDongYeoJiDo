export type Category =
  "전체" | "산과 자연" | "바다와 섬" | "역사와 문화" | "도시와 마을";
export type Place = {
  id: string;
  name: string;
  region: string;
  area: string;
  category: Category;
  coordinates: [number, number];
  subtitle: string;
  description: string;
  tags: string[];
  image: string;
  season: string;
  tip: string;
  zoom: number;
};
export const places: Place[] = [
  {
    id: "seorak",
    name: "설악산",
    region: "강원",
    area: "강원특별자치도 속초시",
    category: "산과 자연",
    coordinates: [128.4656, 38.1192],
    subtitle: "겹겹이 펼쳐지는, 산의 시간",
    description:
      "날카로운 암봉과 깊은 계곡이 빚어낸 풍경. 계절마다 다른 빛으로 물드는 설악산에서 일상의 속도를 잠시 내려놓아 보세요. 멀리 바라보아도, 천천히 걸어도 저마다의 아름다움을 만날 수 있습니다.",
    tags: ["국립공원", "단풍 여행", "트레킹"],
    image: "seorak",
    season: "가을 · 단풍이 물드는 계절",
    tip: "산행 코스에 따라 난이도가 크게 달라요. 출발 전 국립공원 탐방로 통제 정보를 확인해 주세요.",
    zoom: 11.2,
  },
  {
    id: "palace",
    name: "경복궁",
    region: "서울·경기",
    area: "서울특별시 종로구",
    category: "역사와 문화",
    coordinates: [126.977, 37.5796],
    subtitle: "도심 한가운데, 조선의 첫 풍경",
    description:
      "북악산을 배경으로 단정하게 펼쳐진 궁궐의 지붕선. 광화문을 지나 마당과 전각 사이를 걷다 보면 서울의 오래된 이야기가 가까워집니다.",
    tags: ["고궁 산책", "한복", "건축"],
    image: "palace",
    season: "봄 · 가을, 걷기 좋은 날",
    tip: "휴궁일과 특별 관람 일정은 궁능유적본부의 공식 안내에서 확인해 주세요.",
    zoom: 15,
  },
  {
    id: "seongsan",
    name: "성산일출봉",
    region: "제주",
    area: "제주특별자치도 서귀포시",
    category: "바다와 섬",
    coordinates: [126.9425, 33.4584],
    subtitle: "바다 위로 솟아오른 제주의 아침",
    description:
      "푸른 바다를 향해 펼쳐지는 거대한 화산의 흔적. 분화구를 감싼 능선과 해안의 곡선을 따라 제주의 특별한 지형을 만나 보세요.",
    tags: ["제주 여행", "일출 명소", "화산 지형"],
    image: "seongsan",
    season: "사계절 · 맑은 날의 이른 아침",
    tip: "해안에는 바람이 강할 수 있어요. 일출을 보려면 방문일의 탐방 가능 시간을 미리 확인해 주세요.",
    zoom: 13.5,
  },
  {
    id: "bulguksa",
    name: "불국사",
    region: "경상",
    area: "경상북도 경주시",
    category: "역사와 문화",
    coordinates: [129.332, 35.79],
    subtitle: "돌에 새겨진, 천년의 마음",
    description:
      "정교한 돌계단과 고요한 전각에 신라의 미감이 남아 있습니다. 토함산 자락을 따라 오래된 건축과 주변 자연이 함께 만드는 풍경을 느껴 보세요.",
    tags: ["세계유산", "사찰 여행", "신라"],
    image: "bulguksa",
    season: "봄 · 가을",
    tip: "예불과 다른 방문객을 배려하며 조용히 둘러보세요.",
    zoom: 14,
  },
  {
    id: "jeonju",
    name: "전주 한옥마을",
    region: "전라",
    area: "전북특별자치도 전주시",
    category: "도시와 마을",
    coordinates: [127.153, 35.815],
    subtitle: "골목마다 머무는, 다정한 옛 멋",
    description:
      "낮은 기와지붕 사이로 이어지는 골목, 작은 공방과 찻집. 한옥마을의 느린 리듬을 따라 걷고 전주의 다채로운 맛을 만나 보세요.",
    tags: ["한옥", "골목 산책", "미식 여행"],
    image: "jeonju",
    season: "사계절 · 평일 오전의 산책",
    tip: "주민이 생활하는 공간도 함께 있어요. 골목을 산책할 때 소음을 줄여 주세요.",
    zoom: 14.5,
  },
  {
    id: "suncheon",
    name: "순천만 습지",
    region: "전라",
    area: "전라남도 순천시",
    category: "산과 자연",
    coordinates: [127.508, 34.885],
    subtitle: "바람이 지나간 자리, 황금빛 갈대",
    description:
      "물길이 굽이치는 갯벌과 넓은 갈대밭이 만나는 곳. 나무 데크를 따라 걷다가 잠시 멈추면 바람과 철새가 들려주는 습지의 소리가 들립니다.",
    tags: ["갈대밭", "생태 여행", "노을"],
    image: "suncheon",
    season: "가을 · 겨울",
    tip: "새를 놀라게 하지 않도록 조용히 관찰해 주세요. 망원경을 챙기면 더 좋아요.",
    zoom: 12.5,
  },
  {
    id: "boseong",
    name: "보성 녹차밭",
    region: "전라",
    area: "전라남도 보성군",
    category: "산과 자연",
    coordinates: [127.081, 34.714],
    subtitle: "초록의 물결 사이를 걷다",
    description:
      "산비탈을 따라 가지런히 이어지는 차나무의 곡선. 싱그러운 차 향과 숲길의 그늘을 즐기며 잠시 숨을 고르는 여행을 떠나 보세요.",
    tags: ["차밭", "초록 여행", "사진 명소"],
    image: "boseong",
    season: "봄 · 여름",
    tip: "차밭의 경사 구간에는 편한 운동화를 추천해요.",
    zoom: 13,
  },
  {
    id: "busan",
    name: "해동용궁사",
    region: "경상",
    area: "부산광역시 기장군",
    category: "역사와 문화",
    coordinates: [129.223, 35.188],
    subtitle: "파도 곁에 내려앉은 사찰",
    description:
      "바위를 두드리는 파도 소리와 처마 끝의 풍경 소리가 겹쳐지는 곳. 동해를 바라보는 사찰의 길을 걸으며 바다와 건축이 만나는 풍경을 발견해 보세요.",
    tags: ["바다 사찰", "부산 여행", "해안 산책"],
    image: "busan",
    season: "사계절",
    tip: "계단이 많은 코스예요. 비가 오는 날에는 미끄럼에 주의해 주세요.",
    zoom: 14,
  },
  {
    id: "nami",
    name: "남이섬",
    region: "강원",
    area: "강원특별자치도 춘천시",
    category: "바다와 섬",
    coordinates: [127.525, 37.791],
    subtitle: "나무 사이, 나만의 한 장면",
    description:
      "강물에 둘러싸인 섬에는 나무가 만든 길이 이어집니다. 메타세쿼이아 길과 강변 산책로에서 계절이 바꾸어 놓은 풍경을 천천히 찾아보세요.",
    tags: ["숲길", "섬 산책", "가족 여행"],
    image: "nami",
    season: "가을 · 겨울",
    tip: "선박 운항과 입장 안내는 방문 전 공식 홈페이지에서 확인해 주세요.",
    zoom: 13,
  },
  {
    id: "suwon",
    name: "수원화성",
    region: "서울·경기",
    area: "경기도 수원시",
    category: "역사와 문화",
    coordinates: [127.009, 37.288],
    subtitle: "성곽을 따라 이어지는 오늘의 산책",
    description:
      "도시의 일상과 옛 성곽이 나란히 이어집니다. 성문과 누각을 따라 걸으며 높은 곳에서는 수원의 풍경을, 골목에서는 작은 가게들을 발견해 보세요.",
    tags: ["세계유산", "성곽길", "도시 산책"],
    image: "suwon",
    season: "봄 · 가을",
    tip: "성곽을 모두 돌기보다 체력에 맞게 구간을 골라 걸어보세요.",
    zoom: 14,
  },
  {
    id: "danyang",
    name: "도담삼봉",
    region: "충청",
    area: "충청북도 단양군",
    category: "산과 자연",
    coordinates: [128.343, 37.0],
    subtitle: "강물에 그린 한 폭의 산수화",
    description:
      "남한강 한가운데 우뚝 선 세 개의 봉우리. 물안개와 잔잔한 강물이 어우러져 오래된 산수화 같은 장면을 만들어 냅니다.",
    tags: ["남한강", "풍경 여행", "단양팔경"],
    image: "danyang",
    season: "사계절 · 이른 아침",
    tip: "강변 산책과 인근 전망 공간을 함께 둘러보면 풍경을 여러 각도에서 만날 수 있어요.",
    zoom: 13,
  },
  {
    id: "andong",
    name: "안동 하회마을",
    region: "경상",
    area: "경상북도 안동시",
    category: "도시와 마을",
    coordinates: [128.518, 36.539],
    subtitle: "강이 감싸 안은, 오래된 삶의 풍경",
    description:
      "낙동강이 마을을 감싸 흐르고 기와집과 초가가 골목을 이루는 곳. 지금도 이어지는 마을의 일상을 존중하며 한국의 전통적인 공간을 만나 보세요.",
    tags: ["세계유산", "전통 마을", "낙동강"],
    image: "andong",
    season: "봄 · 가을",
    tip: "실제 거주하는 가옥은 관람 가능 여부를 확인하고 방문해 주세요.",
    zoom: 13.5,
  },
];
export const regions = [
  "전국",
  "서울·경기",
  "강원",
  "충청",
  "전라",
  "경상",
  "제주",
];
export function filterPlaces(
  list: Place[],
  query: string,
  region: string,
  category: Category,
  savedOnly: boolean,
  saved: string[],
) {
  const term = query.trim().toLowerCase();
  return list.filter(
    (p) =>
      (region === "전국" || p.region === region) &&
      (category === "전체" || p.category === category) &&
      (!savedOnly || saved.includes(p.id)) &&
      (!term ||
        [p.name, p.area, p.category, ...p.tags]
          .join(" ")
          .toLowerCase()
          .includes(term)),
  );
}
export function readSaved(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem("daedong:saved") || "[]",
    );
    return Array.isArray(value)
      ? value.filter(
          (id): id is string =>
            typeof id === "string" && places.some((p) => p.id === id),
        )
      : [];
  } catch {
    return [];
  }
}
