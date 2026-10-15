import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  ExternalLink,
  Leaf,
  MapPin,
  Mountain,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trees,
  Waves,
  X,
  Landmark,
  Building2,
  Route,
  Info,
  Footprints,
} from "lucide-react";
const MapView = lazy(() => import("./components/MapView"));
const Journey = lazy(() => import("./components/Journey"));
import { filterPlaces, places, readSaved, regions } from "./data";
import type { Category, Place } from "./data";
import { asset } from "./asset";
const categories: { name: Category; icon: typeof Mountain }[] = [
  { name: "전체", icon: Compass },
  { name: "산과 자연", icon: Mountain },
  { name: "바다와 섬", icon: Waves },
  { name: "역사와 문화", icon: Landmark },
  { name: "도시와 마을", icon: Building2 },
];
type Credit = {
  id: string;
  title: string;
  source: string;
  artist?: string;
  license?: string;
  licenseUrl?: string;
};
function PlaceImage({
  place,
  className = "",
}: {
  place: Place;
  className?: string;
}) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [place.id]);
  return error ? (
    <div className={`illustrated-place ${className}`}>
      <Mountain size={70} strokeWidth={0.7} />
      <span>{place.name}</span>
      <small>풍경 일러스트</small>
    </div>
  ) : (
    <img
      className={className}
      src={asset(`images/${place.image}.jpg`)}
      alt={`${place.name} 풍경`}
      loading="lazy"
      onError={() => setError(true)}
    />
  );
}
function App() {
  const [page, setPage] = useState(() => window.location.hash);
  useEffect(() => {
    const change = () => setPage(window.location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const inJourney = page.startsWith("#/journey");
  const journeyPlace =
    places.find((p) => p.id === page.split("/")[2]) ||
    places.find((p) => p.id === "jeonju")!;
  const [category, setCategory] = useState<Category>("전체"),
    [region, setRegion] = useState("전국"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Place | null>(null),
    [saved, setSaved] = useState<string[]>(readSaved),
    [savedOnly, setSavedOnly] = useState(false),
    [is3D, setIs3D] = useState(true),
    [resetKey, setResetKey] = useState(0),
    [touring, setTouring] = useState(false),
    [toast, setToast] = useState(""),
    [creditsOpen, setCreditsOpen] = useState(false),
    [credits, setCredits] = useState<Credit[]>([]),
    [sort, setSort] = useState("추천순"),
    [mobileView, setMobileView] = useState<"list" | "map">("map");
  const closeRef = useRef<HTMLButtonElement>(null),
    modalRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const list = filterPlaces(
      places,
      query,
      region,
      category,
      savedOnly,
      saved,
    );
    return sort === "이름순"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"))
      : list;
  }, [query, region, category, savedOnly, saved, sort]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    fetch(asset("images/credits.json"))
      .then((r) => r.json())
      .then(setCredits)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (selected) closeRef.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    if (!selected && !creditsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setTouring(false);
        setCreditsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, creditsOpen]);
  useEffect(() => {
    if (!creditsOpen) return;
    const previous = document.activeElement as HTMLElement;
    modalRef.current?.querySelector("button")?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items =
        modalRef.current?.querySelectorAll<HTMLElement>("button,a[href]");
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [creditsOpen]);
  useEffect(() => {
    if (!touring) return;
    const t = setInterval(() => {
      setSelected((p) => {
        const index = filtered.findIndex((x) => x.id === p?.id);
        return filtered[(index + 1) % filtered.length] || null;
      });
    }, 14000);
    return () => clearInterval(t);
  }, [touring, filtered]);
  const select = (p: Place) => {
    setSelected(p);
    setTouring(false);
    setMobileView("map");
  };
  const toggleSaved = (p: Place) => {
    const exists = saved.includes(p.id),
      next = exists ? saved.filter((id) => id !== p.id) : [...saved, p.id];
    setSaved(next);
    try {
      localStorage.setItem("daedong:saved", JSON.stringify(next));
      setToast(
        exists
          ? "저장한 여행지에서 삭제했어요"
          : `${p.name}, 나의 여행지도에 담았어요`,
      );
    } catch {
      setToast("이 브라우저에서는 저장이 제한되어 이번 방문 동안만 유지돼요.");
    }
  };
  const clearSelection = () => {
    setSelected(null);
    setTouring(false);
  };
  const reset = () => {
    window.location.hash = "/";
    setRegion("전국");
    setCategory("전체");
    setQuery("");
    setSavedOnly(false);
    clearSelection();
    setResetKey((k) => k + 1);
  };
  const showSaved = (value: boolean) => {
    window.location.hash = "/";
    setSavedOnly(value);
    setRegion("전국");
    setCategory("전체");
    setQuery("");
    clearSelection();
  };
  const enterJourney = (id: string) => {
    clearSelection();
    window.location.hash = `/journey/${id}`;
  };
  const credit = selected ? credits.find((c) => c.id === selected.image) : null;
  return (
    <div className={`app-shell ${inJourney ? "journey-mode" : ""}`}>
      <header className="header">
        <button className="brand" onClick={reset} aria-label="대동여지도 홈">
          <img src={asset("logo.svg")} alt="" />
          <span>
            <strong>
              대동여지도<span className="brand-seal">旅</span>
            </strong>
            <small>DAEDONG YEOJIDO</small>
          </span>
        </button>
        <nav aria-label="주요 메뉴">
          <button
            className={!inJourney && !savedOnly ? "nav-active" : ""}
            onClick={() => showSaved(false)}
          >
            <Compass size={16} />
            지도 탐험
          </button>
          <button
            className={!inJourney && savedOnly ? "nav-active" : ""}
            onClick={() => showSaved(true)}
          >
            <Bookmark size={15} />
            나의 여행지도
            {saved.length > 0 && (
              <span className="saved-count">{saved.length}</span>
            )}
          </button>
          <button
            className={inJourney ? "nav-active" : ""}
            onClick={() => enterJourney("jeonju")}
          >
            <Footprints size={16} />
            여행 시뮬레이션
          </button>
        </nav>
        <div className="header-note">
          <span />
          발길 닿는 곳마다, 새로운 발견
        </div>
        <button
          className="header-bookmark"
          aria-label="저장한 여행지 보기"
          onClick={() => showSaved(true)}
        >
          <Bookmark size={18} />
        </button>
      </header>
      {inJourney ? (
        <Suspense
          fallback={
            <main className="journey-page">
              <div className="map-loading">
                <Compass size={26} />
                여행 공간을 준비하고 있어요
              </div>
            </main>
          }
        >
          <Journey
            place={journeyPlace}
            onPlaceChange={enterJourney}
            onBack={() => showSaved(false)}
          />
        </Suspense>
      ) : (
        <>
          <main>
            <aside
              className={`explore-panel ${mobileView === "list" ? "mobile-visible" : ""}`}
              aria-label="여행지 탐색"
            >
              <div className="panel-intro">
                <div className="eyebrow">
                  <span />
                  {savedOnly ? "YOUR LITTLE ATLAS" : "A JOURNEY THROUGH KOREA"}
                </div>
                <h1>
                  {savedOnly ? (
                    <>
                      마음에 담은 곳,
                      <br />
                      나의 여행지도.
                    </>
                  ) : (
                    <>
                      어디로 떠나볼까요<span>?</span>
                    </>
                  )}
                </h1>
                <p>
                  {savedOnly
                    ? "다음 여행의 시작이 될 장소들을 모았어요."
                    : "익숙한 지도 위, 아직 만나지 못한 우리나라."}
                </p>
                <div className="search-field">
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      clearSelection();
                    }}
                    placeholder="지역, 여행지, 어떤 곳이 궁금한가요?"
                    aria-label="여행지 검색"
                  />
                  {query && (
                    <button
                      aria-label="검색어 지우기"
                      onClick={() => setQuery("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                  <kbd>⌕</kbd>
                </div>
                <div className="region-heading">
                  <span>어느 지역으로 떠날까요?</span>
                  <MapPin size={13} />
                </div>
                <div className="region-filter">
                  {regions.map((r) => (
                    <button
                      key={r}
                      className={region === r ? "active" : ""}
                      aria-pressed={region === r}
                      onClick={() => {
                        setRegion(r);
                        clearSelection();
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="category-filter" aria-label="여행 테마">
                {categories.map(({ name, icon: Icon }) => (
                  <button
                    key={name}
                    className={category === name ? "active" : ""}
                    aria-pressed={category === name}
                    onClick={() => {
                      setCategory(name);
                      clearSelection();
                    }}
                  >
                    <Icon size={21} strokeWidth={1.5} />
                    <span>{name === "전체" ? "모든 여행" : name}</span>
                  </button>
                ))}
              </div>
              <div className="results-header">
                <h2>
                  {savedOnly
                    ? "담아둔 여행지"
                    : query
                      ? "검색한 여행지"
                      : "발견을 기다리는 곳"}
                  <span>{filtered.length}</span>
                </h2>
                <label>
                  <SlidersHorizontal size={12} />
                  <select
                    aria-label="여행지 정렬"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option>추천순</option>
                    <option>이름순</option>
                  </select>
                  <ChevronDown size={12} />
                </label>
              </div>
              <div className="place-list">
                {filtered.length === 0 ? (
                  <div className="empty-state">
                    <MapPin size={32} strokeWidth={1} />
                    <h3>
                      {savedOnly
                        ? "아직 담아둔 여행지가 없어요"
                        : "일치하는 여행지가 없어요"}
                    </h3>
                    <p>
                      {savedOnly
                        ? "마음에 드는 곳의 책갈피를 눌러 보세요."
                        : "다른 검색어나 지역으로 다시 찾아보세요."}
                    </p>
                    <button onClick={reset}>
                      모든 여행지 둘러보기 <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  filtered.map((p, i) => (
                    <article
                      className={`place-card ${selected?.id === p.id ? "selected" : ""}`}
                      key={p.id}
                    >
                      <button
                        className="place-main"
                        onClick={() => select(p)}
                        aria-label={`${p.name} 상세정보 보기`}
                      >
                        <div className="place-photo">
                          <PlaceImage place={p} />
                          {i === 0 && !savedOnly && (
                            <span className="pick-badge">
                              <Sparkles size={10} />
                              추천 여행지
                            </span>
                          )}
                        </div>
                        <div className="place-copy">
                          <span className="place-region">
                            <MapPin size={11} />
                            {p.area}
                          </span>
                          <h3>{p.name}</h3>
                          <p>{p.subtitle}</p>
                          <div className="tags">
                            {p.tags.slice(0, 2).map((t) => (
                              <span key={t}>#{t}</span>
                            ))}
                          </div>
                        </div>
                      </button>
                      <button
                        className={`save-place ${saved.includes(p.id) ? "saved" : ""}`}
                        onClick={() => toggleSaved(p)}
                        aria-label={`${p.name} ${saved.includes(p.id) ? "저장 취소" : "저장"}`}
                        aria-pressed={saved.includes(p.id)}
                      >
                        <Bookmark
                          size={17}
                          fill={saved.includes(p.id) ? "currentColor" : "none"}
                          strokeWidth={1.5}
                        />
                      </button>
                    </article>
                  ))
                )}
              </div>
              <footer className="panel-footer">
                <span>
                  <Leaf size={13} /> 천천히, 깊이 만나는 우리나라
                </span>
                <button
                  onClick={() => setCreditsOpen(true)}
                  aria-label="사진 및 지도 출처"
                >
                  <Info size={15} />
                </button>
              </footer>
            </aside>
            <div
              className={`map-wrapper ${mobileView === "map" ? "mobile-visible" : ""}`}
            >
              <Suspense
                fallback={
                  <div className="map-loading">
                    <Mountain size={25} />
                    <span>우리의 산하를 펼치는 중</span>
                  </div>
                }
              >
                <MapView
                  places={filtered}
                  selected={selected}
                  onSelect={select}
                  is3D={is3D}
                  onToggle3D={() => setIs3D((v) => !v)}
                  resetKey={resetKey}
                  touring={touring}
                  onToggleTour={() => {
                    if (touring) setTouring(false);
                    else if (filtered.length) {
                      setSelected(filtered[0]);
                      setTouring(true);
                    } else setToast("둘러볼 여행지를 먼저 선택해 주세요.");
                  }}
                />
              </Suspense>
              {!selected && (
                <div className="discovery-note">
                  <span className="note-icon">
                    <Mountain size={25} strokeWidth={1} />
                  </span>
                  <div>
                    <span>산 너머, 새로운 이야기</span>
                    <p>지도의 여행지를 눌러 여정을 시작해 보세요.</p>
                  </div>
                  <ArrowDown size={18} />
                </div>
              )}
              {selected && (
                <section
                  className="detail-panel"
                  aria-label={`${selected.name} 상세정보`}
                >
                  <div className="detail-photo">
                    <PlaceImage key={selected.id} place={selected} />
                    <button
                      className="detail-back"
                      ref={closeRef}
                      onClick={clearSelection}
                      aria-label="상세정보 닫기"
                    >
                      <ArrowLeft size={18} />
                    </button>
                    <button
                      className={`detail-save ${saved.includes(selected.id) ? "saved" : ""}`}
                      aria-label="선택한 여행지 저장"
                      aria-pressed={saved.includes(selected.id)}
                      onClick={() => toggleSaved(selected)}
                    >
                      <Bookmark
                        size={18}
                        fill={
                          saved.includes(selected.id) ? "currentColor" : "none"
                        }
                      />
                    </button>
                    <span className="detail-image-tag">
                      {selected.category}
                    </span>
                  </div>
                  <div className="detail-content">
                    <div className="eyebrow">
                      DISCOVER KOREA <span />
                    </div>
                    <span className="detail-area">
                      <MapPin size={12} />
                      {selected.area}
                    </span>
                    <h2>{selected.name}</h2>
                    <p className="detail-subtitle">{selected.subtitle}</p>
                    <div className="detail-tags">
                      {selected.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <p className="description">{selected.description}</p>
                    <div className="season-info">
                      <Leaf size={19} />
                      <div>
                        <small>이런 날 떠나보세요</small>
                        <span>{selected.season}</span>
                      </div>
                    </div>
                    <div className="travel-tip">
                      <Trees size={16} />
                      <div>
                        <strong>여행의 작은 힌트</strong>
                        <p>{selected.tip}</p>
                      </div>
                    </div>
                    <button
                      className="enter-journey"
                      onClick={() => enterJourney(selected.id)}
                    >
                      <Footprints size={16} />
                      이곳에서 가상 여행 시작<span>3D</span>
                    </button>
                    <a
                      className="directions-button"
                      href={`https://map.kakao.com/link/to/${encodeURIComponent(selected.name)},${selected.coordinates[1]},${selected.coordinates[0]}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Route size={17} />
                      길찾기
                      <ExternalLink size={14} />
                    </a>
                    <a
                      className="official-link"
                      href={`https://search.naver.com/search.naver?query=${encodeURIComponent(selected.name + " 공식 홈페이지")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      운영시간·방문 정보 확인 <ExternalLink size={12} />
                    </a>
                    <p className="coordinate-label">
                      {selected.coordinates[1].toFixed(4)}° N ·{" "}
                      {selected.coordinates[0].toFixed(4)}° E
                    </p>
                    {credit && (
                      <a
                        className="photo-credit"
                        href={credit.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        사진: Wikimedia Commons ·{" "}
                        {credit.license || "출처 보기"}
                      </a>
                    )}
                  </div>
                </section>
              )}
            </div>
          </main>
          <div className="mobile-switch">
            <button
              className={mobileView === "map" ? "active" : ""}
              onClick={() => setMobileView("map")}
            >
              <Compass size={16} />
              지도
            </button>
            <button
              className={mobileView === "list" ? "active" : ""}
              onClick={() => setMobileView("list")}
            >
              <SlidersHorizontal size={15} />
              여행지 {filtered.length}
            </button>
          </div>
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {creditsOpen && (
        <div className="modal-backdrop" onClick={() => setCreditsOpen(false)}>
          <div
            className="credits-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credits-title"
            ref={modalRef}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-modal"
              aria-label="출처 닫기"
              onClick={() => setCreditsOpen(false)}
            >
              <X size={20} />
            </button>
            <img src={asset("logo.svg")} alt="" />
            <h2 id="credits-title">함께 그린 대동여지도</h2>
            <p>사진과 지도 데이터를 제공한 분들께 감사드립니다.</p>
            <div className="credit-list">
              {credits.map((c) => (
                <div key={c.id}>
                  <a href={c.source} target="_blank" rel="noreferrer">
                    {places.find((p) => p.image === c.id)?.name || c.title}{" "}
                    <ExternalLink size={12} />
                  </a>
                  <span>
                    {c.artist?.replace(/<[^>]*>/g, "") || "Wikimedia Commons"} ·{" "}
                    <a
                      href={c.licenseUrl || c.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.license || "라이선스 정보"}
                    </a>
                  </span>
                </div>
              ))}
            </div>
            <p className="map-credits">
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noreferrer"
              >
                OpenFreeMap
              </a>{" "}
              ·{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap
              </a>{" "}
              ·{" "}
              <a
                href="https://www.naturalearthdata.com"
                target="_blank"
                rel="noreferrer"
              >
                Natural Earth
              </a>{" "}
              ·{" "}
              <a
                href="https://registry.opendata.aws/terrain-tiles/"
                target="_blank"
                rel="noreferrer"
              >
                Terrain Tiles
              </a>{" "}
              ·{" "}
              <a href="https://ambientcg.com" target="_blank" rel="noreferrer">
                ambientCG
              </a>{" "}
              (CC0 질감) · 나눔명조·나눔손글씨 붓 (OFL)
              <br />
              로고, 풍경 일러스트와 여행 공간의 전통 건축·나무·인물 3D 모델은
              대동여지도를 위해 직접 제작했습니다.
              <br />
              현재 12곳을 담은 첫 번째 여행지도입니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
