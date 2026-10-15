import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { GeoRoad } from "./geo";
import { pointInPolygon } from "./geo";
import type { PlaceStyle } from "./placeStyles";
import { shared } from "./quality";
import type { GroundMasks, HeightField } from "./terrain";
import { canvasTexture, rng } from "./textures";

/**
 * Street life for a wuxia town: strings of lanterns over the lanes, stone
 * lanterns along temple and palace paths, tall cloth banners at junctions
 * and wooden boats on the water. All instanced; lanterns glow at night.
 */

function glow(color: string, strength = 4.5) {
  const m = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1,
    roughness: 0.6,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.night;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= 0.18 + uNight * ${strength.toFixed(1)};`,
      );
  };
  m.customProgramCacheKey = () => `prop-glow-${strength}`;
  return m;
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
  colors?: THREE.Color[],
) {
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, matrices.length),
  );
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  colors?.forEach((c, i) => mesh.setColorAt(i, c));
  mesh.count = matrices.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const compose = (x: number, y: number, z: number, yaw = 0, s = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(UP, yaw),
    new THREE.Vector3(s, s, s),
  );

/** A banner cloth painted with a single brush character. */
function bannerTexture(char: string, base: string) {
  return canvasTexture(128, 512, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 128, 512);
    c.fillStyle = "rgba(0,0,0,0.18)";
    c.fillRect(0, 0, 128, 18);
    c.fillStyle = "#e9c46a";
    c.fillRect(8, 22, 112, 3);
    c.fillRect(8, 470, 112, 3);
    c.fillStyle = "#f6ecd2";
    c.font = "800 92px 'Nanum Myeongjo', serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(char, 64, 200);
    // Swallow-tail cut at the bottom.
    c.globalCompositeOperation = "destination-out";
    c.beginPath();
    c.moveTo(0, 512);
    c.lineTo(64, 450);
    c.lineTo(128, 512);
    c.fill();
  });
}

function bannerMaterial(map: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({
    map,
    side: THREE.DoubleSide,
    roughness: 0.8,
    alphaTest: 0.5,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.time;
    shader.uniforms.uWind = shared.wind;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform vec2 uWind;",
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = position;
// Cloth hangs from its top edge (uv.y = 1) and ripples more toward the tail.
float free = 1.0 - uv.y;
float phase = transformed.y * 1.6 - uTime * 4.0;
#ifdef USE_INSTANCING
  phase += instanceMatrix[3][0] * 0.3;
#endif
transformed.z += sin(phase) * 0.22 * free + free * free * 0.6 * length(uWind);
transformed.x += cos(phase * 0.7) * 0.05 * free;`,
      );
  };
  m.customProgramCacheKey = () => "banner";
  return m;
}

/** A small wooden ferry with a curved hull and a woven canopy. */
function boatGeometry() {
  const hull = new THREE.CylinderGeometry(
    0.9,
    0.55,
    5.2,
    14,
    4,
    false,
    0,
    Math.PI,
  );
  hull.rotateZ(Math.PI / 2);
  hull.rotateX(Math.PI);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      t = Math.abs(x) / 2.6;
    // Taper the ends and lift the bow and stern.
    p.setZ(i, p.getZ(i) * (1 - t * t * 0.85));
    p.setY(i, p.getY(i) * (1 - t * 0.4) + t * t * 0.55);
  }
  hull.computeVertexNormals();
  const canopy = new THREE.CylinderGeometry(
    0.85,
    0.85,
    1.8,
    12,
    1,
    true,
    0,
    Math.PI,
  );
  canopy.rotateZ(Math.PI / 2);
  canopy.translate(-0.3, 0.25, 0);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, 4.6, 5);
  pole.rotateZ(1.1);
  pole.translate(1.8, 0.9, 0.3);
  const color = (g: THREE.BufferGeometry, c: string) => {
    const col = new THREE.Color(c),
      n = g.attributes.position.count,
      a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.toArray(a, i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    g.deleteAttribute("uv");
    return g.index ? g.toNonIndexed() : g;
  };
  return mergeGeometries([
    color(hull, "#6b4a33"),
    color(canopy, "#b59a62"),
    color(pole, "#4a3426"),
  ])!;
}

export function townProps(
  field: HeightField,
  masks: GroundMasks,
  roads: GeoRoad[],
  style: PlaceStyle,
  center: { x: number; z: number },
  quality: "high" | "low",
) {
  const group = new THREE.Group(),
    random = rng(1717);
  const near = (x: number, z: number, r: number) =>
    Math.hypot(x - center.x, z - center.z) < r;
  const clear = (x: number, z: number) =>
    masks.sample("road", x, z) < 0.25 &&
    masks.sample("building", x, z) < 0.02 &&
    masks.sample("water", x, z) < 0.05;
  const lanes = roads.filter(
    (r) => ["path", "minor", "service"].includes(r.class) && !r.bridge,
  );

  // --- 등롱 줄: lantern strings strung across village lanes ---
  if (style.lanterns !== "none") {
    const poles: THREE.Matrix4[] = [],
      lanterns: THREE.Matrix4[] = [],
      lanternColors: THREE.Color[] = [],
      wire: number[] = [];
    const palette =
      style.lanterns === "temple"
        ? ["#e8839a", "#f2c14e", "#7cc27a", "#f3ecdc", "#e0584a", "#7fb2e0"]
        : ["#d0452f", "#d0452f", "#c23b2a", "#e0603a"];
    const limit = quality === "high" ? 70 : 24;
    let strings = 0;
    for (const road of lanes) {
      if (strings >= limit) break;
      for (let i = 1; i < road.points.length && strings < limit; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i],
          len = Math.hypot(bx - ax, bz - az);
        if (len < 8) continue;
        const nx = -(bz - az) / len,
          nz = (bx - ax) / len;
        for (let t = 5; t < len - 4 && strings < limit; t += 16) {
          const mx = ax + ((bx - ax) * t) / len,
            mz = az + ((bz - az) * t) / len;
          if (!near(mx, mz, 360) || random() < 0.35) continue;
          const half = 2.6;
          const ends = [-1, 1].map((s) => ({
            x: mx + nx * half * s,
            z: mz + nz * half * s,
          }));
          if (!ends.every((e) => masks.sample("water", e.x, e.z) < 0.05))
            continue;
          const tops = ends.map((e) => field.heightAt(e.x, e.z) + 4.2);
          for (const [k, e] of ends.entries()) {
            poles.push(compose(e.x, tops[k] - 4.2, e.z));
          }
          // A sagging wire with lanterns hanging from it.
          const n = 6;
          let prev: THREE.Vector3 | null = null;
          for (let j = 0; j <= n; j++) {
            const u = j / n,
              x = ends[0].x + (ends[1].x - ends[0].x) * u,
              z = ends[0].z + (ends[1].z - ends[0].z) * u,
              y =
                tops[0] + (tops[1] - tops[0]) * u - Math.sin(u * Math.PI) * 0.7;
            const p = new THREE.Vector3(x, y, z);
            if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
            prev = p;
            if (j > 0 && j < n) {
              lanterns.push(compose(x, y - 0.42, z, random() * 6));
              lanternColors.push(
                new THREE.Color(palette[Math.floor(random() * palette.length)]),
              );
            }
          }
          strings++;
        }
      }
    }
    if (lanterns.length) {
      const pole = new THREE.CylinderGeometry(0.06, 0.08, 4.4, 6);
      pole.translate(0, 2.2, 0);
      group.add(
        instanced(
          pole,
          new THREE.MeshStandardMaterial({ color: "#4a3426", roughness: 0.9 }),
          poles,
        ),
      );
      const shade = new THREE.CylinderGeometry(0.2, 0.2, 0.38, 10, 3);
      const p = shade.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i),
          bulge = 1 + 0.35 * Math.cos((y / 0.19) * (Math.PI / 2));
        p.setX(i, p.getX(i) * bulge);
        p.setZ(i, p.getZ(i) * bulge);
      }
      shade.computeVertexNormals();
      const mat = glow("#ffffff", 5);
      const lanternMesh = instanced(shade, mat, lanterns, lanternColors);
      lanternMesh.castShadow = false;
      group.add(lanternMesh);
      const lines = new THREE.BufferGeometry();
      lines.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
      group.add(
        new THREE.LineSegments(
          lines,
          new THREE.LineBasicMaterial({ color: "#2b2118" }),
        ),
      );
    }
  }

  // --- 석등: stone lanterns along temple and palace paths ---
  if (style.lanterns === "temple" || style.courtBuffer >= 12) {
    const spots: THREE.Matrix4[] = [];
    for (const road of lanes) {
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i],
          len = Math.hypot(bx - ax, bz - az);
        for (let t = 6; t < len; t += 22) {
          const x = ax + ((bx - ax) * t) / len - ((bz - az) / len) * 2.4,
            z = az + ((bz - az) * t) / len + ((bx - ax) / len) * 2.4;
          if (!near(x, z, 300) || !clear(x, z) || random() < 0.4) continue;
          spots.push(compose(x, field.heightAt(x, z), z, random() * 6));
        }
      }
    }
    const stone = new THREE.MeshStandardMaterial({
      color: "#b9b4a8",
      roughness: 0.95,
    });
    const parts = [
      new THREE.CylinderGeometry(0.42, 0.5, 0.3, 8).translate(0, 0.15, 0),
      new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8).translate(0, 0.75, 0),
      new THREE.CylinderGeometry(0.36, 0.3, 0.16, 8).translate(0, 1.26, 0),
      new THREE.BoxGeometry(0.42, 0.42, 0.42).translate(0, 1.55, 0),
      new THREE.ConeGeometry(0.48, 0.32, 8).translate(0, 1.92, 0),
      new THREE.SphereGeometry(0.08, 8, 6).translate(0, 2.14, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g));
    parts.forEach((g) => g.deleteAttribute("uv"));
    if (spots.length) {
      group.add(instanced(mergeGeometries(parts)!, stone, spots));
      // The lit window of each lantern.
      const light = new THREE.BoxGeometry(0.3, 0.26, 0.44).translate(
        0,
        1.55,
        0,
      );
      const fire = instanced(light, glow("#ffb45a", 6), spots);
      fire.castShadow = false;
      group.add(fire);
    }
  }

  // --- 깃발: tall cloth banners at lane junctions near buildings ---
  {
    const chars = ["風", "雲", "明", "月", "天", "涯", "劍", "江", "湖", "遊"];
    const colors = ["#8e2a20", "#1f3a5a", "#2c5a46", "#6e2a4a"];
    const counts = new Map<string, number>();
    for (const road of roads)
      for (const [x, z] of road.points) {
        const key = `${Math.round(x / 3)},${Math.round(z / 3)}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    const junctions: [number, number][] = [];
    for (const [key, n] of counts) {
      if (n < 3) continue;
      const [i, j] = key.split(",").map(Number);
      junctions.push([i * 3, j * 3]);
    }
    const kinds = chars.slice(0, 4).map((ch, k) => ({
      material: bannerMaterial(bannerTexture(ch, colors[k % colors.length])),
      spots: [] as THREE.Matrix4[],
    }));
    const poleSpots: THREE.Matrix4[] = [];
    let placed = 0;
    for (const [jx, jz] of junctions) {
      if (placed >= (quality === "high" ? 24 : 10)) break;
      if (!near(jx, jz, 320)) continue;
      const a = random() * Math.PI * 2,
        x = jx + Math.cos(a) * 4,
        z = jz + Math.sin(a) * 4;
      if (
        !clear(x, z) ||
        (masks.sample("building", x + 3, z) +
          masks.sample("building", x - 3, z) <
          0.01 &&
          random() < 0.6)
      )
        continue;
      const y = field.heightAt(x, z),
        yaw = random() * Math.PI * 2;
      poleSpots.push(compose(x, y, z, yaw));
      kinds[placed % kinds.length].spots.push(compose(x, y, z, yaw));
      placed++;
    }
    if (poleSpots.length) {
      const pole = new THREE.CylinderGeometry(0.06, 0.08, 7.2, 6).translate(
        0,
        3.6,
        0,
      );
      const arm = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 5)
        .rotateZ(Math.PI / 2)
        .translate(0.6, 7, 0);
      const finial = new THREE.ConeGeometry(0.12, 0.4, 6).translate(0, 7.4, 0);
      const parts = [pole, arm, finial].map((g) => g.toNonIndexed());
      parts.forEach((g) => g.deleteAttribute("uv"));
      group.add(
        instanced(
          mergeGeometries(parts)!,
          new THREE.MeshStandardMaterial({ color: "#3a2a1e", roughness: 0.8 }),
          poleSpots,
        ),
      );
      // Cloth: 1.1 m wide, 4.2 m long, hanging from the arm.
      const cloth = new THREE.PlaneGeometry(1.1, 4.2, 2, 14).translate(
        0.62,
        4.9,
        0.02,
      );
      for (const k of kinds)
        if (k.spots.length) group.add(instanced(cloth, k.material, k.spots));
    }
  }

  // --- 나룻배: boats drifting on rivers, lakes and the sea ---
  const boats: {
    mesh: THREE.Group;
    x: number;
    z: number;
    y: number;
    yaw: number;
    phase: number;
  }[] = [];
  {
    const geometry = boatGeometry();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
    });
    let tries = 0;
    for (const w of field.waterLevels) {
      const ring = w.polygon.rings[0];
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      for (
        let k = 0;
        k < 60 && boats.length < 8 && tries < 4000;
        k++, tries++
      ) {
        const x =
            Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)),
          z = Math.min(...zs) + random() * (Math.max(...zs) - Math.min(...zs));
        if (!near(x, z, 320) || !pointInPolygon(x, z, w.polygon)) continue;
        if (
          masks.sample("water", x + 4, z) < 0.9 ||
          masks.sample("water", x - 4, z) < 0.9
        )
          continue;
        if (boats.some((b) => Math.hypot(b.x - x, b.z - z) < 25)) continue;
        const g = new THREE.Group();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        group.add(g);
        boats.push({
          mesh: g,
          x,
          z,
          y: w.level,
          yaw: random() * Math.PI * 2,
          phase: random() * 6,
        });
      }
    }
  }
  return {
    group,
    update(time: number) {
      for (const b of boats) {
        b.mesh.position.set(
          b.x + Math.sin(time * 0.05 + b.phase) * 3,
          b.y + Math.sin(time * 1.1 + b.phase) * 0.05 - 0.1,
          b.z + Math.cos(time * 0.04 + b.phase) * 3,
        );
        b.mesh.rotation.set(
          Math.sin(time * 0.9 + b.phase) * 0.03,
          b.yaw + Math.sin(time * 0.08 + b.phase) * 0.3,
          Math.sin(time * 1.2 + b.phase) * 0.04,
        );
      }
    },
  };
}
