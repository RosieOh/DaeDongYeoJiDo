import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Place } from "../data";

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function material(color: string, roughness = 0.88) {
  const key = color + roughness;
  if (!materials.has(key))
    materials.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        side: color === "#3d5559" ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
  return materials.get(key)!;
}
export function mesh(
  geometry: THREE.BufferGeometry,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  const m = new THREE.Mesh(geometry, material(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export function box(
  w: number,
  h: number,
  d: number,
  color: string,
  x = 0,
  y = 0,
  z = 0,
) {
  return mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z);
}
export function beam(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  color: string,
) {
  const dir = b.clone().sub(a);
  const m = mesh(
    new THREE.CylinderGeometry(radius, radius, dir.length(), 5),
    color,
  );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}
export function tree(kind: "pine" | "blossom" | "gold" = "pine", size = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.23, 3, 7), "#675547", 0, 1.5));
  if (kind === "pine") {
    for (let i = 0; i < 3; i++)
      g.add(
        mesh(
          new THREE.ConeGeometry(1.8 - i * 0.35, 2.2, 8),
          ["#436e57", "#527e62", "#668c6a"][i],
          0,
          2.6 + i * 0.8,
        ),
      );
  } else {
    for (const [x, y, z, r] of [
      [0, 3.7, 0, 1.55],
      [-1, 3.1, 0.3, 1.1],
      [1, 3.3, 0.2, 1.25],
      [0.2, 3.1, -1, 1.2],
    ]) {
      g.add(
        mesh(
          new THREE.IcosahedronGeometry(r, 1),
          kind === "blossom" ? "#edbfc0" : "#d7b878",
          x,
          y,
          z,
        ),
      );
    }
  }
  g.scale.setScalar(size);
  return g;
}
export function roof(width: number, depth: number, height = 3.2) {
  const g = new THREE.Group();
  const nx = 20,
    nz = 12,
    vertices: number[] = [],
    indices: number[] = [];
  const yAt = (x: number, z: number) =>
    height +
    1.55 * (1 - Math.pow(Math.abs(z) / (depth / 2), 0.65)) +
    0.36 * Math.pow(Math.abs(x) / (width / 2), 6) +
    0.35 * Math.pow(Math.abs(z) / (depth / 2), 7);
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= nz; j++) {
      const x = (i / nx - 0.5) * width,
        z = (j / nz - 0.5) * depth;
      vertices.push(x, yAt(x, z), z);
    }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const a = i * (nz + 1) + j,
        b = a + nz + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  g.add(mesh(geometry, "#3d5559"));
  for (let i = 0; i <= nx; i++) {
    const x = (i / nx - 0.5) * width;
    for (let j = 0; j < 8; j++) {
      const z1 = (j / 8 - 0.5) * depth,
        z2 = ((j + 1) / 8 - 0.5) * depth;
      g.add(
        beam(
          new THREE.Vector3(x, yAt(x, z1) + 0.035, z1),
          new THREE.Vector3(x, yAt(x, z2) + 0.035, z2),
          0.035,
          "#64797a",
        ),
      );
    }
  }
  g.add(
    beam(
      new THREE.Vector3(-width / 2, height + 1.9, 0),
      new THREE.Vector3(width / 2, height + 1.9, 0),
      0.1,
      "#85918b",
    ),
  );
  return g;
}
export function hanok(width = 7, depth = 4.5, pavilion = false) {
  const g = new THREE.Group(),
    post = "#775141";
  g.add(box(width + 1, 0.35, depth + 1, "#b7b19d", 0, 0.175));
  g.add(box(width + 0.5, 0.22, depth + 0.5, "#d4cbb5", 0, 0.46));
  if (!pavilion) {
    g.add(box(width - 0.35, 2.4, depth - 0.3, "#e6dbbe", 0, 1.78));
    for (const x of [-width / 3, 0, width / 3]) {
      g.add(box(1.45, 1.7, 0.08, "#8d7560", x, 1.73, depth / 2));
      g.add(box(1.25, 1.53, 0.09, "#d4c5a4", x, 1.75, depth / 2 + 0.045));
      for (let i = 0; i < 5; i++)
        g.add(
          box(
            0.035,
            1.55,
            0.1,
            post,
            x - 0.58 + i * 0.29,
            1.75,
            depth / 2 + 0.1,
          ),
        );
      for (let i = 0; i < 4; i++)
        g.add(box(1.3, 0.035, 0.1, post, x, 1.15 + i * 0.4, depth / 2 + 0.1));
    }
  }
  for (const x of [-width / 2 + 0.15, -width / 6, width / 6, width / 2 - 0.15])
    for (const z of [-depth / 2, depth / 2]) {
      g.add(
        mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.6, 8), post, x, 1.85, z),
      );
      g.add(box(0.45, 0.15, 0.45, "#a98869", x, 3.1, z));
    }
  for (const z of [-depth / 2, depth / 2])
    g.add(box(width + 0.6, 0.24, 0.22, "#775141", 0, 3.02, z));
  g.add(roof(width + 2.2, depth + 2, 3.1));
  return g;
}
export function mountain(size = 1, color = "#829482") {
  const g = new THREE.Group();
  const peaks = [
    [0, 3, 0, 2.6, 6],
    [-2.6, 2, 0.8, 2.2, 4.2],
    [2.2, 2.4, -0.7, 2, 5],
    [-0.4, 1.5, 2, 2, 3.2],
  ];
  peaks.forEach(([x, y, z, r, h], i) => {
    const rock = mesh(
      new THREE.ConeGeometry(r, h, 5, 2),
      i % 2 ? "#9baba0" : color,
      x,
      y,
      z,
    );
    rock.rotation.y = i * 0.9;
    g.add(rock);
  });
  g.scale.setScalar(size);
  return g;
}
export function island() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(5, 5.4, 0.4, 36), "#7ea7a3", 0, -0.1));
  const profile = [
    new THREE.Vector2(0, 0.45),
    new THREE.Vector2(0.8, 0.45),
    new THREE.Vector2(2, 1),
    new THREE.Vector2(2.8, 2.5),
    new THREE.Vector2(3.4, 2.25),
    new THREE.Vector2(4.2, 0.25),
  ];
  const crater = mesh(new THREE.LatheGeometry(profile, 32), "#7f9564");
  crater.rotation.y = 0.2;
  g.add(crater);
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const r = mesh(
      new THREE.DodecahedronGeometry(0.5, 0),
      "#8d8c77",
      Math.sin(a) * 3.4,
      0.8,
      Math.cos(a) * 3.4,
    );
    r.scale.y = 2;
    g.add(r);
  }
  return g;
}
export function landmark(place: Pick<Place, "id" | "category">) {
  const g = new THREE.Group();
  if (place.id === "seongsan") g.add(island());
  else if (place.id === "seorak" || place.id === "danyang") {
    g.add(mountain(1.1));
    const t = tree("pine", 0.55);
    t.position.set(3, 0.2, 2);
    g.add(t);
  } else if (
    place.id === "palace" ||
    place.id === "bulguksa" ||
    place.id === "suwon" ||
    place.id === "busan"
  ) {
    const lower = hanok(8, 4.5, true);
    g.add(lower);
    const upper = hanok(5, 3, true);
    upper.position.y = 3.1;
    upper.scale.y = 0.75;
    g.add(upper);
  } else if (place.category === "도시와 마을") {
    const a = hanok(5, 3);
    a.position.set(-2, 0, 0.5);
    const b = hanok(3.5, 2.5);
    b.position.set(2.5, 0, -2);
    g.add(a, b);
    const t = tree("blossom", 0.7);
    t.position.set(3.5, 0, 2);
    g.add(t);
  } else {
    g.add(
      mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.45, 20), "#a6b38c", 0, 0.1),
    );
    for (let i = 0; i < 4; i++) {
      const t = tree(
        place.id === "nami" ? "gold" : "pine",
        0.7 + (i % 2) * 0.25,
      );
      t.position.set(Math.sin(i * 1.8) * 2.4, 0.3, Math.cos(i * 1.8) * 2.4);
      g.add(t);
    }
    const house = hanok(3, 2, true);
    house.scale.setScalar(0.7);
    g.add(house);
  }
  return g;
}
/** Merge static geometry by material to keep the shared WebGL map layer inexpensive. */
export function bake(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
      return;
    const g = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (!g.getAttribute("uv")) {
      const p = g.getAttribute("position"),
        uv: number[] = [];
      for (let i = 0; i < p.count; i++) uv.push(p.getX(i) / 4, p.getZ(i) / 4);
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    }
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    const list = buckets.get(object.material) || [];
    list.push(flat);
    buckets.set(object.material, list);
    originals.add(object.geometry);
  });
  const result = new THREE.Group();
  for (const [m, geometries] of buckets) {
    const combined = mergeGeometries(geometries);
    if (combined) {
      const object = new THREE.Mesh(combined, m);
      object.castShadow = true;
      object.receiveShadow = true;
      result.add(object);
    }
    geometries.forEach((g) => g.dispose());
  }
  originals.forEach((g) => g.dispose());
  return result;
}
export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    mats = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).forEach((m) => mats.add(m));
    }
  });
  geometries.forEach((g) => g.dispose());
  mats.forEach((m) => {
    if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
    m.dispose();
  });
}
