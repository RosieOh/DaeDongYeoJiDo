import * as THREE from "three";
import { shared } from "./quality";

/** A loose skein of white cranes (학) gliding high over the valley. */
export class Cranes {
  readonly group = new THREE.Group();
  private birds: {
    root: THREE.Group;
    left: THREE.Object3D;
    right: THREE.Object3D;
    phase: number;
    offset: THREE.Vector3;
  }[] = [];
  private angle = Math.random() * Math.PI * 2;
  private center = new THREE.Vector3();
  constructor(count = 7) {
    const white = new THREE.MeshStandardMaterial({
      color: "#f4f2ec",
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    const black = new THREE.MeshStandardMaterial({
      color: "#1b1b1f",
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const red = new THREE.MeshStandardMaterial({ color: "#c0392b" });
    const wingShape = (tip: boolean) => {
      const g = new THREE.BufferGeometry();
      // A swept wing: root at x=0, tip at x=1.15 (black primaries on the tip).
      const pts = tip
        ? [0.75, 0, -0.05, 1.15, 0, -0.32, 0.75, 0, -0.38]
        : [
            0, 0, 0.12, 0.8, 0, -0.04, 0.75, 0, -0.38, 0, 0, 0.12, 0.75, 0,
            -0.38, 0, 0, -0.25,
          ];
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      g.computeVertexNormals();
      return g;
    };
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.11, 0.55, 3, 8),
        white,
      );
      body.rotation.x = Math.PI / 2;
      root.add(body);
      const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.05, 0.6, 6),
        white,
      );
      neck.rotation.x = Math.PI / 2;
      neck.position.z = 0.55;
      root.add(neck);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), red);
      crown.position.set(0, 0.02, 0.86);
      root.add(crown);
      const legs = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4),
        black,
      );
      legs.rotation.x = Math.PI / 2;
      legs.position.z = -0.6;
      root.add(legs);
      const wing = (s: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(s * 0.08, 0.04, 0.05);
        const a = new THREE.Mesh(wingShape(false), white),
          b = new THREE.Mesh(wingShape(true), black);
        a.scale.x = b.scale.x = s;
        pivot.add(a, b);
        root.add(pivot);
        return pivot;
      };
      const left = wing(-1),
        right = wing(1);
      root.scale.setScalar(1.4);
      this.group.add(root);
      this.birds.push({
        root,
        left,
        right,
        phase: Math.random() * 6,
        offset: new THREE.Vector3(
          (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 2.6,
          (Math.random() - 0.5) * 1.5,
          -Math.ceil(i / 2) * 2.2,
        ),
      });
    }
  }
  update(dt: number, time: number, player: THREE.Vector3) {
    this.group.visible = shared.night.value < 0.5;
    if (!this.group.visible) return;
    // The skein circles slowly around the traveller's valley.
    this.angle += dt * 0.035;
    const radius = 190;
    this.center.set(
      player.x + Math.cos(this.angle) * radius,
      player.y + 70,
      player.z + Math.sin(this.angle) * radius,
    );
    const heading = this.angle + Math.PI / 2;
    for (const b of this.birds) {
      const o = b.offset
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -heading + Math.PI / 2);
      b.root.position.copy(this.center).add(o);
      b.root.position.y += Math.sin(time * 0.5 + b.phase) * 0.8;
      b.root.rotation.y = -heading + Math.PI / 2;
      // Slow, deep wingbeats with long glides between.
      const beat =
        Math.sin(time * 2.4 + b.phase) *
        (0.35 + 0.35 * Math.max(0, Math.sin(time * 0.3 + b.phase)));
      b.left.rotation.z = -beat;
      b.right.rotation.z = beat;
    }
  }
}
