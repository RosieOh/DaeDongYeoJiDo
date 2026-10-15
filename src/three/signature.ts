import * as THREE from "three";
import type { GeoSceneData } from "./geo";
import { pointInPolygon } from "./geo";
import type { HeightField } from "./terrain";
import type { SurfaceLibrary } from "./textures";
import { rng } from "./textures";

/** A craggy limestone pinnacle: stacked noisy cones leaning together. */
export function pinnacle(
  height: number,
  radius: number,
  seed: number,
  material: THREE.Material,
) {
  const random = rng(seed),
    group = new THREE.Group();
  for (let k = 0; k < 4; k++) {
    const h = height * (1 - k * 0.18) * (0.85 + random() * 0.2),
      r = radius * (1 - k * 0.15);
    const g = new THREE.CylinderGeometry(r * 0.12, r, h, 9, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        z = p.getZ(i),
        t = (y + h / 2) / h;
      // Horizontal strata and vertical fissures of weathered limestone.
      const n =
        1 +
        Math.sin(y * 3.1 + k) * 0.08 +
        Math.sin(Math.atan2(z, x) * 5 + k * 2) * 0.1 +
        (random() - 0.5) * 0.12;
      p.setXYZ(i, x * n + t * t * (random() - 0.5) * 0.4, y, z * n);
    }
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++)
      uv.setXY(i, uv.getX(i) * 3, (p.getY(i) + h / 2) / 2.5);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(
      (random() - 0.5) * radius * 0.7,
      h / 2 - 1.5,
      (random() - 0.5) * radius * 0.7,
    );
    mesh.rotation.set(
      (random() - 0.5) * 0.18,
      random() * 6,
      (random() - 0.5) * 0.18,
    );
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** 삼도정: the small hexagonal pavilion on the central peak. */
function hexPavilion(surfaces: SurfaceLibrary) {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({
    color: "#8a3b2b",
    map: surfaces.maps.wood.map,
    roughness: 0.7,
  });
  const roof = new THREE.MeshStandardMaterial({
    color: "#4a5057",
    roughness: 0.8,
    flatShading: true,
  });
  const r = 1.25;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 2.2, 8),
      red,
    );
    col.position.set(Math.cos(a) * r, 1.1, Math.sin(a) * r);
    group.add(col);
  }
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.35, r + 0.45, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: "#cfc6b5", roughness: 0.9 }),
  );
  floor.position.y = 0.05;
  group.add(floor);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.28, 6, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#3b7a6b",
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 2.1;
  group.add(beam);
  // Flared six-sided roof with lifted eaves.
  const g = new THREE.ConeGeometry(r + 1.25, 1.6, 6, 4, true);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i),
      t = (0.8 - y) / 1.6;
    const x = p.getX(i),
      z = p.getZ(i),
      corner = Math.abs(Math.cos(Math.atan2(z, x) * 3));
    p.setY(i, y - t * t * 0.55 + corner * t * t * 0.45);
  }
  g.computeVertexNormals();
  const top = new THREE.Mesh(g, roof);
  top.material.side = THREE.DoubleSide;
  top.position.y = 3.05;
  group.add(top);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), roof);
  finial.position.y = 3.95;
  group.add(finial);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return group;
}

const dodam = (data: GeoSceneData) =>
  data.pois.find((p) => p.name === "도담삼봉") ?? { x: 79, z: -12 };
const riverLevel = (data: GeoSceneData, field: HeightField) => {
  const p = dodam(data);
  return (
    field.waterLevels.find((w) => pointInPolygon(p.x, p.z, w.polygon))?.level ??
    field.groundAt(p.x, p.z)
  );
};
/** Terrain edits that must happen before the ground mesh is built. */
export function prepareTerrain(
  id: string,
  data: GeoSceneData,
  field: HeightField,
) {
  if (id === "danyang") {
    const p = dodam(data);
    field.submerge(p.x, p.z, 34, riverLevel(data, field));
  }
}

/** Hero props for places whose defining feature is smaller than the DEM grid. */
export function signature(
  id: string,
  data: GeoSceneData,
  field: HeightField,
  surfaces: SurfaceLibrary,
) {
  const group = new THREE.Group();
  if (id === "danyang") {
    const peak = dodam(data),
      water = riverLevel(data, field);
    const rock = new THREE.MeshStandardMaterial({
      color: "#a8a49a",
      map: surfaces.maps.rock.map,
      normalMap: surfaces.maps.rock.normal,
      roughness: 0.92,
    });
    // 남편봉 in the middle, 첩봉 and 처봉 to either side, as in the river today.
    const peaks: [number, number, number, number][] = [
      [0, 0, 11, 4.4],
      [-15, 8, 6.4, 3.1],
      [14, -6, 5.8, 2.9],
    ];
    peaks.forEach(([dx, dz, h, r], i) => {
      const p = pinnacle(h, r, 70 + i * 13, rock);
      p.position.set(peak.x + dx, water, peak.z + dz);
      group.add(p);
    });
    const pavilion = hexPavilion(surfaces);
    pavilion.position.set(peak.x + 0.8, water + 6.2, peak.z - 0.6);
    pavilion.scale.setScalar(0.95);
    group.add(pavilion);
  }
  return group;
}
