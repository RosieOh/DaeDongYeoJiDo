import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  Footprints,
  Moon,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Sunset,
  Wind,
  X,
} from "lucide-react";
import { places } from "../data";
import type { Place } from "../data";
import { JourneyEngine } from "../three/JourneyEngine";
import type { JourneyCue, JourneyState } from "../three/JourneyEngine";
import { SKILLS } from "../three/motion";
import type { Stop } from "../three/world";
import { validateGeoScene, toCoordinates } from "../three/geo";
import type { GeoSceneData } from "../three/geo";
import { loadSurfaces } from "../three/textures";
import { loadHero } from "../three/avatar";
import type { TimeOfDay } from "../three/sky";
import "./journey.css";
import { asset } from "../asset";

const nextTime: Record<TimeOfDay, TimeOfDay> = {
  day: "sunset",
  sunset: "night",
  night: "day",
};
const timeLabel: Record<TimeOfDay, string> = {
  day: "낮 풍경으로 전환",
  sunset: "노을 풍경으로 전환",
  night: "달밤 풍경으로 전환",
};
const timeLog: Record<TimeOfDay, string> = {
  day: "해가 중천에 떠올랐다.",
  sunset: "노을이 강호에 내려앉는다.",
  night: "달이 떠오르고 등불이 하나둘 켜진다.",
};
/** 경공 경지 by seconds spent in the air. */
const REALMS: [string, number][] = [
  ["입문", 0],
  ["소성", 15],
  ["대성", 45],
  ["화경", 120],
  ["현경", 300],
];
/** Picks 을/를 by whether the last syllable has a final consonant. */
const object = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code % 28 ? "을" : "를");
};
const AIR_KEY = "daedong:journey:qinggong";
function readAir() {
  try {
    return Number(localStorage.getItem(AIR_KEY)) || 0;
  } catch {
    return 0;
  }
}
function readDiscoveries(id: string): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`daedong:journey:geo-v1:${id}`) || "[]",
    );
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/* ------------------------------ ink icons ------------------------------ */

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const ICONS = {
  jump: "M8 22 16 14 24 22M8 15 16 7 24 15M11 28h10",
  dash: "M3 18c6-1 10-4 13-9 1 4 4 6 8 6l5-3-3 6c-4 3-10 4-15 3l-8 2Z",
  soar: "M16 29V12M16 12c-6 0-9-4-6-8 3-3 8 0 6 4M16 12c6 0 9-4 6-8-3-3-8 0-6 4M9 20c-4 1-6 3-5 5M23 20c4 1 6 3 5 5",
  plunge:
    "M16 3v17M10 14l6 7 6-7M4 27c4-2 8-3 12-3s8 1 12 3M7 23l-3-3M25 23l3-3",
  wall: "M6 4v24M6 8h6M6 16h6M6 24h6M18 24c2-1 3-3 3-5M22 16c2-1 3-3 3-5M18 9c1-1 3-2 5-2",
};

/** An ink-wash bust of the traveller for the portrait medallion. */
function Portrait() {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <radialGradient id="pg" cx="50%" cy="38%" r="65%">
          <stop offset="0" stopColor="#3d5e63" />
          <stop offset="1" stopColor="#0f1b1f" />
        </radialGradient>
      </defs>
      <circle cx="40" cy="40" r="40" fill="url(#pg)" />
      <path d="M14 80c3-16 14-22 26-22s23 6 26 22Z" fill="#eef1f2" />
      <path d="M33 58l7 12 7-12" fill="#2a3a58" />
      <path
        d="M24 80c2-10 6-16 10-19M56 80c-2-10-6-16-10-19"
        stroke="#c9a45c"
        strokeWidth="1.4"
        fill="none"
      />
      <ellipse cx="40" cy="38" rx="11.5" ry="14" fill="#ecc9a8" />
      <path
        d="M28 36c-1-11 5-17 12-17s13 6 12 17c-2-6-6-9-12-9s-10 3-12 9Z"
        fill="#0e0f13"
      />
      <path
        d="M29 34c-3 6-3 14-1 20M51 34c3 6 3 14 1 20"
        stroke="#0e0f13"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="40" cy="15" r="5" fill="#0e0f13" />
      <rect x="35" y="16" width="10" height="4" rx="1" fill="#d2d5db" />
      <path
        d="M33 35l5 1M47 35l-5 1"
        stroke="#1a1512"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M34 39h4M42 39h4"
        stroke="#140f0d"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M38 46h4"
        stroke="#c97a72"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

type LogLine = { id: number; tag: string; text: string };

export default function Journey({
  place,
  onPlaceChange,
  onBack,
}: {
  place: Place;
  onPlaceChange: (id: string) => void;
  onBack: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    nameplate = useRef<HTMLDivElement>(null),
    engine = useRef<JourneyEngine | null>(null),
    interaction = useRef<(s: Stop) => void>(() => {}),
    cueRef = useRef<(c: JourneyCue) => void>(() => {});
  const [state, setState] = useState<JourneyState>({
    x: 0,
    z: 25,
    y: 0,
    airborne: false,
    mode: "ground",
    qi: 1,
    cooldowns: { dash: 0, soar: 0, plunge: 0 },
    airTime: 0,
    heading: 0,
    distance: 0,
    nearby: null,
  });
  const [stops, setStops] = useState<Stop[]>([]),
    [visited, setVisited] = useState<string[]>(() => readDiscoveries(place.id)),
    [detail, setDetail] = useState<Stop | null>(null),
    [paused, setPaused] = useState(false),
    [help, setHelp] = useState(false),
    [time, setTime] = useState<TimeOfDay>("day"),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [toast, setToast] = useState(""),
    [sprinting, setSprinting] = useState(false),
    [stick, setStick] = useState({ x: 0, y: 0 }),
    [callout, setCallout] = useState<{ id: number; name: string } | null>(null),
    [log, setLog] = useState<LogLine[]>([]),
    [air, setAir] = useState(readAir);
  const [geo, setGeo] = useState<GeoSceneData | null>(null);
  const stickId = useRef<number | null>(null),
    logId = useRef(0),
    lastFail = useRef(0),
    lastAir = useRef(0),
    firstTime = useRef(true);
  const pushLog = (tag: string, text: string) =>
    setLog((prev) => [...prev.slice(-5), { id: ++logId.current, tag, text }]);
  const mapPaths = useMemo(() => {
    const polygon = (rings: number[][][]) =>
      rings
        .map((r) => "M" + r.map((p) => p.join(",")).join("L") + "Z")
        .join("");
    return geo
      ? {
          buildings: geo.buildings.map((b) => polygon(b.rings)).join(""),
          water: geo.water.map((b) => polygon(b.rings)).join(""),
          roads: geo.roads
            .map((r) => "M" + r.points.map((p) => p.join(",")).join("L"))
            .join(""),
        }
      : null;
  }, [geo]);
  const coordinates = geo
    ? toCoordinates(geo, state.x, state.z)
    : place.coordinates;
  interaction.current = (stop) => {
    setDetail(stop);
    setVisited((prev) => {
      if (prev.includes(stop.id)) return prev;
      const next = [...prev, stop.id];
      pushLog("발견", `${object(stop.name)} 여행 수첩에 기록했다.`);
      try {
        localStorage.setItem(
          `daedong:journey:geo-v1:${place.id}`,
          JSON.stringify(next),
        );
        setToast(`${stop.name} · 새로운 풍경을 기록했어요`);
      } catch {
        setToast("이번 방문 동안 발견 기록을 유지해요.");
      }
      return next;
    });
  };
  cueRef.current = (cue) => {
    if (cue.kind === "skill") {
      setCallout({ id: Date.now(), name: cue.name });
      pushLog("경공", `${object(cue.name)} 펼쳤다.`);
    } else if (performance.now() - lastFail.current > 1200) {
      lastFail.current = performance.now();
      pushLog(
        "알림",
        cue.reason === "qi"
          ? "기력이 모자라 경공을 펼칠 수 없다."
          : "아직 기운을 다시 모으는 중이다.",
      );
    }
  };
  useEffect(() => {
    if (!canvas.current) return;
    setReady(false);
    setError(false);
    setDetail(null);
    setPaused(false);
    setHelp(false);
    setTime("day");
    firstTime.current = true;
    setSprinting(false);
    setVisited(readDiscoveries(place.id));
    setGeo(null);
    setStops([]);
    lastAir.current = 0;
    const controller = new AbortController();
    let active: JourneyEngine | undefined;
    Promise.all([
      fetch(asset(`geo/${place.id}.json`), { signal: controller.signal }),
      loadSurfaces(),
      loadHero().catch((e) => {
        console.warn("Hero model unavailable, using the procedural figure", e);
        return null;
      }),
    ])
      .then(async ([response, surfaces, hero]) => {
        if (!response.ok) throw new Error(`Scene data: ${response.status}`);
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!validateGeoScene(data) || data.id !== place.id)
          throw new Error("Invalid GIS scene");
        active = new JourneyEngine(
          canvas.current!,
          place,
          data,
          surfaces,
          hero,
          setState,
          (s) => interaction.current(s),
        );
        active.setCueListener((c) => cueRef.current(c));
        active.setOverlay(nameplate.current);
        engine.current = active;
        setGeo(data);
        setStops(active.world.stops);
        setVisited(
          readDiscoveries(place.id).filter((id) =>
            active!.world.stops.some((s) => s.id === id),
          ),
        );
        setReady(true);
        setLog([
          {
            id: ++logId.current,
            tag: "지역",
            text: `${place.name}에 들어섰다.`,
          },
        ]);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        console.error("Journey initialization failed", e);
        setError(true);
      });
    return () => {
      controller.abort();
      active?.dispose();
      engine.current = null;
    };
  }, [place]);
  useEffect(() => {
    engine.current?.setPaused(paused || help || !!detail);
    setSprinting(false);
    setStick({ x: 0, y: 0 });
    stickId.current = null;
  }, [paused, help, detail]);
  useEffect(() => {
    engine.current?.setTimeOfDay(time);
    if (firstTime.current) firstTime.current = false;
    else pushLog("시간", timeLog[time]);
  }, [time]);
  // 경공 수련: time in the air accumulates across journeys.
  const realmIndex = REALMS.reduce((i, [, t], k) => (air >= t ? k : i), 0);
  useEffect(() => {
    const delta = state.airTime - lastAir.current;
    lastAir.current = state.airTime;
    if (delta <= 0 || delta > 5) return;
    const before = REALMS.reduce((i, [, t], k) => (air >= t ? k : i), 0),
      after = REALMS.reduce((i, [, t], k) => (air + delta >= t ? k : i), 0);
    if (after > before) {
      pushLog("경지", `경공이 ${REALMS[after][0]}의 경지에 이르렀다.`);
      setCallout({ id: Date.now(), name: `경지 · ${REALMS[after][0]}` });
    }
    setAir(air + delta);
    try {
      localStorage.setItem(
        AIR_KEY,
        String(Math.round((air + delta) * 10) / 10),
      );
    } catch {
      // Training progress simply stays in memory.
    }
    // Only airTime drives this; `air` is read as of the latest render.
  }, [state.airTime]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        if (detail) setDetail(null);
        else if (help) setHelp(false);
        else setPaused((v) => !v);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [detail, help]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!callout) return;
    const timer = setTimeout(() => setCallout(null), 1400);
    return () => clearTimeout(timer);
  }, [callout]);
  const next = stops.find((s) => !visited.includes(s.id));
  const screenshot = () => {
    if (!engine.current) return;
    const a = document.createElement("a");
    a.download = `대동여지도-${place.name}.png`;
    a.href = engine.current.capture();
    a.click();
    setToast("지금의 풍경을 사진으로 저장했어요");
  };
  const moveStick = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickId.current !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / 33,
      y = (e.clientY - rect.top - rect.height / 2) / 33;
    const norm = Math.hypot(x, y);
    if (norm > 1) {
      x /= norm;
      y /= norm;
    }
    setStick({ x: x * 24, y: y * 24 });
    engine.current?.setJoystick(x, y);
  };
  const releaseStick = () => {
    stickId.current = null;
    setStick({ x: 0, y: 0 });
    engine.current?.setJoystick(0, 0);
  };
  const [realmName, realmStart] = REALMS[realmIndex];
  const realmEnd = REALMS[realmIndex + 1]?.[1];
  const realmProgress = realmEnd
    ? (air - realmStart) / (realmEnd - realmStart)
    : 1;
  const skills = [
    {
      id: "jump",
      name: "도약",
      key: "Space",
      icon: ICONS.jump,
      cost: 0,
      cooldown: 0,
      hold: true,
    },
    {
      id: "dash",
      name: "비연",
      key: "F",
      icon: ICONS.dash,
      cost: SKILLS.dash.cost,
      cooldown: state.cooldowns.dash,
      run: () => engine.current?.dash(),
    },
    {
      id: "soar",
      name: "제운종",
      key: "Q",
      icon: ICONS.soar,
      cost: SKILLS.soar.cost,
      cooldown: state.cooldowns.soar,
      run: () => engine.current?.soar(),
    },
    {
      id: "plunge",
      name: "천근추",
      key: "C",
      icon: ICONS.plunge,
      cost: SKILLS.plunge.cost,
      cooldown: state.cooldowns.plunge,
      run: () => engine.current?.plunge(),
      airOnly: true,
    },
  ];
  return (
    <main className="journey-page game-hud" aria-label="3인칭 여행 시뮬레이션">
      <canvas
        ref={canvas}
        className="journey-canvas"
        tabIndex={0}
        aria-label="여행 공간. WASD 또는 방향키로 이동, Space로 경공, 마우스를 드래그해 시점 회전, E키로 명소 발견."
        data-ready={ready}
        data-scene={place.id}
        data-player-x={state.x.toFixed(2)}
        data-player-z={state.z.toFixed(2)}
        data-player-y={state.y.toFixed(2)}
        data-airborne={state.airborne}
        data-mode={state.mode}
        data-qi={state.qi.toFixed(2)}
        data-distance={state.distance.toFixed(1)}
      />
      <div className="journey-vignette" />
      <div className="hud-nameplate" ref={nameplate} aria-hidden="true">
        {callout && (
          <span className="hud-callout" key={callout.id}>
            {callout.name}
          </span>
        )}
        <small>「대동여지도」</small>
        <b>무명 협객</b>
      </div>
      {ready && (
        <div className="hud-region" key={place.id} aria-hidden="true">
          <small>{place.region}</small>
          <strong>{place.name}</strong>
          <span>{place.subtitle}</span>
        </div>
      )}
      <section className="hud-player" aria-label="협객 정보">
        <div className="hud-portrait">
          <Portrait />
          <span>{realmIndex + 1}</span>
        </div>
        <div className="hud-bars">
          <strong>
            무명 협객 <em>경공 · {realmName}</em>
          </strong>
          <div
            className={`hud-bar qi ${state.qi < 0.2 ? "low" : ""}`}
            role="meter"
            aria-label="기력"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.qi * 100)}
          >
            <i style={{ width: `${state.qi * 100}%` }} />
            <span>기력 {Math.round(state.qi * 100)} / 100</span>
          </div>
          <div className="hud-bar exp">
            <i style={{ width: `${Math.min(1, realmProgress) * 100}%` }} />
            <span>
              수련 {realmEnd ? `${Math.floor(realmProgress * 100)}%` : "극"}
            </span>
          </div>
        </div>
      </section>
      <div className="journey-topbar">
        <button
          className="journey-back"
          onClick={onBack}
          aria-label="지도로 돌아가기"
        >
          <ArrowLeft size={16} />
          <span>지도로 돌아가기</span>
        </button>
        <div className="journey-tools">
          <button
            onClick={() => setTime((v) => nextTime[v])}
            aria-label={timeLabel[nextTime[time]]}
          >
            {time === "day" ? (
              <Sunset size={17} />
            ) : time === "sunset" ? (
              <Moon size={17} />
            ) : (
              <Sun size={17} />
            )}
          </button>
          <button
            onClick={screenshot}
            aria-label="풍경 사진 저장"
            disabled={!ready}
          >
            <Camera size={17} />
          </button>
          <button onClick={() => setHelp((v) => !v)} aria-label="조작 방법">
            <CircleHelp size={17} />
          </button>
          <button
            onClick={() => setPaused((v) => !v)}
            aria-label={paused ? "여행 계속하기" : "여행 일시정지"}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
          </button>
        </div>
      </div>
      <div className="journey-minimap" aria-label="현재 위치 안내">
        <div className="minimap-title">
          <b>{place.name}</b>
          <span>
            {time === "day" ? "午時" : time === "sunset" ? "酉時" : "子時"}
          </span>
        </div>
        <div className="minimap-ring">
          <svg
            viewBox={`${state.x - 65} ${state.z - 65} 130 130`}
            role="img"
            aria-label="실제 도로와 건물 위 현재 위치"
          >
            <rect
              x={state.x - 65}
              y={state.z - 65}
              width="130"
              height="130"
              fill="#e9dfc2"
            />
            {mapPaths && (
              <>
                <path
                  d={mapPaths.water}
                  fill="#a9c2b8"
                  stroke="#4d6862"
                  strokeWidth=".6"
                  fillRule="evenodd"
                />
                <path
                  d={mapPaths.roads}
                  stroke="#a24a37"
                  strokeWidth="1.6"
                  strokeOpacity=".7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <path
                  d={mapPaths.buildings}
                  fill="#4b4a40"
                  fillOpacity=".55"
                  fillRule="evenodd"
                />
              </>
            )}
            {stops.map((s) => (
              <rect
                key={s.id}
                x={s.x - 2.6}
                y={s.z - 2.6}
                width="5.2"
                height="5.2"
                rx=".6"
                fill={visited.includes(s.id) ? "#3b4741" : "#c9a45c"}
                stroke="#2a2418"
                strokeWidth=".7"
              />
            ))}
            <g
              transform={`translate(${state.x},${state.z}) rotate(${(-state.heading * 180) / Math.PI})`}
            >
              <path d="M0-14 7 6H-7Z" fill="#f5e8b8" opacity=".25" />
              <path
                d="M0-4.4 3.2 3 0 1.6-3.2 3Z"
                fill="#b8392d"
                stroke="#f6ecd9"
                strokeWidth=".6"
              />
            </g>
          </svg>
          {["北", "東", "南", "西"].map((d, i) => (
            <i key={d} className={`dir dir-${i}`}>
              {d}
            </i>
          ))}
        </div>
        <span>
          {coordinates[1].toFixed(4)}°N · {coordinates[0].toFixed(4)}°E
        </span>
      </div>
      <div className="journey-location">
        <label>
          <span>지역 이동</span>
          <select
            aria-label="탐험할 여행지"
            value={place.id}
            onChange={(e) => onPlaceChange(e.target.value)}
          >
            {places.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} · {p.region}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        <p>실제 위치와 길 · 산세와 풍경은 연출</p>
      </div>
      <aside className="journey-quest" aria-label="여행 수첩">
        <div className="quest-heading">
          <span>
            <Compass size={15} />
            여행 수첩
          </span>
          <b>
            {visited.length}
            <i> / {stops.length}</i>
          </b>
        </div>
        <div className="quest-progress">
          <span
            style={{
              width: `${(visited.length / Math.max(stops.length, 1)) * 100}%`,
            }}
          />
        </div>
        {stops.map((s, i) => (
          <div
            className={`quest-stop ${visited.includes(s.id) ? "discovered" : ""} ${s.id === next?.id ? "next" : ""}`}
            key={s.id}
          >
            <span>
              {visited.includes(s.id) ? (
                <Check size={12} />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <div>
              <strong>{s.name}</strong>
              <small>
                {visited.includes(s.id) ? "풍경 기록 완료" : s.subtitle}
              </small>
            </div>
            {s.id === next?.id && (
              <span className="quest-distance">
                {Math.round(Math.hypot(state.x - s.x, state.z - s.z))}m
              </span>
            )}
          </div>
        ))}
      </aside>
      <div className="hud-log" role="log" aria-label="강호 소식">
        {log.map((l) => (
          <p key={l.id}>
            <b>[{l.tag}]</b> {l.text}
          </p>
        ))}
      </div>
      {ready && !detail && !paused && !help && (
        <div className={`journey-interact ${state.nearby ? "available" : ""}`}>
          <span className="interact-symbol">
            <Sparkles size={18} />
          </span>
          <div>
            <small>
              {state.nearby
                ? "새로운 풍경을 만났어요"
                : next
                  ? "다음 발견까지"
                  : "천천히 더 둘러보세요"}
            </small>
            <strong>
              {state.nearby?.name || next?.name || "자유로운 산책"}
            </strong>
          </div>
          <button
            onClick={() => engine.current?.interact()}
            disabled={!state.nearby}
            aria-label="가까운 명소 발견하기"
          >
            <kbd>E</kbd>
            <span>둘러보기</span>
          </button>
        </div>
      )}
      <div className="hud-skills" role="group" aria-label="경공 기술">
        {skills.map((s) => {
          const lacking = state.qi * 100 < s.cost;
          const blocked = s.airOnly && !state.airborne;
          return (
            <button
              key={s.id}
              className={`skill ${lacking || blocked ? "lacking" : ""} ${state.mode === s.id ? "active" : ""}`}
              aria-label={`${s.name} (${s.key})`}
              onPointerDown={(e) => {
                e.preventDefault();
                if (s.hold) {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  engine.current?.setJump(true);
                } else s.run?.();
              }}
              onPointerUp={() => s.hold && engine.current?.setJump(false)}
              onPointerCancel={() => s.hold && engine.current?.setJump(false)}
            >
              <Icon d={s.icon} />
              {s.cooldown > 0 && (
                <i
                  className="cooldown"
                  style={{
                    background: `conic-gradient(#0b1013d0 ${s.cooldown * 360}deg, transparent 0)`,
                  }}
                />
              )}
              <kbd>{s.key}</kbd>
              <span>{s.name}</span>
            </button>
          );
        })}
        <div
          className={`skill passive ${state.mode === "wall" ? "active" : ""}`}
          title="벽에 달려들면 자동으로 벽을 타고 오릅니다"
        >
          <Icon d={ICONS.wall} />
          <kbd>자동</kbd>
          <span>벽호공</span>
        </div>
      </div>
      <div className="journey-controls">
        <div>
          <span>
            <kbd>W A S D</kbd> 이동
          </span>
          <span>
            <kbd>SHIFT</kbd> 질주 · 공중 비연
          </span>
          <span>
            <kbd>SPACE</kbd> 경공 · 누르면 활공
          </span>
          <span>
            <kbd>E</kbd> 발견하기
          </span>
        </div>
        <button
          onClick={() => {
            engine.current?.reset();
            setToast("여행의 시작점으로 돌아왔어요");
          }}
          aria-label="시작점으로 돌아가기"
        >
          <RotateCcw size={13} />
          시작점
        </button>
      </div>
      <div className="journey-touch">
        <div
          className="touch-stick"
          role="application"
          aria-label="이동 조이스틱"
          onPointerDown={(e) => {
            stickId.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            moveStick(e);
          }}
          onPointerMove={moveStick}
          onPointerUp={releaseStick}
          onPointerCancel={releaseStick}
          onLostPointerCapture={releaseStick}
        >
          <Navigation size={13} />
          <i style={{ transform: `translate(${stick.x}px,${stick.y}px)` }} />
        </div>
        <div className="touch-actions">
          <button
            className="touch-jump"
            aria-label="경공"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              engine.current?.setJump(true);
            }}
            onPointerUp={() => engine.current?.setJump(false)}
            onPointerCancel={() => engine.current?.setJump(false)}
          >
            <Wind size={22} />
            <span>경공</span>
          </button>
          <button
            className={sprinting ? "active" : ""}
            aria-pressed={sprinting}
            aria-label="달리기 전환"
            onClick={() => {
              engine.current?.setRunning(!sprinting);
              setSprinting((v) => !v);
            }}
          >
            <Footprints size={22} />
            <span>질주</span>
          </button>
        </div>
      </div>
      {(!ready || error) && (
        <div className="journey-loading">
          {error ? (
            <>
              <Compass size={32} />
              <h2>여행 공간을 열 수 없어요</h2>
              <p>
                지도 데이터를 불러오지 못했거나 3D 실행이 제한되었습니다.
                새로고침해 다시 시도해 주세요.
              </p>
              <button onClick={onBack}>지도로 돌아가기</button>
            </>
          ) : (
            <>
              <Compass size={32} />
              <h2>강호를 펼치는 중</h2>
              <p>실제 지도와 고도를 바탕으로 주변 공간을 구성하고 있어요.</p>
            </>
          )}
        </div>
      )}
      {(paused || help) && (
        <div className="journey-pause">
          <div>
            <span>{help ? "경공 비급" : "잠시 멈춤"}</span>
            <h2>
              {help ? "바람을 밟고 하늘을 걷는 법" : "잠시 쉬어가도 좋아요."}
            </h2>
            <dl className="manual">
              <dt>
                <kbd>Space</kbd> 도약
              </dt>
              <dd>세 번까지 연달아 뛰어오르고, 누르고 있으면 활공합니다.</dd>
              <dt>
                <kbd>F</kbd> 비연
              </dt>
              <dd>
                바라보는 방향으로 순식간에 몸을 날립니다. 공중에서 Shift도
                됩니다.
              </dd>
              <dt>
                <kbd>Q</kbd> 제운종
              </dt>
              <dd>
                구름 사다리를 밟듯 하늘 높이 솟구친 뒤 바람을 타고 내려옵니다.
              </dd>
              <dt>
                <kbd>C</kbd> 천근추
              </dt>
              <dd>공중에서 천근의 무게로 내리꽂혀 땅을 울립니다.</dd>
              <dt>벽호공</dt>
              <dd>
                공중이나 질주 중에 벽으로 달려들면 벽을 타고 올라 지붕에 섭니다.
              </dd>
              <dt>능파보</dt>
              <dd>질주하거나 뛰어서 물에 내려서면 수면 위를 달립니다.</dd>
            </dl>
            <p>
              경공은 기력을 쓰고, 땅에 내려서면 기력이 돌아옵니다. 하늘에 머문
              시간만큼 경공 경지가 오릅니다. 황금빛 표식 가까이에서 E를 누르면
              여행 수첩에 기록됩니다.
            </p>
            <button
              onClick={() => {
                setPaused(false);
                setHelp(false);
                canvas.current?.focus();
              }}
            >
              <Play size={16} />
              여행 계속하기
            </button>
          </div>
        </div>
      )}
      {detail && (
        <section className="journey-discovery" aria-label="발견한 명소">
          <button
            onClick={() => {
              setDetail(null);
              canvas.current?.focus();
            }}
            aria-label="발견 정보 닫기"
          >
            <X size={18} />
          </button>
          <span className="discovery-eyebrow">
            <Check size={12} />
            여행 수첩에 기록했어요
          </span>
          <h2>{detail.name}</h2>
          <p>{detail.description}</p>
          <small>
            {place.name}에서의 {visited.length}번째 발견
          </small>
          <button
            className="continue-walk"
            onClick={() => {
              setDetail(null);
              canvas.current?.focus();
            }}
          >
            다시 걸어볼까요 <ArrowRight size={15} />
          </button>
        </section>
      )}
      <div className="journey-source">
        <a href={asset("geo/SOURCES.md")} target="_blank" rel="noreferrer">
          © OpenStreetMap · OpenFreeMap · Terrain Tiles
        </a>
      </div>
      {toast && (
        <div className="journey-toast" role="status">
          <Check size={14} />
          {toast}
        </div>
      )}
    </main>
  );
}
