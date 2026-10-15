import * as THREE from "three";
import { shared } from "./quality";
import type { HanokRank } from "./placeStyles";
import type { SurfaceLibrary } from "./textures";
import { canvasTexture, normalTexture, rng } from "./textures";

/* ================================ builder ================================ */

type Bucket = { p: number[]; n: number[]; u: number[] };
const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _m = new THREE.Vector3();

/**
 * Accumulates transformed triangles per material and emits one mesh per
 * material, so a whole village becomes a handful of draw calls.
 */
export class Builder {
  private buckets = new Map<THREE.Material, Bucket>();
  private frame = new THREE.Matrix4();
  private normalMatrix = new THREE.Matrix3();
  setFrame(m: THREE.Matrix4) {
    this.frame.copy(m);
    this.normalMatrix.getNormalMatrix(m);
  }
  private bucket(m: THREE.Material) {
    let b = this.buckets.get(m);
    if (!b) this.buckets.set(m, (b = { p: [], n: [], u: [] }));
    return b;
  }
  /** Triangle in local frame coordinates; flat normal unless given. */
  tri(
    m: THREE.Material,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ua: number[],
    ub: number[],
    uc: number[],
    na?: THREE.Vector3,
    nb?: THREE.Vector3,
    nc?: THREE.Vector3,
  ) {
    const B = this.bucket(m);
    _a.copy(a).applyMatrix4(this.frame);
    _b.copy(b).applyMatrix4(this.frame);
    _c.copy(c).applyMatrix4(this.frame);
    B.p.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, _c.x, _c.y, _c.z);
    if (na && nb && nc)
      for (const n of [na, nb, nc]) {
        _n.copy(n).applyMatrix3(this.normalMatrix).normalize();
        B.n.push(_n.x, _n.y, _n.z);
      }
    else {
      _n.subVectors(_b, _a).cross(_m.subVectors(_c, _a)).normalize();
      B.n.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
    }
    B.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(
    m: THREE.Material,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    uv: number[][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ) {
    this.tri(m, a, b, c, uv[0], uv[1], uv[2]);
    this.tri(m, a, c, d, uv[0], uv[2], uv[3]);
  }
  /** Axis box rotated about Y around its centre; UVs in metres / uvScale. */
  box(
    m: THREE.Material,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    rotY = 0,
    uvScale = 1,
  ) {
    const c = Math.cos(rotY),
      s = Math.sin(rotY);
    const P = (x: number, y: number, z: number) =>
      new THREE.Vector3(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const hx = sx / 2,
      hy = sy / 2,
      hz = sz / 2,
      U = (w: number, h: number) => [
        [0, 0],
        [w / uvScale, 0],
        [w / uvScale, h / uvScale],
        [0, h / uvScale],
      ];
    this.quad(
      m,
      P(hx, -hy, hz),
      P(hx, -hy, -hz),
      P(hx, hy, -hz),
      P(hx, hy, hz),
      U(sz, sy),
    );
    this.quad(
      m,
      P(-hx, -hy, -hz),
      P(-hx, -hy, hz),
      P(-hx, hy, hz),
      P(-hx, hy, -hz),
      U(sz, sy),
    );
    this.quad(
      m,
      P(-hx, -hy, hz),
      P(hx, -hy, hz),
      P(hx, hy, hz),
      P(-hx, hy, hz),
      U(sx, sy),
    );
    this.quad(
      m,
      P(hx, -hy, -hz),
      P(-hx, -hy, -hz),
      P(-hx, hy, -hz),
      P(hx, hy, -hz),
      U(sx, sy),
    );
    this.quad(
      m,
      P(-hx, hy, hz),
      P(hx, hy, hz),
      P(hx, hy, -hz),
      P(-hx, hy, -hz),
      U(sx, sz),
    );
    this.quad(
      m,
      P(-hx, -hy, -hz),
      P(hx, -hy, -hz),
      P(hx, -hy, hz),
      P(-hx, -hy, hz),
      U(sx, sz),
    );
  }
  cylinder(
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    r0: number,
    r1: number,
    h: number,
    sides = 8,
    cap = false,
  ) {
    const ring = (r: number, yy: number) =>
      Array.from({ length: sides + 1 }, (_, i) => {
        const a = (i / sides) * Math.PI * 2;
        return new THREE.Vector3(x + Math.cos(a) * r, yy, z + Math.sin(a) * r);
      });
    const A = ring(r0, y),
      B = ring(r1, y + h);
    for (let i = 0; i < sides; i++) {
      const n0 = new THREE.Vector3(A[i].x - x, 0, A[i].z - z).normalize(),
        n1 = new THREE.Vector3(A[i + 1].x - x, 0, A[i + 1].z - z).normalize();
      const u0 = (i / sides) * 2,
        u1 = ((i + 1) / sides) * 2;
      this.tri(
        m,
        A[i],
        B[i + 1],
        A[i + 1],
        [u0, 0],
        [u1, h],
        [u1, 0],
        n0,
        n1,
        n1,
      );
      this.tri(m, A[i], B[i], B[i + 1], [u0, 0], [u0, h], [u1, h], n0, n0, n1);
      if (cap) {
        const top = new THREE.Vector3(x, y + h, z);
        this.tri(m, top, B[i + 1], B[i], [0.5, 0.5], [0, 0], [1, 0]);
      }
    }
  }
  /** A rectangular profile swept along a polyline, resting on it. */
  sweep(
    m: THREE.Material,
    pts: THREE.Vector3[],
    w: number,
    h: number,
    sink = 0.1,
  ) {
    const frames = pts.map((p, i) => {
      const t = pts[Math.min(i + 1, pts.length - 1)]
        .clone()
        .sub(pts[Math.max(i - 1, 0)])
        .normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(t).normalize();
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      const up = t.clone().cross(side).normalize().multiplyScalar(-1);
      if (up.y < 0) up.negate();
      const base = p.clone().addScaledVector(up, -sink);
      return {
        bl: base.clone().addScaledVector(side, -w / 2),
        br: base.clone().addScaledVector(side, w / 2),
        tl: base
          .clone()
          .addScaledVector(side, -w / 2)
          .addScaledVector(up, h),
        tr: base
          .clone()
          .addScaledVector(side, w / 2)
          .addScaledVector(up, h),
      };
    });
    let along = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1],
        b = frames[i],
        l = pts[i].distanceTo(pts[i - 1]),
        u0 = along,
        u1 = (along += l);
      const uv = (v0: number, v1: number) => [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      this.quad(m, a.tl, b.tl, b.tr, a.tr, uv(0, 1));
      this.quad(m, a.bl, b.bl, b.tl, a.tl, uv(0, 1));
      this.quad(m, a.tr, b.tr, b.br, a.br, uv(0, 1));
    }
    const s = frames[0],
      e = frames[frames.length - 1];
    this.quad(m, s.br, s.bl, s.tl, s.tr);
    this.quad(m, e.bl, e.br, e.tr, e.tl);
  }
  /** Grid of points (rows × cols) with smooth normals oriented toward `hint`. */
  surface(
    m: THREE.Material,
    grid: THREE.Vector3[][],
    uvs: number[][][],
    hint: THREE.Vector3,
  ) {
    const rows = grid.length,
      cols = grid[0].length;
    const normals = grid.map((row, r) =>
      row.map((_p, c) => {
        const du = grid[r][Math.min(c + 1, cols - 1)]
          .clone()
          .sub(grid[r][Math.max(c - 1, 0)]);
        const dv = grid[Math.min(r + 1, rows - 1)][c]
          .clone()
          .sub(grid[Math.max(r - 1, 0)][c]);
        const n = du.cross(dv).normalize();
        return n.dot(hint) < 0 ? n.negate() : n;
      }),
    );
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        const a = grid[r][c];
        _n.subVectors(grid[r][c + 1], a).cross(
          _m.subVectors(grid[r + 1][c + 1], a),
        );
        const flip = _n.dot(normals[r][c]) < 0;
        const tri = (i: number[][]) => {
          const [p, q, s] = flip ? [i[0], i[2], i[1]] : i;
          this.tri(
            m,
            grid[p[0]][p[1]],
            grid[q[0]][q[1]],
            grid[s[0]][s[1]],
            uvs[p[0]][p[1]],
            uvs[q[0]][q[1]],
            uvs[s[0]][s[1]],
            normals[p[0]][p[1]],
            normals[q[0]][q[1]],
            normals[s[0]][s[1]],
          );
        };
        tri([
          [r, c],
          [r, c + 1],
          [r + 1, c + 1],
        ]);
        tri([
          [r, c],
          [r + 1, c + 1],
          [r + 1, c],
        ]);
      }
  }
  /** Triangle fan in a vertical plane (gables). */
  fan(
    m: THREE.Material,
    center: THREE.Vector3,
    ring: THREE.Vector3[],
    uv: (p: THREE.Vector3) => number[],
  ) {
    for (let i = 1; i < ring.length; i++)
      this.tri(
        m,
        center,
        ring[i - 1],
        ring[i],
        uv(center),
        uv(ring[i - 1]),
        uv(ring[i]),
      );
  }
  build(shadows = true) {
    const group = new THREE.Group();
    for (const [material, b] of this.buckets) {
      if (!b.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.u, 2));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/* =============================== textures =============================== */

const cache = new Map<string, THREE.Texture>();
const once = (key: string, make: () => THREE.Texture) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
};

/** 기와: four columns of convex 수키와 over concave 암키와, four courses. */
function tileHeight(x: number, y: number) {
  const u = (x / 64) % 1,
    r = (y / 64) % 1,
    d = Math.abs(u - 0.5);
  const ridge =
    d < 0.2
      ? Math.sqrt(1 - (d / 0.2) ** 2) * 1.1
      : -0.35 * Math.sin((Math.PI * (d - 0.2)) / 0.3);
  return ridge + r * 0.45;
}
const tileColor = () =>
  canvasTexture(256, 256, (c) => {
    const random = rng(3);
    const img = c.createImageData(256, 256);
    const tint: number[] = [];
    for (let i = 0; i < 64; i++) tint.push(0.88 + random() * 0.22);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const h = tileHeight(x, y),
          r = (y / 64) % 1,
          k =
            tint[
              (Math.floor(x / 64) + Math.floor(y / 64) * 4 + (h > 0 ? 17 : 0)) %
                64
            ];
        // Ridges catch light; troughs and course edges stay dark.
        let v = (0.27 + h * 0.06) * k * (r > 0.92 ? 0.62 : 1);
        v *= 0.92 + random() * 0.12;
        const i = (y * 256 + x) * 4;
        img.data[i] = v * 255 * 0.98;
        img.data[i + 1] = v * 255 * 1.02;
        img.data[i + 2] = v * 255 * 1.1;
        img.data[i + 3] = 255;
      }
    c.putImageData(img, 0, 0);
    // Lichen and lime streaks of old roofs.
    for (let i = 0; i < 70; i++) {
      c.fillStyle =
        random() < 0.5 ? "rgba(140,150,110,0.12)" : "rgba(210,205,190,0.08)";
      c.beginPath();
      c.ellipse(
        random() * 256,
        random() * 256,
        3 + random() * 9,
        2 + random() * 5,
        random() * 3,
        0,
        7,
      );
      c.fill();
    }
  });

function rafterTexture(painted: boolean) {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = painted ? "#27443c" : "#d9d1c1";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) {
      const x = i * 64 + 12,
        g = c.createLinearGradient(x, 0, x + 40, 0);
      const [a, b] = painted ? ["#2f5c4f", "#5b9180"] : ["#5f4630", "#9a7756"];
      g.addColorStop(0, a);
      g.addColorStop(0.45, b);
      g.addColorStop(1, a);
      c.fillStyle = g;
      c.fillRect(x, 0, 40, 256);
      if (painted) {
        // 단청 bands near the rafter tips.
        for (const [y, col] of [
          [240, "#b8392d"],
          [226, "#f1e7d0"],
          [214, "#2d4f8c"],
        ] as [number, string][]) {
          c.fillStyle = col;
          c.fillRect(x, y, 40, 9);
        }
      }
    }
  });
}

function fasciaTexture(painted: boolean) {
  return canvasTexture(256, 128, (c) => {
    c.fillStyle = painted ? "#1d2a2a" : "#e4ddcf";
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = "#30353a";
    c.fillRect(0, 0, 256, 60);
    for (let i = 0; i < 4; i++) {
      const x = 32 + i * 64;
      // 수막새 roof-tile end discs.
      c.fillStyle = "#555c62";
      c.beginPath();
      c.arc(x, 30, 23, 0, 7);
      c.fill();
      c.fillStyle = "#40464b";
      c.beginPath();
      c.arc(x, 30, 16, 0, 7);
      c.fill();
      // Rafter ends.
      const rings = painted
        ? ["#2c6f5c", "#f1e7d0", "#2d4f8c", "#c0392b", "#f2c14e"]
        : ["#6e5137", "#8a6a48", "#9d7b55", "#8a6a48"];
      rings.forEach((col, k) => {
        c.fillStyle = col;
        c.beginPath();
        c.arc(x, 94, 21 - k * 4, 0, 7);
        c.fill();
      });
    }
  });
}

function dancheongTexture() {
  return canvasTexture(512, 64, (c) => {
    c.fillStyle = "#3b7a6b";
    c.fillRect(0, 0, 512, 64);
    for (const [y, h, col] of [
      [0, 4, "#1f2b2b"],
      [4, 3, "#f1e7d0"],
      [57, 3, "#f1e7d0"],
      [60, 4, "#1f2b2b"],
    ] as [number, number, string][]) {
      c.fillStyle = col;
      c.fillRect(0, y, 512, h);
    }
    for (let k = 0; k < 2; k++) {
      const cx = 128 + k * 256;
      // 머리초: banded petals around a central rosette.
      for (let s = -1; s <= 1; s += 2)
        for (let j = 0; j < 4; j++) {
          c.fillStyle = ["#f1e7d0", "#2d4f8c", "#c0392b", "#f2c14e"][j];
          c.fillRect(cx + s * (40 + j * 9), 8, 7, 48);
        }
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2;
        c.fillStyle = j % 2 ? "#e8834e" : "#c0392b";
        c.beginPath();
        c.ellipse(cx + Math.cos(a) * 17, 32 + Math.sin(a) * 15, 9, 5, a, 0, 7);
        c.fill();
      }
      for (const [r, col] of [
        [13, "#f1e7d0"],
        [10, "#2d4f8c"],
        [6, "#f2c14e"],
      ] as [number, string][]) {
        c.fillStyle = col;
        c.beginPath();
        c.arc(cx, 32, r, 0, 7);
        c.fill();
      }
      // 휘: stepped chevrons between motifs.
      c.strokeStyle = "rgba(241,231,208,0.85)";
      c.lineWidth = 2;
      for (let x = cx + 84; x < cx + 172; x += 12) {
        c.beginPath();
        c.moveTo(x, 12);
        c.lineTo(x + 6, 32);
        c.lineTo(x, 52);
        c.stroke();
      }
    }
  });
}

type FacadeKind = "palace" | "temple" | "house" | "thatched";
/** White where 창호지 paper is, so lamplight shows through at night. */
function facadeGlow(kind: FacadeKind) {
  return canvasTexture(1024, 512, (c) => {
    c.fillStyle = "#000";
    c.fillRect(0, 0, 1024, 512);
    c.fillStyle = kind === "thatched" ? "#b98a52" : "#ffd9a0";
    const sill = kind === "palace" || kind === "temple" ? 120 : 40;
    c.fillRect(18, 20, 106, 512 - 40 - sill);
    c.fillRect(132, 20, 106, 512 - 40 - sill);
    c.fillRect(256 + 70, 196, 116, 140);
    c.fillRect(768 + 30, 60, 196, 260);
  });
}
function nightGlow(material: THREE.MeshStandardMaterial, strength: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.night;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlowPos;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvGlowPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uNight;\nvarying vec3 vGlowPos;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
float house = fract(sin(dot(floor(vGlowPos.xz / 9.0), vec2(12.9898, 78.233))) * 43758.5453);
totalEmissiveRadiance *= uNight * ${strength.toFixed(2)} * step(0.3, house) * (0.6 + house * 0.6);`,
      );
  };
  material.customProgramCacheKey = () => "glow";
  return material;
}
/** Four panel types side by side: door, window wall, plain wall, sill window. */
function facadeTexture(kind: FacadeKind) {
  return canvasTexture(1024, 512, (c) => {
    const frame =
      kind === "palace"
        ? "#7a3326"
        : kind === "temple"
          ? "#6d4a35"
          : kind === "thatched"
            ? "#5f4a34"
            : "#7d5d40";
    const wall = kind === "thatched" ? "#b9a27c" : "#ebe5d8";
    const paper = "#efe5cf";
    const random = rng(kind.length * 13);
    const lattice = (
      x: number,
      y: number,
      w: number,
      h: number,
      style: string,
    ) => {
      c.fillStyle = paper;
      c.fillRect(x, y, w, h);
      c.strokeStyle = frame;
      c.lineWidth = 2.2;
      if (style === "diagonal") {
        c.lineWidth = 1.6;
        for (let k = -h; k < w + h; k += 8) {
          c.beginPath();
          c.moveTo(x + k, y);
          c.lineTo(x + k + h, y + h);
          c.moveTo(x + k + h, y);
          c.lineTo(x + k, y + h);
          c.stroke();
        }
      } else if (style === "flower") {
        for (let yy = y + 9; yy < y + h; yy += 18)
          for (let xx = x + 9; xx < x + w; xx += 18) {
            c.fillStyle = ["#c9a45c", "#86a88f", "#b5705e", "#d8c49a"][
              Math.floor(random() * 4)
            ];
            for (let p = 0; p < 6; p++) {
              const a = (p / 6) * Math.PI * 2;
              c.beginPath();
              c.ellipse(
                xx + Math.cos(a) * 4.5,
                yy + Math.sin(a) * 4.5,
                4,
                2.4,
                a,
                0,
                7,
              );
              c.fill();
            }
          }
      } else {
        // 띠살: dense verticals with banded horizontals.
        for (let xx = x + 6; xx < x + w; xx += 9) {
          c.beginPath();
          c.moveTo(xx, y);
          c.lineTo(xx, y + h);
          c.stroke();
        }
        for (const t of [0.08, 0.5, 0.92])
          for (let k = -1; k <= 1; k++) {
            c.beginPath();
            c.moveTo(x, y + h * t + k * 7);
            c.lineTo(x + w, y + h * t + k * 7);
            c.stroke();
          }
      }
      c.lineWidth = 7;
      c.strokeRect(x, y, w, h);
    };
    const style =
      kind === "palace" ? "diagonal" : kind === "temple" ? "flower" : "bands";
    for (let tile = 0; tile < 4; tile++) {
      const x0 = tile * 256;
      c.fillStyle = wall;
      c.fillRect(x0, 0, 256, 512);
      if (kind === "thatched") {
        for (let i = 0; i < 400; i++) {
          c.fillStyle = `rgba(90,70,40,${random() * 0.12})`;
          c.fillRect(
            x0 + random() * 256,
            random() * 512,
            2 + random() * 6,
            1 + random() * 3,
          );
        }
      }
      c.fillStyle = frame;
      c.fillRect(x0, 0, 256, 14);
      c.fillRect(x0, 498, 256, 14);
      c.fillRect(x0, 0, 10, 512);
      c.fillRect(x0 + 246, 0, 10, 512);
      if (tile === 0) {
        const sill = kind === "palace" || kind === "temple" ? 120 : 40;
        lattice(x0 + 18, 20, 106, 512 - 40 - sill, style);
        lattice(x0 + 132, 20, 106, 512 - 40 - sill, style);
        c.fillStyle = frame;
        c.fillRect(x0 + 10, 492 - sill, 236, sill);
        c.fillStyle = "rgba(0,0,0,0.18)";
        c.fillRect(x0 + 30, 506 - sill, 196, sill - 30);
      } else if (tile === 1) {
        c.fillRect(x0, 170, 256, 10);
        c.fillRect(x0, 350, 256, 10);
        lattice(x0 + 70, 196, 116, 140, style === "flower" ? "bands" : style);
      } else if (tile === 2) {
        c.fillStyle = frame;
        c.fillRect(x0, 250, 256, 9);
      } else {
        c.fillStyle = frame;
        c.fillRect(x0, 340, 256, 160);
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.fillRect(x0 + 24, 360, 92, 120);
        c.fillRect(x0 + 140, 360, 92, 120);
        lattice(x0 + 30, 60, 196, 260, style === "flower" ? "bands" : style);
      }
    }
  });
}

function gableTexture(painted: boolean) {
  return canvasTexture(256, 256, (c) => {
    if (painted) {
      c.fillStyle = "#e8e2d4";
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = "#9c8676";
      for (let y = 0; y < 256; y += 16)
        for (let x = (y / 16) % 2 ? -16 : 0; x < 256; x += 32)
          c.fillRect(x + 2, y + 2, 28, 12);
      c.strokeStyle = "#7a3326";
      c.lineWidth = 8;
      c.beginPath();
      c.arc(128, 150, 44, 0, 7);
      c.stroke();
    } else {
      for (let x = 0; x < 256; x += 32) {
        c.fillStyle = x % 64 ? "#6b4f37" : "#5d4430";
        c.fillRect(x, 0, 32, 256);
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.fillRect(x, 0, 2, 256);
      }
    }
  });
}

/** 장대석: long dressed granite blocks laid in courses. */
function graniteHeight(x: number, y: number) {
  const row = Math.floor(y / 64),
    off = (row % 2) * 70,
    u = (x + off) % 140,
    v = y % 64;
  const joint = Math.min(u, 140 - u, v, 64 - v);
  return joint < 2.5
    ? -1
    : Math.min(1, joint / 10) * 0.3 + Math.sin(x * 0.7 + y * 1.3) * 0.03;
}
const graniteColor = () =>
  canvasTexture(256, 256, (c) => {
    const random = rng(21);
    const img = c.createImageData(256, 256);
    const tone: number[] = Array.from(
      { length: 32 },
      () => 0.9 + random() * 0.14,
    );
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const h = graniteHeight(x, y),
          row = Math.floor(y / 64),
          block = Math.floor((x + (row % 2) * 70) / 140) + row * 3;
        const speck = random() < 0.08 ? 0.82 : random() < 0.05 ? 1.08 : 1;
        const v = (h < -0.5 ? 0.48 : 0.78) * tone[block % 32] * speck;
        const i = (y * 256 + x) * 4;
        img.data[i] = v * 238;
        img.data[i + 1] = v * 232;
        img.data[i + 2] = v * 220;
        img.data[i + 3] = 255;
      }
    c.putImageData(img, 0, 0);
  });

const thatchHeight = (x: number, y: number) =>
  Math.sin(x * 0.9 + Math.sin(y * 0.15) * 3) * 0.3 +
  Math.sin(x * 2.3 + y * 0.05) * 0.15 +
  ((y + x * 0.5) % 64 < 3 || (y - x * 0.5 + 512) % 64 < 3 ? -1 : 0);
const thatchColor = () =>
  canvasTexture(256, 256, (c) => {
    const random = rng(8);
    c.fillStyle = "#8f7a55";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) {
      const x = random() * 256,
        y = random() * 256,
        l = 8 + random() * 22,
        g = 120 + random() * 80;
      c.strokeStyle = `rgba(${g},${g * 0.86},${g * 0.6},0.55)`;
      c.lineWidth = 1 + random();
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (random() - 0.5) * 3, y + l);
      c.stroke();
    }
    c.strokeStyle = "rgba(70,58,38,0.65)";
    c.lineWidth = 3;
    for (let k = -256; k < 512; k += 64) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k + 128, 256);
      c.moveTo(k + 128, 0);
      c.lineTo(k, 256);
      c.stroke();
    }
  });

/* =============================== materials =============================== */

export type HanokMaterials = ReturnType<typeof hanokMaterials>;

function lanternMaterial(color: string) {
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
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.12 + uNight * 4.5;",
      );
  };
  m.customProgramCacheKey = () => "lantern";
  return m;
}

export function hanokMaterials(surfaces: SurfaceLibrary) {
  const std = (o: THREE.MeshStandardMaterialParameters) =>
    new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const tileNormal = once("tileN", () =>
    normalTexture(256, 256, tileHeight, 1.4),
  );
  const thatchNormal = once("thatchN", () =>
    normalTexture(256, 256, thatchHeight, 1.2),
  );
  const dancheong = once("dancheong", dancheongTexture);
  const wood = surfaces.maps.wood,
    plaster = surfaces.maps.plaster;
  return {
    tile: std({
      map: once("tile", tileColor),
      normalMap: tileNormal,
      roughness: 0.78,
    }),
    thatch: std({
      map: once("thatch", thatchColor),
      normalMap: thatchNormal,
      roughness: 1,
      color: "#b9ab90",
      side: THREE.DoubleSide,
    }),
    thatchUnder: std({
      map: once("thatch", thatchColor),
      roughness: 1,
      color: "#6e6352",
      side: THREE.DoubleSide,
    }),
    soffitPainted: std({
      map: once("raftersP", () => rafterTexture(true)),
      side: THREE.DoubleSide,
    }),
    soffit: std({
      map: once("rafters", () => rafterTexture(false)),
      side: THREE.DoubleSide,
    }),
    fasciaPainted: std({
      map: once("fasciaP", () => fasciaTexture(true)),
      side: THREE.DoubleSide,
    }),
    fascia: std({
      map: once("fascia", () => fasciaTexture(false)),
      side: THREE.DoubleSide,
    }),
    ridge: std({
      color: "#7a8088",
      map: once("tile", tileColor),
      roughness: 0.8,
    }),
    ridgeWhite: std({
      color: "#efebe2",
      map: plaster.map,
      normalMap: plaster.normal,
    }),
    dancheong: std({ map: dancheong, roughness: 0.75 }),
    red: std({
      color: "#8a3b2b",
      map: wood.map,
      normalMap: wood.normal,
      roughness: 0.7,
    }),
    wood: std({ color: "#b48c66", map: wood.map, normalMap: wood.normal }),
    woodDark: std({ color: "#8a6a50", map: wood.map, normalMap: wood.normal }),
    plaster: std({
      color: "#f3efe6",
      map: plaster.map,
      normalMap: plaster.normal,
    }),
    mud: std({ color: "#c7ae86", map: plaster.map, normalMap: plaster.normal }),
    stone: std({
      color: "#ffffff",
      map: once("granite", graniteColor),
      normalMap: once("graniteN", () =>
        normalTexture(256, 256, graniteHeight, 1.6),
      ),
      roughness: 0.92,
    }),
    earth: std({
      color: "#b49c7c",
      map: surfaces.maps.path.map,
      normalMap: surfaces.maps.path.normal,
    }),
    gablePainted: std({
      map: once("gableP", () => gableTexture(true)),
      side: THREE.DoubleSide,
    }),
    gable: std({
      map: once("gable", () => gableTexture(false)),
      side: THREE.DoubleSide,
    }),
    facade: Object.fromEntries(
      (["palace", "temple", "house", "thatched"] as FacadeKind[]).map(
        (kind) => [
          kind,
          nightGlow(
            std({
              map: once(`f-${kind}`, () => facadeTexture(kind)),
              emissiveMap: once(`g-${kind}`, () => facadeGlow(kind)),
              emissive: "#ffffff",
              side: THREE.DoubleSide,
            }),
            kind === "palace" ? 0.7 : 1.6,
          ),
        ],
      ),
    ) as Record<FacadeKind, THREE.MeshStandardMaterial>,
    lanternRed: lanternMaterial("#d0452f"),
    lanternBlue: lanternMaterial("#3557a6"),
    lanternWarm: lanternMaterial("#f2b45a"),
    lotus: ["#e8839a", "#f2c14e", "#7cc27a", "#f3ecdc", "#e0584a"].map(
      lanternMaterial,
    ),
  };
}

/* ============================ hanok geometry ============================ */

export type RoofType = "paljak" | "matbae" | "ujingak" | "thatch";
export type HanokUnit = {
  W: number;
  D: number;
  rank: HanokRank;
  roof: RoofType;
  /** Local +z (1) or -z (-1) is the entrance side. */
  front: 1 | -1;
  platform: number;
  seed: number;
  storey?: "lower" | "upper";
  lanterns?: "street" | "temple" | "none";
  /** An open pavilion (정자/누각): columns and a railing instead of walls. */
  open?: boolean;
};

const params = {
  palace: {
    colH: 3.6,
    bay: 3.6,
    overhang: 1.9,
    bracket: 0.95,
    pitch: 0.82,
    lift: 0.85,
    bulge: 0.55,
    colR: 0.27,
    ridgeW: 0.62,
    ridgeH: 0.85,
    thick: 0.42,
  },
  temple: {
    colH: 3.3,
    bay: 3.2,
    overhang: 1.7,
    bracket: 0.8,
    pitch: 0.8,
    lift: 0.75,
    bulge: 0.5,
    colR: 0.24,
    ridgeW: 0.5,
    ridgeH: 0.6,
    thick: 0.38,
  },
  house: {
    colH: 2.55,
    bay: 2.5,
    overhang: 1.15,
    bracket: 0.32,
    pitch: 0.74,
    lift: 0.42,
    bulge: 0.3,
    colR: 0.12,
    ridgeW: 0.42,
    ridgeH: 0.5,
    thick: 0.3,
  },
  thatched: {
    colH: 2.15,
    bay: 2.3,
    overhang: 0.8,
    bracket: 0.18,
    pitch: 0.82,
    lift: 0,
    bulge: 0,
    colR: 0.1,
    ridgeW: 0.5,
    ridgeH: 0.4,
    thick: 0.5,
  },
};

type RoofFrame = {
  W: number;
  D: number;
  Ye: number;
  Hr: number;
  xg: number;
  tEnd: number;
  lift: number;
  bulge: number;
  thick: number;
  f: (t: number) => number;
  type: RoofType;
};

function roofFrame(u: HanokUnit, Hc: number, P: (typeof params)["house"]) {
  const { W, D } = u;
  const oh = Math.min(P.overhang, D * 0.24);
  const thatch = u.roof === "thatch";
  const f = thatch
    ? (t: number) => Math.pow(Math.sin((t * Math.PI) / 2), 1.25)
    : (t: number) => Math.pow(t, 1.55);
  const Hr = (D / 2) * P.pitch * (u.storey === "lower" ? 0.75 : 1);
  const tc = oh / (D / 2);
  let tEnd = u.roof === "paljak" ? 0.52 : u.roof === "matbae" ? 0 : 1;
  let xg = u.roof === "matbae" ? W / 2 : Math.max(W / 2 - (tEnd * D) / 2, 0.04);
  if (u.roof === "paljak" && xg < W * 0.2) {
    xg = W * 0.2;
    tEnd = (W / 2 - xg) / (D / 2);
  }
  const lift =
    u.roof === "matbae" ? P.lift * 0.25 : P.lift * Math.min(1, D / 9);
  const Ye = Hc + P.bracket + P.thick - Hr * f(tc);
  return {
    frame: {
      W,
      D,
      Ye,
      Hr,
      xg,
      tEnd,
      lift,
      bulge: P.bulge * Math.min(1, D / 10),
      thick: P.thick,
      f,
      type: u.roof,
    } as RoofFrame,
    oh,
    tc,
  };
}

function xEdge(r: RoofFrame, t: number) {
  if (r.type === "matbae") return r.W / 2;
  return t <= r.tEnd ? r.W / 2 + (r.xg - r.W / 2) * (t / r.tEnd) : r.xg;
}
/** 앙곡 (corner lift) and 안허리곡 (corners reaching outward in plan). */
function deform(r: RoofFrame, p: THREE.Vector3) {
  const nx = Math.min(Math.abs(p.x) / (r.W / 2), 1.05),
    nz = Math.min(Math.abs(p.z) / (r.D / 2), 1.05);
  p.y += r.lift * Math.pow(nx * nz, 3);
  p.x += Math.sign(p.x) * r.bulge * nx ** 3 * nz ** 2;
  p.z += Math.sign(p.z) * r.bulge * nz ** 3 * nx ** 2;
  return p;
}
function frontPoint(
  r: RoofFrame,
  a: number,
  t: number,
  side: number,
  drop = 0,
) {
  return deform(
    r,
    new THREE.Vector3(
      a * xEdge(r, t),
      r.Ye + r.Hr * r.f(t),
      side * (1 - t) * (r.D / 2),
    ),
  ).add(new THREE.Vector3(0, -drop, 0));
}
function endPoint(r: RoofFrame, a: number, t: number, side: number, drop = 0) {
  const x = r.W / 2 + (r.xg - r.W / 2) * (t / r.tEnd);
  return deform(
    r,
    new THREE.Vector3(side * x, r.Ye + r.Hr * r.f(t), a * (1 - t) * (r.D / 2)),
  ).add(new THREE.Vector3(0, -drop, 0));
}

function buildRoof(
  b: Builder,
  M: HanokMaterials,
  r: RoofFrame,
  u: HanokUnit,
  tc: number,
) {
  const painted = u.rank === "palace" || u.rank === "temple";
  const top = r.type === "thatch" ? M.thatch : M.tile;
  const thatch = r.type === "thatch";
  const soffit = thatch ? M.thatchUnder : painted ? M.soffitPainted : M.soffit;
  const fascia = thatch ? M.thatch : painted ? M.fasciaPainted : M.fascia;
  const nt = 7,
    TILE = 1.2;
  const slope: number[] = [0];
  for (let k = 1; k <= nt; k++) {
    const t0 = (k - 1) / nt,
      t1 = k / nt;
    slope.push(
      slope[k - 1] +
        Math.hypot(((t1 - t0) * r.D) / 2, r.Hr * (r.f(t1) - r.f(t0))),
    );
  }
  const UP = new THREE.Vector3(0, 1, 0),
    DOWN = new THREE.Vector3(0, -1, 0);
  const tAt = (k: number, tMax: number) => (k / nt) * tMax;
  // Long faces.
  for (const side of [1, -1]) {
    const na = Math.min(22, Math.max(4, Math.round(r.W / 1.5)));
    const grid: THREE.Vector3[][] = [],
      uvs: number[][][] = [],
      under: THREE.Vector3[][] = [],
      underUv: number[][][] = [];
    for (let k = 0; k <= nt; k++) {
      const t = tAt(k, 1),
        row: THREE.Vector3[] = [],
        rowUv: number[][] = [];
      for (let i = 0; i <= na; i++) {
        const a = (i / na) * 2 - 1;
        row.push(frontPoint(r, a, t, side));
        rowUv.push([(a * xEdge(r, t)) / TILE, slope[k] / TILE]);
      }
      grid.push(row);
      uvs.push(rowUv);
    }
    b.surface(top, grid, uvs, UP);
    const tu = Math.min(1, tc + 0.12);
    for (let k = 0; k <= 2; k++) {
      const t = (k / 2) * tu,
        row: THREE.Vector3[] = [],
        rowUv: number[][] = [];
      for (let i = 0; i <= na; i++) {
        const a = (i / na) * 2 - 1;
        row.push(frontPoint(r, a, t, side, r.thick));
        rowUv.push([(a * xEdge(r, t)) / TILE, (t * r.D) / 2 / TILE]);
      }
      under.push(row);
      underUv.push(rowUv);
    }
    b.surface(soffit, under, underUv, DOWN);
    // Eave edge with tile-end discs and rafter ends.
    for (let i = 0; i < na; i++) {
      const p0 = grid[0][i],
        p1 = grid[0][i + 1],
        q0 = under[0][i],
        q1 = under[0][i + 1];
      const u0 = uvs[0][i][0],
        u1 = uvs[0][i + 1][0];
      const quad = side > 0 ? [q0, q1, p1, p0] : [q1, q0, p0, p1];
      b.quad(
        fascia,
        quad[0],
        quad[1],
        quad[2],
        quad[3],
        side > 0
          ? [
              [u0, 0],
              [u1, 0],
              [u1, 1],
              [u0, 1],
            ]
          : [
              [u1, 0],
              [u0, 0],
              [u0, 1],
              [u1, 1],
            ],
      );
    }
  }
  // Hip ends (팔작 lower slopes, 우진각, 초가).
  if (r.tEnd > 0)
    for (const side of [1, -1]) {
      const na = Math.min(14, Math.max(4, Math.round(r.D / 1.5))),
        rows = Math.max(3, Math.round(nt * r.tEnd));
      const grid: THREE.Vector3[][] = [],
        uvs: number[][][] = [],
        under: THREE.Vector3[][] = [],
        underUv: number[][][] = [];
      for (let k = 0; k <= rows; k++) {
        const t = (k / rows) * r.tEnd,
          row: THREE.Vector3[] = [],
          rowUv: number[][] = [];
        for (let i = 0; i <= na; i++) {
          const a = (i / na) * 2 - 1;
          row.push(endPoint(r, a, t, side));
          rowUv.push([(a * (1 - t) * r.D) / 2 / TILE, (t * r.D) / 2 / TILE]);
        }
        grid.push(row);
        uvs.push(rowUv);
      }
      b.surface(top, grid, uvs, UP);
      const tu = Math.min(r.tEnd, tc + 0.12);
      for (let k = 0; k <= 2; k++) {
        const t = (k / 2) * tu,
          row: THREE.Vector3[] = [],
          rowUv: number[][] = [];
        for (let i = 0; i <= na; i++) {
          const a = (i / na) * 2 - 1;
          row.push(endPoint(r, a, t, side, r.thick));
          rowUv.push([(a * (1 - t) * r.D) / 2 / TILE, (t * r.D) / 2 / TILE]);
        }
        under.push(row);
        underUv.push(rowUv);
      }
      b.surface(soffit, under, underUv, DOWN);
      for (let i = 0; i < na; i++) {
        const p0 = grid[0][i],
          p1 = grid[0][i + 1],
          q0 = under[0][i],
          q1 = under[0][i + 1];
        const u0 = uvs[0][i][0],
          u1 = uvs[0][i + 1][0];
        const quad = side < 0 ? [q0, q1, p1, p0] : [q1, q0, p0, p1];
        b.quad(
          fascia,
          quad[0],
          quad[1],
          quad[2],
          quad[3],
          side < 0
            ? [
                [u0, 0],
                [u1, 0],
                [u1, 1],
                [u0, 1],
              ]
            : [
                [u1, 0],
                [u0, 0],
                [u0, 1],
                [u1, 1],
              ],
        );
      }
    }
  // Gables: 합각 for 팔작, 박공 boards for 맞배.
  if (r.type === "paljak")
    for (const side of [1, -1]) {
      const x = side * (r.xg - 0.14);
      const ring: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const t = r.tEnd + ((1 - r.tEnd) * k) / 8;
        ring.push(frontPoint(r, 1, t, 1, 0.05).setX(x));
      }
      for (let k = 7; k >= 0; k--) {
        const t = r.tEnd + ((1 - r.tEnd) * k) / 8;
        ring.push(frontPoint(r, 1, t, -1, 0.05).setX(x));
      }
      const center = new THREE.Vector3(x, ring[0].y, 0);
      const ordered = side > 0 ? [...ring].reverse() : ring;
      b.fan(painted ? M.gablePainted : M.gable, center, ordered, (p) => [
        p.z / 2.5,
        p.y / 2.5,
      ]);
      // 내림마루 along the gable verge.
      for (const zSide of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 6; k++)
          pts.push(frontPoint(r, side, r.tEnd + ((1 - r.tEnd) * k) / 6, zSide));
        b.sweep(M.ridge, pts, 0.26, 0.28);
      }
    }
  if (r.type === "matbae")
    for (const side of [1, -1])
      for (const zSide of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++)
          pts.push(frontPoint(r, side, k / 8, zSide));
        b.sweep(M.ridge, pts, 0.28, 0.3);
        const board = pts.map((p) =>
          p.clone().add(new THREE.Vector3(side * 0.05, -r.thick * 0.6, 0)),
        );
        b.sweep(M.woodDark, board, 0.08, r.thick * 0.9, 0.3);
      }
  // 추녀마루 along the hips.
  if (r.tEnd > 0 && r.type !== "thatch")
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 8; k++)
          pts.push(frontPoint(r, sx, (k / 8) * r.tEnd, sz));
        if (u.rank === "palace") {
          b.sweep(M.ridgeWhite, pts, 0.3, 0.3);
          b.sweep(
            M.ridge,
            pts.map((p) => p.clone().setY(p.y + 0.26)),
            0.24,
            0.1,
            0,
          );
          // 잡상: small guardian figures on the palace hips.
          for (let k = 2; k <= 4; k++) {
            const p = pts[k];
            b.box(M.ridge, p.x, p.y + 0.4, p.z, 0.13, 0.22, 0.13);
          }
        } else b.sweep(M.ridge, pts, 0.26, 0.28);
      }
  // 용마루.
  const ridgeY = r.Ye + r.Hr,
    xr = r.type === "matbae" ? r.W / 2 + 0.05 : Math.max(r.xg, 0.3);
  if (r.type === "thatch") {
    const pts = [
      new THREE.Vector3(-xr, ridgeY, 0),
      new THREE.Vector3(xr, ridgeY, 0),
    ];
    b.sweep(M.thatch, pts, 0.7, 0.32, 0.15);
  } else {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const x = -xr + (2 * xr * k) / 10,
        e = Math.abs(x) / xr;
      pts.push(new THREE.Vector3(x, ridgeY + Math.pow(e, 6) * 0.28, 0));
    }
    const P = params[u.rank];
    if (u.rank === "palace") {
      b.sweep(M.ridgeWhite, pts, P.ridgeW, P.ridgeH * 0.75, 0.2);
      b.sweep(
        M.ridge,
        pts.map((p) => p.clone().setY(p.y + P.ridgeH * 0.62)),
        P.ridgeW * 0.7,
        0.22,
        0,
      );
      // 취두 at both ends.
      for (const s of [-1, 1])
        b.box(M.ridge, s * xr, ridgeY + 0.55, 0, 0.5, 1.35, 0.56);
    } else {
      b.sweep(M.ridge, pts, P.ridgeW, P.ridgeH, 0.2);
      for (const s of [-1, 1])
        b.box(
          M.ridge,
          s * (xr + 0.08),
          ridgeY + P.ridgeH * 0.8,
          0,
          0.16,
          0.42,
          0.5,
        );
    }
  }
}

/**
 * Builds one rectangular hanok unit in its local frame (origin on platform
 * top). "simple" is the always-visible shell; "detail" adds only the close-up
 * carpentry that streams in around the traveller.
 */
export function buildHanokUnit(
  b: Builder,
  M: HanokMaterials,
  u: HanokUnit,
  mode: "simple" | "detail",
  frame: THREE.Matrix4,
) {
  b.setFrame(frame);
  const P = params[u.rank];
  const Hc =
    (u.storey === "upper" ? 3.1 : P.colH) * Math.min(1.35, 0.86 + u.D / 32);
  const { frame: r, oh, tc } = roofFrame(u, Hc, P);
  const Wc = u.W - oh * 2,
    Dc = u.D - oh * 2;
  const painted = u.rank === "palace" || u.rank === "temple";
  const facade = M.facade[u.rank];
  const random = rng(u.seed);
  const shell = mode === "simple";
  // 기단 (stone platform) – reaches down to the lowest ground under the unit.
  if (shell && u.storey !== "upper") {
    const margin = Math.min(
      u.rank === "house" || u.rank === "thatched" ? 0.55 : 0.9,
      oh - 0.25,
    );
    const Wp = Wc + margin * 2,
      Dp = Dc + margin * 2,
      depth = u.platform;
    const mat = u.rank === "thatched" ? M.earth : M.stone;
    b.box(mat, 0, -depth / 2, 0, Wp, depth, Dp, 0, 3.4);
    if (u.rank === "palace" && u.W * u.D > 420)
      b.box(
        M.stone,
        0,
        -depth + 0.35,
        u.front * 2.2,
        Wp + 6,
        0.7,
        Dp + 4.4,
        0,
        3.4,
      );
    // Front steps.
    const rise = 0.17,
      steps = Math.max(1, Math.round(Math.min(1.4, depth * 0.55) / rise)),
      sw = Math.min(3.2, Wc * 0.3);
    if (depth > 0.3 && u.rank !== "thatched")
      for (let i = 0; i < steps; i++)
        b.box(
          M.stone,
          0,
          -rise * (i + 0.5),
          u.front * (Dp / 2 + 0.17 + i * 0.32),
          sw,
          rise,
          0.34,
          0,
          3.4,
        );
  }
  // Walls as textured bays (cheap from afar, readable up close).
  const baysX = Math.max(1, Math.round(Wc / P.bay)),
    baysZ = Math.max(1, Math.round(Dc / (P.bay * 0.85)));
  const wallTop = Hc - 0.32;
  const tileUv = (tile: number) => [
    [tile * 0.25, 0],
    [tile * 0.25 + 0.25, 0],
    [tile * 0.25 + 0.25, 1],
    [tile * 0.25, 1],
  ];
  const sideTile = (front: boolean, i: number, n: number) => {
    if (u.rank === "palace" || u.rank === "temple")
      return front ? ((i === 0 || i === n - 1) && n > 3 ? 1 : 0) : 2 + (i % 2);
    if (front)
      return i === Math.floor(n / 2) || (n > 3 && i === Math.floor(n / 2) - 1)
        ? 0
        : 3;
    return random() < 0.5 ? 2 : 1;
  };
  for (const zs of shell && !u.open ? [1, -1] : []) {
    const isFront = zs === u.front;
    for (let i = 0; i < baysX; i++) {
      const x0 = -Wc / 2 + (Wc * i) / baysX,
        x1 = -Wc / 2 + (Wc * (i + 1)) / baysX,
        z = (zs * Dc) / 2;
      const pts =
        zs > 0
          ? [
              new THREE.Vector3(x0, 0, z),
              new THREE.Vector3(x1, 0, z),
              new THREE.Vector3(x1, wallTop, z),
              new THREE.Vector3(x0, wallTop, z),
            ]
          : [
              new THREE.Vector3(x1, 0, z),
              new THREE.Vector3(x0, 0, z),
              new THREE.Vector3(x0, wallTop, z),
              new THREE.Vector3(x1, wallTop, z),
            ];
      b.quad(
        facade,
        pts[0],
        pts[1],
        pts[2],
        pts[3],
        tileUv(sideTile(isFront, i, baysX)),
      );
    }
  }
  for (const xs of shell && !u.open ? [1, -1] : [])
    for (let i = 0; i < baysZ; i++) {
      const z0 = -Dc / 2 + (Dc * i) / baysZ,
        z1 = -Dc / 2 + (Dc * (i + 1)) / baysZ,
        x = (xs * Wc) / 2;
      const pts =
        xs > 0
          ? [
              new THREE.Vector3(x, 0, z1),
              new THREE.Vector3(x, 0, z0),
              new THREE.Vector3(x, wallTop, z0),
              new THREE.Vector3(x, wallTop, z1),
            ]
          : [
              new THREE.Vector3(x, 0, z0),
              new THREE.Vector3(x, 0, z1),
              new THREE.Vector3(x, wallTop, z1),
              new THREE.Vector3(x, wallTop, z0),
            ];
      b.quad(
        facade,
        pts[0],
        pts[1],
        pts[2],
        pts[3],
        tileUv(u.rank === "house" && random() < 0.4 ? 1 : 2),
      );
    }
  // Frieze band (창방 + 공포 zone) closes the gap up to the eaves.
  const beam = painted
    ? M.dancheong
    : u.rank === "thatched"
      ? M.woodDark
      : M.wood;
  const frieze = Hc + P.bracket - wallTop;
  if (shell) {
    b.box(beam, 0, wallTop + frieze / 2, Dc / 2, Wc + 0.1, frieze, 0.24, 0, 2);
    b.box(beam, 0, wallTop + frieze / 2, -Dc / 2, Wc + 0.1, frieze, 0.24, 0, 2);
    b.box(beam, Wc / 2, wallTop + frieze / 2, 0, 0.24, frieze, Dc, 0, 2);
    b.box(beam, -Wc / 2, wallTop + frieze / 2, 0, 0.24, frieze, Dc, 0, 2);
    // Ceiling cap so the soffit never shows sky through the walls.
    b.box(
      painted ? M.soffitPainted : M.soffit,
      0,
      Hc + P.bracket - 0.02,
      0,
      Wc + 0.2,
      0.04,
      Dc + 0.2,
      0,
      1.2,
    );
    buildRoof(b, M, r, u, tc);
    return { top: r.Ye + r.Hr + 1, Hc, r, Wc, Dc };
  }
  // ---------------------------- close-up detail ----------------------------
  const cols: [number, number][] = [];
  for (let i = 0; i <= baysX; i++)
    for (const zs of [1, -1])
      cols.push([-Wc / 2 + (Wc * i) / baysX, (zs * Dc) / 2]);
  for (let i = 1; i < baysZ; i++)
    for (const xs of [1, -1])
      cols.push([(xs * Wc) / 2, -Dc / 2 + (Dc * i) / baysZ]);
  const colMat = painted ? M.red : u.rank === "thatched" ? M.woodDark : M.wood;
  for (const [x, z] of cols) {
    if (painted) {
      b.cylinder(colMat, x, 0, z, P.colR, P.colR * 0.86, Hc, 10);
      if (u.storey !== "upper")
        b.cylinder(
          M.stone,
          x,
          -0.02,
          z,
          P.colR * 1.7,
          P.colR * 1.55,
          0.22,
          10,
          true,
        );
    } else {
      b.box(colMat, x, Hc / 2, z, P.colR * 2, Hc, P.colR * 2, 0, 1);
      if (u.storey !== "upper")
        b.box(M.stone, x, 0.08, z, P.colR * 3.2, 0.2, P.colR * 3.2, 0, 1);
    }
  }
  // 창방 and 평방, painted on palaces and temples.
  const beamY = wallTop + 0.16;
  b.box(beam, 0, beamY, Dc / 2 + 0.06, Wc + P.colR * 2, 0.34, 0.26, 0, 2);
  b.box(beam, 0, beamY, -Dc / 2 - 0.06, Wc + P.colR * 2, 0.34, 0.26, 0, 2);
  b.box(beam, Wc / 2 + 0.06, beamY, 0, 0.26, 0.34, Dc + P.colR * 2, 0, 2);
  b.box(beam, -Wc / 2 - 0.06, beamY, 0, 0.26, 0.34, Dc + P.colR * 2, 0, 2);
  if (painted) {
    // 공포: stacked brackets at columns, plus between columns on large halls (다포).
    const between = u.W * u.D > 240 ? 2 : u.W * u.D > 90 ? 1 : 0;
    const bracket = (x: number, z: number, ox: number, oz: number) => {
      const rot = Math.atan2(ox, oz);
      // 주두, then three tiers of 첨차 (along the wall) and 살미 (projecting arms).
      b.box(M.dancheong, x, Hc + 0.05, z, 0.34, 0.12, 0.34, rot, 1);
      for (let k = 0; k < 3; k++) {
        const y = Hc + 0.18 + k * 0.17,
          out = 0.04 + k * 0.2,
          along = 0.46 + k * 0.22;
        b.box(
          k % 2 ? M.red : M.dancheong,
          x + ox * out,
          y,
          z + oz * out,
          along,
          0.1,
          0.12,
          rot,
          1,
        );
        b.box(
          M.dancheong,
          x + ox * (out + 0.18),
          y + 0.02,
          z + oz * (out + 0.18),
          0.12,
          0.1,
          0.42 + k * 0.22,
          rot,
          1,
        );
        b.box(
          M.red,
          x + ox * (out + 0.18) + (oz ? 0.2 : 0),
          y + 0.08,
          z + oz * (out + 0.18) + (ox ? 0.2 : 0),
          0.1,
          0.07,
          0.1,
          rot,
          1,
        );
      }
    };
    for (const zs of [1, -1])
      for (let i = 0; i <= baysX; i++) {
        const x = -Wc / 2 + (Wc * i) / baysX;
        bracket(x, (zs * Dc) / 2, 0, zs);
        if (i < baysX)
          for (let k = 1; k <= between; k++)
            bracket(
              x + ((Wc / baysX) * k) / (between + 1),
              (zs * Dc) / 2,
              0,
              zs,
            );
      }
    for (const xs of [1, -1])
      for (let i = 1; i < baysZ; i++)
        bracket((xs * Wc) / 2, -Dc / 2 + (Dc * i) / baysZ, xs, 0);
  } else if (u.rank === "house") {
    // 소로 blocks and 도리 under the eaves.
    b.box(
      M.woodDark,
      0,
      Hc + 0.12,
      (u.front * Dc) / 2 + u.front * 0.1,
      Wc + 0.6,
      0.22,
      0.24,
      0,
      1,
    );
  }
  // Lanterns: 청사초롱 at village doors; lotus lanterns at temple halls.
  // 계자난간: a low railing around an open pavilion, open at the front bay.
  if (u.open)
    for (const [ax, az, bx, bz, side] of [
      [-Wc / 2, -Dc / 2, Wc / 2, -Dc / 2, -1],
      [-Wc / 2, Dc / 2, Wc / 2, Dc / 2, 1],
      [-Wc / 2, -Dc / 2, -Wc / 2, Dc / 2, 0],
      [Wc / 2, -Dc / 2, Wc / 2, Dc / 2, 0],
    ]) {
      const len = Math.hypot(bx - ax, bz - az),
        rot = Math.atan2(bx - ax, bz - az),
        gate = side === u.front ? 1.1 : 0;
      for (const half of gate ? [-1, 1] : [0]) {
        const seg = gate ? (len - gate * 2) / 2 : len,
          off = gate ? half * (gate + seg / 2) : 0,
          cx = (ax + bx) / 2 + Math.sin(rot) * off,
          cz = (az + bz) / 2 + Math.cos(rot) * off;
        b.box(M.red, cx, 0.75, cz, 0.08, 0.08, seg, rot, 1);
        b.box(M.red, cx, 0.3, cz, 0.06, 0.06, seg, rot, 1);
        for (let k = 0; k <= Math.floor(seg / 0.5); k++) {
          const t = -seg / 2 + (k * seg) / Math.max(1, Math.floor(seg / 0.5));
          b.box(
            M.woodDark,
            cx + Math.sin(rot) * t,
            0.5,
            cz + Math.cos(rot) * t,
            0.05,
            0.45,
            0.05,
          );
        }
      }
    }
  if (u.lanterns === "street" && u.rank === "house" && random() < 0.55) {
    for (const s of [-1, 1]) {
      const x = s * Math.min(1.2, Wc * 0.2),
        z = u.front * (Dc / 2 + oh * 0.55),
        y = Hc - 0.3;
      b.box(M.woodDark, x, y + 0.42, z, 0.03, 0.4, 0.03);
      b.cylinder(M.lanternRed, x, y, z, 0.15, 0.15, 0.22, 8, true);
      b.cylinder(M.lanternBlue, x, y - 0.17, z, 0.15, 0.15, 0.17, 8, true);
    }
  }
  if (u.lanterns === "temple" && u.rank === "temple" && u.W * u.D > 60) {
    const n = Math.max(3, Math.floor(Wc / 1.1));
    for (let i = 0; i < n; i++) {
      const x = -Wc / 2 + 0.5 + ((Wc - 1) * i) / Math.max(1, n - 1),
        z = u.front * (Dc / 2 + oh * 0.6),
        y = Hc - 0.15 + Math.sin(i * 1.3) * 0.12;
      b.cylinder(
        M.lotus[i % M.lotus.length],
        x,
        y,
        z,
        0.2,
        0.24,
        0.32,
        8,
        true,
      );
    }
  }
  return { top: r.Ye + r.Hr + 1, Hc, r, Wc, Dc };
}

/** Roof height above the platform for the given unit (for camera collision). */
const columnHeight = (u: HanokUnit) =>
  (u.storey === "upper" ? 3.1 : params[u.rank].colH) *
  Math.min(1.35, 0.86 + u.D / 32);

export function unitHeight(u: HanokUnit) {
  const { frame } = roofFrame(u, columnHeight(u), params[u.rank]);
  return frame.Ye + frame.Hr + 0.6;
}

/**
 * The walkable top of the roof above the unit origin at local (x, z), or
 * null outside the eaves – lets travellers run along tiled roofs.
 */
export function roofSurface(u: HanokUnit) {
  const { frame: r } = roofFrame(u, columnHeight(u), params[u.rank]);
  return (x: number, z: number) => {
    const ax = Math.abs(x),
      az = Math.abs(z);
    if (ax > r.W / 2 || az > r.D / 2) return null;
    let t = 1 - az / (r.D / 2);
    const run = r.W / 2 - r.xg;
    if (r.type !== "matbae" && run > 1e-3)
      t = Math.min(t, (r.tEnd * (r.W / 2 - ax)) / run);
    const lift = r.lift * Math.pow((ax / (r.W / 2)) * (az / (r.D / 2)), 3);
    return r.Ye + r.Hr * r.f(Math.max(0, t)) + lift + 0.05;
  };
}
export const eaveHeight = (u: HanokUnit) =>
  roofFrame(u, columnHeight(u), params[u.rank]).frame.Ye;

export function upperStorey(u: HanokUnit): HanokUnit | null {
  if (u.rank !== "palace" || u.W * u.D < 430 || u.roof !== "paljak")
    return null;
  const bay = params.palace.bay;
  return {
    ...u,
    W: u.W - bay * 2.2,
    D: u.D - bay * 2.2,
    storey: "upper",
    platform: 0,
    seed: u.seed + 1,
  };
}

/** Lift for the upper storey: where the lower roof meets the inner columns. */
export function upperBase(u: HanokUnit, upper: HanokUnit) {
  const P = params[u.rank];
  const Hc = P.colH * Math.min(1.35, 0.86 + u.D / 32);
  const { frame } = roofFrame({ ...u, storey: "lower" }, Hc, P);
  const t =
    1 - (upper.D - 2 * Math.min(params.palace.overhang, upper.D * 0.24)) / u.D;
  return frame.Ye + frame.Hr * frame.f(Math.max(0, t)) - 0.25;
}
