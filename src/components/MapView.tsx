import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type { Map as LibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Minus,
  Plus,
  LocateFixed,
  Layers3,
  Pause,
  Play,
  Mountain,
  RefreshCw,
} from "lucide-react";
import type { Place } from "../data";
import { createLandmarkLayer } from "../three/mapLandmarks";
import { addInkImages, cloudImage, cloudMotif, inkMapStyle } from "./inkMap";

// Explicit asset import keeps the module worker available after Vite bundles the map.
maplibregl.setWorkerUrl(mapWorkerUrl);

const regionLabels: [string, string, [number, number]][] = [
  ["경기도", "京畿道", [127.15, 37.45]],
  ["강원도", "江原道", [128.3, 37.48]],
  ["충청도", "忠淸道", [127.2, 36.5]],
  ["전라도", "全羅道", [127.05, 35.42]],
  ["경상도", "慶尙道", [128.3, 35.72]],
  ["제주도", "濟州道", [126.5, 33.3]],
];
const seaLabels: [string, string, [number, number]][] = [
  ["동해", "東海", [130.2, 37.5]],
  ["서해", "西海", [124.9, 36.3]],
  ["남해", "南海", [127.9, 33.95]],
];
/** 명산: famous mountains drawn as ink-painted peaks, as on old maps. */
const famousPeaks: [string, string, [number, number], number][] = [
  ["백두산", "白頭山", [128.08, 41.99], 1.3],
  ["금강산", "金剛山", [128.1, 38.65], 1.1],
  ["설악산", "雪嶽山", [128.47, 38.12], 1.15],
  ["오대산", "五臺山", [128.54, 37.79], 0.9],
  ["치악산", "雉岳山", [128.06, 37.37], 0.8],
  ["북한산", "北漢山", [126.98, 37.66], 0.75],
  ["태백산", "太白山", [128.92, 37.1], 0.9],
  ["소백산", "小白山", [128.49, 36.96], 0.9],
  ["월악산", "月岳山", [128.1, 36.89], 0.8],
  ["속리산", "俗離山", [127.87, 36.54], 0.85],
  ["계룡산", "鷄龍山", [127.2, 36.34], 0.75],
  ["주왕산", "周王山", [129.17, 36.4], 0.75],
  ["덕유산", "德裕山", [127.75, 35.86], 0.9],
  ["가야산", "伽倻山", [128.12, 35.82], 0.8],
  ["내장산", "內藏山", [126.89, 35.48], 0.75],
  ["지리산", "智異山", [127.73, 35.34], 1.15],
  ["무등산", "無等山", [126.99, 35.13], 0.8],
  ["한라산", "漢拏山", [126.53, 33.36], 1.1],
];
/** Three ink-wash peaks with a jade wash and a drifting cloud band. */
function peakArt(scale: number) {
  const w = Math.round(64 * scale),
    h = Math.round(46 * scale);
  return `<svg viewBox="0 0 64 46" width="${w}" height="${h}" aria-hidden="true">
<defs><linearGradient id="pj" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6f6a"/><stop offset="1" stop-color="#9fbf9a" stop-opacity=".2"/></linearGradient></defs>
<path d="M2 44 L18 18 L24 26 L33 4 L42 22 L48 14 L62 44 Z" fill="url(#pj)"/>
<path d="M2 44 L18 18 L24 26 L33 4 L42 22 L48 14 L62 44" fill="none" stroke="#24302c" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M33 4 L30 16 M33 4 L37 15 M18 18 L16 28 M48 14 L50 25" stroke="#24302c" stroke-width="1" opacity=".7"/>
<path d="M28 12 l2 -2 l2 2 M45 19 l2 -2 l2 2" stroke="#3d5b45" stroke-width="1.2" fill="none"/>
<path d="M6 36 q8 -4 16 0 t16 0 t18 -1" stroke="#f3ead2" stroke-width="3" fill="none" opacity=".9" stroke-linecap="round"/>
</svg>`;
}
const EXAGGERATION = 2;
/** 윤도-style compass: the four branches 子午卯酉 mark north, south, east, west. */
function InkCompass() {
  const ticks = Array.from({ length: 24 }, (_, i) => i * 15);
  return (
    <svg viewBox="0 0 100 100" width="62" height="62" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="#f3ead2"
        stroke="#3b4741"
        strokeWidth="1.2"
      />
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="#3b4741"
        strokeWidth="0.6"
      />
      <circle
        cx="50"
        cy="50"
        r="27"
        fill="none"
        stroke="#a24a37"
        strokeWidth="0.8"
      />
      {ticks.map((a) => (
        <line
          key={a}
          x1="50"
          y1="6"
          x2="50"
          y2={a % 90 ? "10" : "13"}
          stroke="#3b4741"
          strokeWidth={a % 90 ? 0.6 : 1.2}
          transform={`rotate(${a} 50 50)`}
        />
      ))}
      {[
        ["子", 0],
        ["卯", 90],
        ["午", 180],
        ["酉", 270],
      ].map(([t, a]) => (
        <text
          key={t}
          x="50"
          y="23"
          textAnchor="middle"
          fontSize="10"
          fontFamily="Nanum Myeongjo, serif"
          fontWeight="800"
          fill={t === "子" ? "#a24a37" : "#2f3a35"}
          transform={`rotate(${a} 50 50)`}
        >
          {t}
        </text>
      ))}
      <path d="M50 28 L54 50 L50 72 L46 50 Z" fill="#2f3a35" />
      <path d="M50 28 L54 50 L46 50 Z" fill="#a24a37" />
      <circle
        cx="50"
        cy="50"
        r="2.4"
        fill="#f3ead2"
        stroke="#2f3a35"
        strokeWidth="0.8"
      />
    </svg>
  );
}
export default function MapView({
  places,
  selected,
  onSelect,
  is3D,
  onToggle3D,
  resetKey,
  touring,
  onToggleTour,
}: {
  places: Place[];
  selected: Place | null;
  onSelect: (p: Place) => void;
  is3D: boolean;
  onToggle3D: () => void;
  resetKey: number;
  touring: boolean;
  onToggleTour: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LibreMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]),
    selectRef = useRef(onSelect);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [offline, setOffline] = useState(false),
    [coords, setCoords] = useState("36.20° N   127.80° E"),
    [zoom, setZoom] = useState(6);
  const placesRef = useRef(places),
    selectedRef = useRef(selected?.id);
  placesRef.current = places;
  selectedRef.current = selected?.id;
  selectRef.current = onSelect;
  useEffect(() => {
    if (!container.current) return;
    let instance: LibreMap;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        style: inkMapStyle,
        center: [127.7, 36.05],
        zoom: 6.25,
        pitch: 35,
        bearing: -8,
        maxPitch: 75,
        minZoom: 5,
        maxZoom: 17,
        maxBounds: [
          [121, 29],
          [136, 42],
        ],
        attributionControl: false,
        fadeDuration: 400,
      });
    } catch {
      setFailed(true);
      return;
    }
    map.current = instance;
    addInkImages(instance);
    if (import.meta.env.DEV)
      (window as unknown as { __map?: LibreMap }).__map = instance;
    instance.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-left",
    );
    instance.addControl(
      new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }),
      "bottom-left",
    );
    instance.on("load", () => {
      setReady(true);
      instance.setTerrain({ source: "elevation", exaggeration: EXAGGERATION });
      instance.addLayer(
        createLandmarkLayer(
          () => placesRef.current,
          () => selectedRef.current,
        ),
      );
    });
    instance.on("error", () => setOffline(true));
    instance.on("moveend", () => {
      const p = instance.getCenter();
      setCoords(`${p.lat.toFixed(2)}° N   ${p.lng.toFixed(2)}° E`);
      setZoom(instance.getZoom());
    });
    const label = (className: string, name: string, hanja: string) => {
      const el = document.createElement("span");
      el.className = className;
      el.setAttribute("aria-label", name);
      const big = document.createElement("b"),
        small = document.createElement("small");
      big.textContent = name;
      small.textContent = hanja;
      el.append(big, small);
      return el;
    };
    const peaks = famousPeaks.map(([name, hanja, point, size]) => {
      const el = document.createElement("span");
      el.className = `peak-label ${size >= 0.85 ? "major" : ""}`;
      el.setAttribute("aria-label", name);
      el.innerHTML = peakArt(size);
      const caption = document.createElement("b");
      caption.textContent = name;
      const small = document.createElement("small");
      small.textContent = hanja;
      el.append(caption, small);
      return new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat(point)
        .addTo(instance);
    });
    const labels = [
      ...peaks,
      ...regionLabels.map(([name, hanja, point]) =>
        new maplibregl.Marker({ element: label("province-label", name, hanja) })
          .setLngLat(point)
          .addTo(instance),
      ),
      ...seaLabels.map(([name, hanja, point]) =>
        new maplibregl.Marker({ element: label("sea-label", name, hanja) })
          .setLngLat(point)
          .addTo(instance),
      ),
    ];
    return () => {
      labels.forEach((l) => l.remove());
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((m) => m.remove());
    markers.current = places.map((p) => {
      const el = document.createElement("button");
      el.className = `destination-marker model-marker ${p.category === "역사와 문화" ? "heritage" : ""} ${selected?.id === p.id ? "selected" : ""}`;
      el.setAttribute("aria-label", `${p.name} 지도에서 보기`);
      el.innerHTML = `<span class="landmark-hit" aria-hidden="true"></span><span class="marker-name"></span><i></i>`;
      el.querySelector(".marker-name")!.textContent = p.name;
      el.addEventListener("click", () => selectRef.current(p));
      return new maplibregl.Marker({
        element: el,
        anchor: "bottom",
        offset: [0, 22],
      })
        .setLngLat(p.coordinates)
        .addTo(map.current!);
    });
    map.current.triggerRepaint();
    return () => markers.current.forEach((m) => m.remove());
  }, [places, selected, ready]);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    let cityMarkers: maplibregl.Marker[] = [];
    const update = () => {
      cityMarkers.forEach((m) => m.remove());
      cityMarkers = [];
      if (instance.getZoom() < 8) return;
      const occupied: { x: number; y: number }[] = [],
        names = new Set<string>();
      const { width, height } = instance.getCanvas().getBoundingClientRect();
      for (const feature of instance.querySourceFeatures("openmap", {
        sourceLayer: "place",
      })) {
        if (cityMarkers.length >= 24) break;
        if (
          feature.geometry.type !== "Point" ||
          !["city", "town", "village"].includes(feature.properties.class)
        )
          continue;
        const name = feature.properties["name:ko"] || feature.properties.name;
        if (!name || names.has(name)) continue;
        const point = feature.geometry.coordinates as [number, number],
          pixel = instance.project(point);
        if (
          pixel.x < 20 ||
          pixel.y < 40 ||
          pixel.x > width - 30 ||
          pixel.y > height - 30 ||
          occupied.some(
            (p) => Math.abs(p.x - pixel.x) < 90 && Math.abs(p.y - pixel.y) < 35,
          )
        )
          continue;
        const el = document.createElement("span");
        el.className = "city-label";
        el.textContent = name;
        cityMarkers.push(
          new maplibregl.Marker({ element: el })
            .setLngLat(point)
            .addTo(instance),
        );
        occupied.push(pixel);
        names.add(name);
      }
    };
    instance.on("idle", update);
    return () => {
      instance.off("idle", update);
      cityMarkers.forEach((m) => m.remove());
    };
  }, [ready]);
  useEffect(() => {
    if (ready && map.current) {
      map.current.setTerrain(
        is3D ? { source: "elevation", exaggeration: EXAGGERATION } : null,
      );
      map.current.easeTo({
        pitch: is3D ? (selected ? 58 : 35) : 0,
        bearing: is3D ? -8 : 0,
        duration: 900,
      });
    }
  }, [is3D, ready]);
  useEffect(() => {
    if (!ready || !map.current) return;
    if (selected) {
      map.current.flyTo({
        center: selected.coordinates,
        zoom: selected.zoom,
        pitch: is3D ? 58 : 0,
        bearing: is3D ? -18 : 0,
        duration: 2200,
        padding:
          window.innerWidth > 760
            ? {
                top: 80,
                bottom: 80,
                left: 30,
                right: window.innerWidth > 1150 ? 355 : 325,
              }
            : {
                top: 60,
                bottom: Math.min(window.innerHeight * 0.52, 540) + 85,
                left: 20,
                right: 20,
              },
      });
    } else {
      map.current.flyTo({
        center: [127.7, 36.05],
        zoom: 6.25,
        pitch: is3D ? 35 : 0,
        bearing: -8,
        duration: 1800,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      });
    }
  }, [selected, ready, resetKey]);
  useEffect(() => {
    if (
      !selected &&
      ready &&
      map.current &&
      places.length > 0 &&
      places.length < 12
    ) {
      const bounds = new maplibregl.LngLatBounds();
      places.forEach((p) => bounds.extend(p.coordinates));
      map.current.fitBounds(bounds, {
        padding: 120,
        maxZoom: 10,
        duration: 1300,
      });
    }
  }, [places, ready, selected]);
  useEffect(() => {
    if (
      !touring ||
      !selected ||
      !map.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(() => {
      const m = map.current;
      if (m && !m.isMoving())
        m.easeTo({
          bearing: m.getBearing() + 35,
          duration: 7000,
          easing: (t) => t,
        });
    }, 7200);
    return () => window.clearInterval(timer);
  }, [touring, selected]);
  const clouds = useMemo(() => [11, 23, 37, 51].map(cloudImage), []);
  const motif = useMemo(() => cloudMotif(), []);
  // Painted cloud banks drift over the whole country and part as you zoom in.
  const cloudOpacity = Math.max(0, Math.min(1, (8.2 - zoom) / 2.2));
  const reset = () =>
    map.current?.flyTo({
      center: [127.7, 36.05],
      zoom: 6.25,
      pitch: is3D ? 35 : 0,
      bearing: -8,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 1600,
    });
  return (
    <section
      className={`map-section ${selected ? "selected-mode" : ""} ${zoom > 8.6 ? "zoomed-in" : zoom < 7.3 ? "overview" : ""}`}
      aria-label="대한민국 관광 지도"
    >
      <div ref={container} className="map-canvas" />
      <div
        className="map-clouds"
        aria-hidden="true"
        style={{ opacity: cloudOpacity }}
      >
        {clouds.map((src, i) => (
          <img key={i} src={src} alt="" className={`cloud cloud-${i}`} />
        ))}
      </div>
      <div className="map-grain" />
      <div className="map-frame" aria-hidden="true" />
      <div
        className="map-motif"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: motif }}
      />
      <div className="map-topline">
        <div className="map-breadcrumb">
          <span className="live-dot" />
          대한민국 <span>/</span> {selected ? selected.region : "전국 지도"}
          <span className="map-mode-label">
            {is3D ? "3D TERRAIN" : "2D MAP"}
          </span>
        </div>
        <button
          className={`tour-button ${touring ? "active" : ""}`}
          onClick={onToggleTour}
        >
          {touring ? <Pause size={14} /> : <Play size={14} />}{" "}
          {touring ? "둘러보기 멈추기" : "느긋하게 둘러보기"}
        </button>
      </div>
      <div className="map-poem">
        <span>우리의 산하,</span>
        <span>새로운 시선으로.</span>
        <small>A NEW PERSPECTIVE ON KOREA</small>
      </div>
      <div className="map-stamp">
        大東
        <br />
        輿地圖
      </div>
      <div className="compass">
        <InkCompass />
        <small>나침반</small>
      </div>
      {!ready && !failed && (
        <div className="map-loading">
          <Mountain className="loading-icon" size={25} />
          <span>우리의 산하를 펼치는 중</span>
        </div>
      )}
      {failed && (
        <div className="map-loading">
          <Mountain size={28} />
          <strong>입체 지도를 표시할 수 없어요</strong>
          <span>브라우저의 하드웨어 가속을 확인해 주세요.</span>
          <button onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> 다시 불러오기
          </button>
        </div>
      )}
      {offline && ready && (
        <div className="map-offline">
          일부 지도 정보를 불러오지 못했어요. 기본 지도와 여행지는 계속 볼 수
          있어요.
        </div>
      )}
      <div className="map-tools">
        <button
          className={is3D ? "active" : ""}
          aria-label="입체 지도 전환"
          aria-pressed={is3D}
          onClick={onToggle3D}
        >
          <Layers3 size={18} />
          <span>{is3D ? "3D" : "2D"}</span>
        </button>
        <div className="zoom-tools">
          <button
            aria-label="지도 확대"
            onClick={() => map.current?.zoomIn({ duration: 500 })}
          >
            <Plus size={20} />
          </button>
          <i />
          <button
            aria-label="지도 축소"
            onClick={() => map.current?.zoomOut({ duration: 500 })}
          >
            <Minus size={20} />
          </button>
        </div>
        <button aria-label="전국 지도 보기" onClick={reset}>
          <LocateFixed size={19} />
        </button>
      </div>
      <div className="map-bottom">
        <span>
          <i /> 자연 <i className="brown" /> 역사·문화
        </span>
        <p>
          {coords}
          <span>ZOOM {zoom.toFixed(1)}</span>
        </p>
      </div>
      <div className="map-hint">
        드래그하여 이동 <b>·</b> 스크롤하여 확대 <b>·</b> 우클릭 드래그로 회전
      </div>
    </section>
  );
}
