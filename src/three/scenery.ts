import * as THREE from "three";
import type { GeoBuilding } from "./geo";
import { closestRoadPoint, pointInPolygon } from "./geo";
import { Builder, buildHanokUnit, hanokMaterials } from "./hanok";
import type { HanokUnit } from "./hanok";
import type { PlaceStyle } from "./placeStyles";
import { shared } from "./quality";
import { pinnacle } from "./signature";
import type { GroundMasks, HeightField } from "./terrain";
import { noiseGLSL } from "./terrain";
import type { SurfaceLibrary } from "./textures";
import { canvasTexture, rng } from "./textures";

/**
 * Art-directed scenery in the spirit of wuxia landscapes. Everything here is
 * invented for atmosphere (연출) and placed around, never on, the real paths.
 */

type Spot = { x: number; z: number; y: number };

function rockMaterial(surfaces: SurfaceLibrary, tint = "#a9aaa3") {
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: surfaces.maps.rock.map,
    normalMap: surfaces.maps.rock.normal,
    roughness: 0.92,
  });
}

/** Little pines clinging to the summits of the pinnacles. */
function crownPines(count: number, radius: number, random: () => number) {
  const group = new THREE.Group();
  const needles = new THREE.MeshStandardMaterial({
    color: "#2f4a35",
    roughness: 0.9,
  });
  const bark = new THREE.MeshStandardMaterial({
    color: "#5a4033",
    roughness: 0.9,
  });
  for (let i = 0; i < count; i++) {
    const tree = new THREE.Group(),
      s = 0.6 + random() * 0.8;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.45, 6, 5),
      bark,
    );
    trunk.position.y = 3;
    trunk.rotation.z = (random() - 0.5) * 0.6;
    tree.add(trunk);
    for (let k = 0; k < 3; k++) {
      const pad = new THREE.Mesh(
        new THREE.SphereGeometry(2.6 - k * 0.5, 7, 4),
        needles,
      );
      pad.scale.y = 0.32;
      pad.position.set((random() - 0.5) * 2, 5 + k * 1.3, (random() - 0.5) * 2);
      tree.add(pad);
    }
    const a = random() * Math.PI * 2,
      r = random() * radius * 0.4;
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    tree.scale.setScalar(s);
    group.add(tree);
  }
  return group;
}

/** 기암괴석: towering stone pinnacles on the distant ridges. */
export function stonePeaks(
  field: HeightField,
  style: PlaceStyle,
  surfaces: SurfaceLibrary,
) {
  const group = new THREE.Group();
  const far = field.data.far;
  if (!style.pinnacles || !far) return group;
  const random = rng(808),
    material = rockMaterial(surfaces, "#b4b3aa"),
    chosen: Spot[] = [];
  const step = (far.extent * 2) / (far.size - 1);
  const at = (i: number, j: number) =>
    field.exaggerate(
      far.heights[j * far.size + i] - field.base,
      Math.max(
        Math.abs(-far.extent + i * step),
        Math.abs(-far.extent + j * step),
      ),
    );
  // Local maxima on ridges between 650 m and 6 km away, highest first.
  const candidates: Spot[] = [];
  for (let j = 2; j < far.size - 2; j++)
    for (let i = 2; i < far.size - 2; i++) {
      const x = -far.extent + i * step,
        z = -far.extent + j * step,
        d = Math.hypot(x, z);
      if (d < 650 || d > 6000) continue;
      const h = at(i, j);
      if (h < field.pivot + 60) continue;
      let peak = true;
      for (let dj = -1; dj <= 1 && peak; dj++)
        for (let di = -1; di <= 1; di++)
          if ((di || dj) && at(i + di, j + dj) > h) {
            peak = false;
            break;
          }
      if (peak) candidates.push({ x, z, y: h });
    }
  candidates.sort((a, b) => b.y - a.y);
  for (const c of candidates) {
    if (chosen.length >= style.pinnacles) break;
    if (chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 380)) continue;
    chosen.push(c);
  }
  chosen.forEach((c, n) => {
    const cluster = new THREE.Group(),
      pillars = 1 + Math.floor(random() * 3);
    for (let k = 0; k < pillars; k++) {
      const h = 45 + random() * 110,
        r = 10 + random() * 16;
      const p = pinnacle(h, r, 900 + n * 7 + k, material);
      p.position.set((random() - 0.5) * 60, -6, (random() - 0.5) * 60);
      p.add(
        crownPines(2 + Math.floor(random() * 3), r, random).translateY(
          h * 0.82,
        ),
      );
      cluster.add(p);
    }
    cluster.position.set(c.x, c.y, c.z);
    group.add(cluster);
  });
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });
  group.name = "stone-peaks";
  return group;
}

/* ------------------------------- waterfall ------------------------------- */

function fallMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.time,
      uSunColor: shared.sunColor,
      uNight: shared.night,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uNight;
      uniform vec3 uSunColor;
      varying vec2 vUv;
      varying vec3 vPos;
      ${noiseGLSL}
      void main() {
        // Streaks racing down, broken up by foam noise.
        float streak = vnoise(vec2(vUv.x * 26.0, vUv.y * 3.0 + uTime * 2.6));
        float foam = vfbm(vec2(vUv.x * 9.0, vUv.y * 6.0 + uTime * 3.4));
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = clamp(streak * 0.7 + foam * 0.6, 0.0, 1.0) * edge;
        a *= smoothstep(1.0, 0.92, vUv.y) * 0.95;
        vec3 col = mix(vec3(0.62, 0.74, 0.76), vec3(1.0), foam) * mix(uSunColor * 0.4 + 0.75, vec3(0.35, 0.42, 0.55), uNight);
        gl_FragColor = vec4(col * 1.3, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function mistMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.time, uNight: shared.night },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vLife;
      void main() {
        float life = fract(uTime * 0.25 + aSeed);
        vLife = life;
        vec3 p = position;
        p.y += life * 9.0;
        p.xz *= 1.0 + life * 1.8;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (300.0 + life * 500.0) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * 0.35;
        gl_FragColor = vec4(mix(vec3(0.95), vec3(0.4, 0.46, 0.6), uNight), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
}

/**
 * 폭포: a cliff with a plunging fall, mist and a pool on the steepest slope
 * that can be seen from the paths. Returns a footprint so the cliff collides.
 */
export function waterfall(
  field: HeightField,
  masks: GroundMasks,
  spawn: { x: number; z: number },
  surfaces: SurfaceLibrary,
  water: THREE.Material,
) {
  const group = new THREE.Group();
  let best: {
    x: number;
    z: number;
    slope: number;
    nx: number;
    nz: number;
    view: { x: number; z: number };
  } | null = null;
  const n = new THREE.Vector3();
  for (let r = 70; r <= 300; r += 10)
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      const x = spawn.x + Math.cos(a) * r,
        z = spawn.z + Math.sin(a) * r;
      if (Math.abs(x) > 420 || Math.abs(z) > 420) continue;
      if (
        masks.sample("road", x, z) > 0.02 ||
        masks.sample("building", x, z) > 0.01 ||
        masks.sample("water", x, z) > 0.05
      )
        continue;
      let clear = true;
      for (let k = 0; k < 16 && clear; k++) {
        const b = (k / 16) * Math.PI * 2;
        for (const d of [12, 24])
          if (
            masks.sample("road", x + Math.cos(b) * d, z + Math.sin(b) * d) >
              0.05 ||
            masks.sample("building", x + Math.cos(b) * d, z + Math.sin(b) * d) >
              0.01
          )
            clear = false;
      }
      if (!clear) continue;
      // Seen from a path: 25–70 m from the nearest road, facing it.
      const road = closestRoadPoint(field.data, x, z);
      if (!road || road.distance < 25 || road.distance > 70) continue;
      field.normalAt(x, z, n);
      const slope = 1 - n.y;
      const facing =
        (n.x * (road.x - x) + n.z * (road.z - z)) / Math.max(1, road.distance);
      const score = slope * (0.4 + Math.max(0, facing)) - r * 0.0003;
      if (!best || score > best.slope)
        best = {
          x,
          z,
          slope: score,
          nx: n.x,
          nz: n.z,
          view: { x: road.x, z: road.z },
        };
    }
  if (!best) return { group, footprint: null };
  // Face the viewing point on the path.
  const face = Math.atan2(best.view.x - best.x, best.view.z - best.z);
  const dir = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const base = field.groundAt(best.x, best.z),
    H = 28,
    W = 30;
  // The cliff: a slab of displaced rock, recessed where the water falls.
  const cliff = new THREE.PlaneGeometry(W, H + 8, 36, 30);
  const p = cliff.attributes.position,
    random = rng(77);
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i),
      v = p.getY(i);
    const notch = Math.exp(-(u * u) / 18) * 2.2;
    // Stepped ledges, vertical fissures and a rounded, receding outline.
    const ledge = (v / 3.2 - Math.floor(v / 3.2)) * 1.1;
    const rough =
      Math.sin(v * 0.9 + u * 0.3) * 1.1 +
      Math.sin(u * 1.7 + v * 0.4) * 0.7 +
      ledge +
      (random() - 0.5) * 0.9;
    const lean = ((v + H / 2) / H) * -2.5;
    const round = Math.pow(Math.abs(u) / (W / 2), 2) * -6;
    p.setZ(i, rough - notch + lean + round);
  }
  cliff.computeVertexNormals();
  const uv = cliff.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 5);
  const rock = new THREE.Mesh(cliff, rockMaterial(surfaces, "#8f918b"));
  rock.position.set(
    best.x - dir.x * 1.5,
    base + (H + 8) / 2 - 4,
    best.z - dir.z * 1.5,
  );
  rock.rotation.y = face;
  rock.castShadow = rock.receiveShadow = true;
  group.add(rock);
  // Shoulders and a crest so the slab reads as part of the mountain.
  for (const s of [-1, 1]) {
    const mass = pinnacle(
      H * 0.8,
      6.5,
      s > 0 ? 501 : 502,
      rockMaterial(surfaces, "#8f918b"),
    );
    mass.position.set(
      best.x + side.x * s * (W / 2),
      base - 4,
      best.z + side.z * s * (W / 2),
    );
    group.add(mass);
  }
  const crest = new THREE.Mesh(
    new THREE.BoxGeometry(W + 6, 6, 14),
    rockMaterial(surfaces, "#8f918b"),
  );
  crest.position.set(best.x - dir.x * 8, base + H, best.z - dir.z * 8);
  crest.rotation.y = face;
  group.add(crest);
  // The fall: three arcing streams from the lip, fanning out as they drop.
  const fallMat = fallMaterial();
  for (const [offset, width, depth] of [
    [0, 7.5, 0],
    [-4.6, 3.2, 0.4],
    [4.2, 2.6, 0.5],
  ]) {
    const fall = new THREE.PlaneGeometry(1, H + 2, 1, 24);
    const fp = fall.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const v = (fp.getY(i) + (H + 2) / 2) / (H + 2);
      fp.setX(i, fp.getX(i) * width * (1.25 - v * 0.35));
      fp.setZ(i, 1.2 + depth + Math.pow(v, 0.5) * 2.4 - (1 - v) * 0.4);
    }
    fall.computeVertexNormals();
    const stream = new THREE.Mesh(fall, fallMat);
    stream.position.set(
      best.x + dir.x * 0.6 + side.x * offset,
      base + (H + 2) / 2 - 2.2,
      best.z + dir.z * 0.6 + side.z * offset,
    );
    stream.rotation.y = face;
    stream.renderOrder = 3;
    group.add(stream);
  }
  // Plunge pool and drifting spray.
  // The pool sits in a basin at the lowest ground in front of the cliff.
  const px = best.x + dir.x * 7,
    pz = best.z + dir.z * 7;
  let low = Infinity;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    low = Math.min(
      low,
      field.groundAt(px + Math.cos(a) * 8, pz + Math.sin(a) * 8),
    );
  }
  const pool = new THREE.Mesh(new THREE.CircleGeometry(9, 40), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(px, low + 0.3, pz);
  group.add(pool);
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(
      9.6,
      10.5,
      Math.max(1, base - low + 4),
      40,
      1,
      true,
    ),
    rockMaterial(surfaces, "#7d8079"),
  );
  rim.position.set(px, low + 0.3 - Math.max(1, base - low + 4) / 2 + 0.25, pz);
  rim.material.side = THREE.DoubleSide;
  group.add(rim);
  const count = 70,
    pos = new Float32Array(count * 3),
    seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos.set([(random() - 0.5) * 6, random() * 2, (random() - 0.5) * 6], i * 3);
    seeds[i] = random();
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  mistGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const mist = new THREE.Points(mistGeo, mistMaterial());
  mist.position.copy(pool.position);
  mist.frustumCulled = false;
  group.add(mist);
  // Collide with the cliff body.
  const c = new THREE.Vector3(best.x - dir.x * 7, 0, best.z - dir.z * 7);
  const hx = side.clone().multiplyScalar(W / 2 + 6),
    hz = dir.clone().multiplyScalar(8);
  const corner = (a: number, b: number) =>
    [c.x + hx.x * a + hz.x * b, c.z + hx.z * a + hz.z * b] as [number, number];
  const footprint: GeoBuilding & { top: number } = {
    id: "waterfall-cliff",
    name: "",
    height: H,
    top: base + H,
    rings: [
      [
        corner(-1, -1),
        corner(1, -1),
        corner(1, 1),
        corner(-1, 1),
        corner(-1, -1),
      ],
    ],
  };
  group.name = "waterfall";
  return {
    group,
    footprint,
    at: { x: pool.position.x, z: pool.position.z },
    view: best.view,
  };
}

/* -------------------------------- pavilions ------------------------------- */

/**
 * 정자: open pavilions at a viewpoint near the paths and beside the water.
 * Platforms are low enough to step onto.
 */
export function pavilions(
  field: HeightField,
  masks: GroundMasks,
  spawn: { x: number; z: number },
  surfaces: SurfaceLibrary,
) {
  const M = hanokMaterials(surfaces),
    b = new Builder(),
    footprints: (GeoBuilding & { top: number })[] = [];
  const spots: { x: number; z: number; kind: "view" | "water" }[] = [];
  const near = (x: number, z: number) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (masks.sample("road", x + Math.cos(a) * 9, z + Math.sin(a) * 9) > 0.2)
        return true;
    }
    return false;
  };
  const free = (x: number, z: number, r: number) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (
        masks.sample("road", px, pz) > 0.05 ||
        masks.sample("building", px, pz) > 0.01 ||
        masks.sample("water", px, pz) > 0.05
      )
        return false;
    }
    return (
      masks.sample("road", x, z) < 0.05 &&
      Math.abs(x) < 430 &&
      Math.abs(z) < 430
    );
  };
  let view: { x: number; z: number; h: number } | null = null,
    shore: { x: number; z: number; d: number } | null = null;
  for (let r = 40; r <= 360; r += 8)
    for (let a = 0; a < Math.PI * 2; a += 0.08) {
      const x = spawn.x + Math.cos(a) * r,
        z = spawn.z + Math.sin(a) * r;
      if (!free(x, z, 5) || !near(x, z)) continue;
      const h = field.groundAt(x, z);
      // Flat enough to stand on.
      const flat =
        Math.abs(field.groundAt(x + 3, z) - h) +
          Math.abs(field.groundAt(x, z + 3) - h) <
        0.9;
      if (!flat) continue;
      if (!view || h > view.h) view = { x, z, h };
      if (
        masks.sample("water", x + 9, z) +
          masks.sample("water", x - 9, z) +
          masks.sample("water", x, z + 9) +
          masks.sample("water", x, z - 9) >
        0.4
      )
        if (!shore || r < shore.d) shore = { x, z, d: r };
    }
  if (view) spots.push({ x: view.x, z: view.z, kind: "view" });
  if (shore && (!view || Math.hypot(shore.x - view.x, shore.z - view.z) > 40))
    spots.push({ x: shore.x, z: shore.z, kind: "water" });
  spots.forEach((s, i) => {
    const y = Math.max(
      field.groundAt(s.x - 2.5, s.z - 2.5),
      field.groundAt(s.x + 2.5, s.z - 2.5),
      field.groundAt(s.x - 2.5, s.z + 2.5),
      field.groundAt(s.x + 2.5, s.z + 2.5),
    );
    const face = Math.atan2(spawn.x - s.x, spawn.z - s.z);
    const unit: HanokUnit = {
      W: s.kind === "water" ? 7.5 : 6.2,
      D: s.kind === "water" ? 6 : 6.2,
      rank: "temple",
      roof: s.kind === "water" ? "paljak" : "ujingak",
      front: 1,
      platform: 0.45 + (y - field.groundAt(s.x, s.z)),
      seed: 4000 + i,
      open: true,
    };
    const frame = new THREE.Matrix4()
      .makeTranslation(s.x, y + 0.45, s.z)
      .multiply(new THREE.Matrix4().makeRotationY(face));
    buildHanokUnit(b, M, unit, "simple", frame);
    buildHanokUnit(b, M, unit, "detail", frame);
    const half = 2.6,
      c = Math.cos(face),
      sn = Math.sin(face);
    const corner = (u: number, v: number) =>
      [s.x + u * c + v * sn, s.z - u * sn + v * c] as [number, number];
    footprints.push({
      id: `pavilion-${i}`,
      name: "",
      height: 0.45,
      top: y + 0.45,
      rings: [
        [
          corner(-half, -half),
          corner(half, -half),
          corner(half, half),
          corner(-half, half),
          corner(-half, -half),
        ],
      ],
    });
  });
  const group = b.build();
  group.name = "pavilions";
  return { group, footprints, spots };
}

/* ---------------------------------- lotus --------------------------------- */

function lotusLeafTexture() {
  return canvasTexture(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128);
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "#9bb85a");
    g.addColorStop(0.7, "#5f8a3c");
    g.addColorStop(1, "#4b7031");
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(64, 64);
    c.arc(64, 64, 62, 0.25, Math.PI * 2 - 0.05);
    c.closePath();
    c.fill();
    c.strokeStyle = "rgba(200, 220, 150, 0.45)";
    c.lineWidth = 1.2;
    for (let k = 0; k < 16; k++) {
      const a = 0.25 + (k / 16) * (Math.PI * 2 - 0.3);
      c.beginPath();
      c.moveTo(64, 64);
      c.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      c.stroke();
    }
  });
}

/** 연꽃: leaves and blossoms along the calm margins of ponds near the paths. */
export function lotusPonds(
  field: HeightField,
  masks: GroundMasks,
  spawn: { x: number; z: number },
) {
  const group = new THREE.Group(),
    random = rng(64);
  const leaves: THREE.Matrix4[] = [],
    flowers: THREE.Matrix4[] = [];
  for (const w of field.waterLevels) {
    const ring = w.polygon.rings[0];
    let area = 0;
    for (let i = 1; i < ring.length; i++)
      area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
    area = Math.abs(area / 2);
    const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length,
      cz = ring.reduce((t, p) => t + p[1], 0) / ring.length;
    // Ponds and quiet backwaters only, close enough to be seen.
    if (area > 60000 || Math.hypot(cx - spawn.x, cz - spawn.z) > 420) continue;
    const xs = ring.map((p) => p[0]),
      zs = ring.map((p) => p[1]);
    const target = Math.min(1600, area / 6);
    for (let k = 0; k < target * 6 && leaves.length < 6000; k++) {
      const x =
          Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)),
        z = Math.min(...zs) + random() * (Math.max(...zs) - Math.min(...zs));
      if (!pointInPolygon(x, z, w.polygon)) continue;
      // Thick near the banks, thinning toward open water.
      const shore =
        1 -
        Math.min(
          masks.sample("water", x + 8, z),
          masks.sample("water", x - 8, z),
          masks.sample("water", x, z + 8),
          masks.sample("water", x, z - 8),
        );
      if (random() > 0.25 + shore * 1.5) continue;
      const s = 0.45 + random() * 0.5;
      leaves.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(x, w.level + 0.04 + random() * 0.02, z),
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(-Math.PI / 2, 0, random() * 6.28),
          ),
          new THREE.Vector3(s, s, s),
        ),
      );
      if (random() < 0.12)
        flowers.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x + 0.2, w.level + 0.35, z + 0.1),
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(0, random() * 6.28, 0),
            ),
            new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + random() * 0.4),
          ),
        );
    }
  }
  if (!leaves.length) return group;
  const leafMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      map: lotusLeafTexture(),
      alphaTest: 0.5,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
    leaves.length,
  );
  leaves.forEach((m, i) => leafMesh.setMatrixAt(i, m));
  leafMesh.receiveShadow = true;
  group.add(leafMesh);
  if (flowers.length) {
    // A cup of pink petals with a golden heart.
    const petal = new THREE.SphereGeometry(
      0.16,
      8,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5,
    );
    petal.scale(0.55, 1.5, 0.3);
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const g = petal.clone();
      g.rotateX(0.35);
      g.translate(0, 0, 0.07);
      g.rotateY((k / 8) * Math.PI * 2);
      parts.push(g);
    }
    const merged = mergeAll(parts);
    const flowerMesh = new THREE.InstancedMesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: "#f2a7bd",
        emissive: "#5a2030",
        emissiveIntensity: 0.25,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
      flowers.length,
    );
    flowers.forEach((m, i) => flowerMesh.setMatrixAt(i, m));
    group.add(flowerMesh);
  }
  group.name = "lotus";
  return group;
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  const position: number[] = [],
    normal: number[] = [];
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    position.push(...(flat.attributes.position.array as Float32Array));
    normal.push(...(flat.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
  return out;
}

/* ------------------------------ river lanterns ----------------------------- */

/** 유등: paper lanterns drifting on the water by night. */
export class RiverLanterns {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private items: {
    x: number;
    z: number;
    y: number;
    a: number;
    r: number;
    s: number;
  }[] = [];
  private m = new THREE.Matrix4();
  constructor(field: HeightField, spawn: { x: number; z: number }) {
    const random = rng(1225);
    for (const w of field.waterLevels) {
      const ring = w.polygon.rings[0];
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      for (let k = 0; k < 1500 && this.items.length < 180; k++) {
        const x =
            Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)),
          z = Math.min(...zs) + random() * (Math.max(...zs) - Math.min(...zs));
        if (
          Math.hypot(x - spawn.x, z - spawn.z) > 260 ||
          !pointInPolygon(x, z, w.polygon)
        )
          continue;
        this.items.push({
          x,
          z,
          y: w.level + 0.15,
          a: random() * 6.28,
          r: 2 + random() * 6,
          s: 1.3 + random() * 0.7,
        });
      }
    }
    if (!this.items.length) return;
    const body = new THREE.CylinderGeometry(0.22, 0.28, 0.32, 8);
    body.translate(0, 0.16, 0);
    const material = new THREE.MeshStandardMaterial({
      color: "#f4c27a",
      emissive: "#ffae52",
      emissiveIntensity: 1,
      roughness: 0.7,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = shared.night;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uNight;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * 5.0;",
        );
    };
    this.mesh = new THREE.InstancedMesh(body, material, this.items.length);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }
  update(time: number) {
    if (!this.mesh) return;
    this.group.visible = shared.night.value > 0.5;
    if (!this.group.visible) return;
    this.items.forEach((it, i) => {
      const a = it.a + time * 0.03;
      this.m.makeTranslation(
        it.x + Math.cos(a) * it.r,
        it.y + Math.sin(time * 1.3 + it.a) * 0.03,
        it.z + Math.sin(a) * it.r,
      );
      this.m.scale(new THREE.Vector3(it.s, it.s, it.s));
      this.mesh!.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
